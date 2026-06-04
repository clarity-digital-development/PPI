import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe/server'
import { prisma } from '@/lib/prisma'
import { sendOrderConfirmationEmail, sendAdminOrderNotification, sendRefundConfirmationEmail } from '@/lib/email'
import { releaseOrderHoldsAndRestoreInventory } from '@/lib/inventory-holds'
import { resolveRefundRecipient } from '@/lib/orders/refund-recipient'
import { audit, AuditAction } from '@/lib/audit'

/**
 * Restore inventory items linked to an order whose payment failed/cancelled,
 * so a stuck 3DS or declined card doesn't leave the customer's signs locked
 * out of their inventory forever. Idempotent — safe to call multiple times.
 */
async function restoreOrderInventory(
  paymentIntentId: string,
  reason: string,
  request: NextRequest,
) {
  try {
    const orders = await prisma.order.findMany({
      where: { paymentIntentId },
      select: { id: true },
    })
    if (orders.length === 0) return

    for (const order of orders) {
      await releaseOrderHoldsAndRestoreInventory(order.id, reason, { system: true }, request)
    }
  } catch (err) {
    console.error(`Webhook (${reason}): failed to restore inventory for ${paymentIntentId}:`, err)
    // Don't fail the webhook — admin can manually restore via the customer detail page
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        // Find ALL orders for this payment intent — a single PI may back
        // a batch of orders placed via /api/orders/batch
        const existingOrders = await prisma.order.findMany({
          where: { paymentIntentId: paymentIntent.id },
        })

        if (existingOrders.length === 0) {
          // Race: the orders/batch route stamps paymentIntentId AFTER creating
          // the PI. If the webhook arrives before that stamp lands, no orders
          // are visible yet. Return 500 → Stripe retries with exponential
          // backoff (up to 24h), giving the stamp time to commit.
          console.warn('Webhook: no orders yet for PI', paymentIntent.id, '— returning 500 to trigger Stripe retry')
          return NextResponse.json(
            { error: 'orders_not_ready', paymentIntentId: paymentIntent.id },
            { status: 500 }
          )
        }

        await prisma.order.updateMany({
          where: { paymentIntentId: paymentIntent.id, paymentStatus: { not: 'succeeded' } },
          data: { paymentStatus: 'succeeded', paidAt: new Date() },
        })

        // Send one confirmation + admin email per order in the batch. Reserve
        // the email slot first via conditional update so the synchronous post-
        // charge path (single-order POST + batch POST) doesn't double-send.
        for (const o of existingOrders) {
          const reserved = await prisma.order.updateMany({
            where: { id: o.id, confirmationEmailSentAt: null },
            data: { confirmationEmailSentAt: new Date() },
          })
          if (reserved.count === 0) {
            console.log(`Webhook: order ${o.id} already has confirmation email — skipping`)
            continue
          }
          const order = await prisma.order.findUnique({
            where: { id: o.id },
            include: { orderItems: true, user: true },
          })
          if (!order) continue
          console.log(`Webhook: Sending emails for order ${order.orderNumber}`)
          try {
            await Promise.all([
              sendOrderConfirmationEmail({
                customerName: order.user.fullName || order.user.name || '',
                customerEmail: order.user.email,
                orderNumber: order.orderNumber,
                propertyAddress: `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`,
                total: Number(order.total),
                items: order.orderItems.map((item) => ({
                  description: item.description,
                  quantity: item.quantity,
                  total_price: Number(item.totalPrice),
                })),
                requestedDate: order.scheduledDate?.toISOString(),
                installationNotes: order.propertyNotes || undefined,
              }),
              sendAdminOrderNotification({
                orderNumber: order.orderNumber,
                customerName: order.user.fullName || order.user.name || '',
                customerEmail: order.user.email,
                customerPhone: order.user.phone || '',
                propertyAddress: `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`,
                total: Number(order.total),
                items: order.orderItems.map((item) => ({
                  description: item.description,
                  quantity: item.quantity,
                  total_price: Number(item.totalPrice),
                })),
                requestedDate: order.scheduledDate?.toISOString(),
                isExpedited: order.isExpedited,
                installationNotes: order.propertyNotes || undefined,
                installationLocation: order.installationLocation || undefined,
                isGatedCommunity: order.isGatedCommunity,
                gateCode: order.gateCode || undefined,
                hasMarkerPlaced: order.hasMarkerPlaced,
                signOrientation: order.signOrientation || undefined,
                signOrientationOther: order.signOrientationOther || undefined,
                subtotal: Number(order.subtotal),
                discount: Number(order.discount),
                fuelSurcharge: Number(order.fuelSurcharge),
                noPostSurcharge: Number(order.noPostSurcharge),
                expediteFee: Number(order.expediteFee),
                tax: Number(order.tax),
              }),
            ])
          } catch (emailError) {
            console.error(`Webhook: Error sending emails for order ${order.orderNumber}:`, emailError)
            // Release the reservation so a Stripe webhook retry can re-attempt.
            await prisma.order.updateMany({
              where: { id: order.id, confirmationEmailSentAt: { not: null } },
              data: { confirmationEmailSentAt: null },
            }).catch(() => {})
          }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        await prisma.order.updateMany({
          where: { paymentIntentId: paymentIntent.id },
          data: { paymentStatus: 'failed' },
        })

        // Restore any inventory that was marked out-of-storage at order creation
        // so a failed payment doesn't leave the customer's signs/riders locked
        await restoreOrderInventory(paymentIntent.id, 'payment_failed', request)
        break
      }

      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        await prisma.order.updateMany({
          where: { paymentIntentId: paymentIntent.id },
          data: {
            paymentStatus: 'failed',
            status: 'cancelled',
          },
        })

        await restoreOrderInventory(paymentIntent.id, 'canceled', request)
        break
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const paymentIntentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id
        if (!paymentIntentId) {
          console.warn('Webhook charge.refunded: charge has no payment_intent', charge.id)
          break
        }

        const order = await prisma.order.findFirst({
          where: { paymentIntentId },
          include: { user: true },
        })
        if (!order) {
          // Not every charge in the Stripe account belongs to an order in this DB
          // (e.g. test charges, deleted orders). Don't force Stripe to retry forever.
          console.warn('Webhook charge.refunded: no order for PI', paymentIntentId)
          break
        }

        if (order.paymentStatus === 'refunded' && order.refundedAt) {
          break
        }

        const refundedCents = charge.amount_refunded
        const isFullRefund = refundedCents === charge.amount
        if (!isFullRefund) {
          // v1 only acts on full refunds. We still persist refundedAmount so
          // the audit trail accurately reflects what the customer's bank shows
          // and so a later full-refund event can compute a correct delta
          // (avoids overstating the email amount on the cumulative event).
          await prisma.order.update({
            where: { id: order.id },
            data: { refundedAmount: refundedCents / 100 },
          })
          await audit({
            actor: { system: true },
            action: AuditAction.OrderRefundWebhook,
            targetType: 'order',
            targetId: order.id,
            metadata: {
              partial: true,
              refunded_cents: refundedCents,
              charge_amount: charge.amount,
              note: 'partial refunds not handled in v1',
            },
            request,
          })
          break
        }

        const latestRefund = charge.refunds?.data?.[0]
        const stripeRefundId = latestRefund?.id ?? order.refundId
        // Dashboard-initiated detection (R2 fix): gate on refundInitiatedAt,
        // NOT just refundId. refundOrder reserves refundInitiatedAt BEFORE
        // calling Stripe, so a webhook racing mid-flight will correctly see
        // "refundOrder is in charge here" and skip this branch.
        const dashboardInitiated = !order.refundInitiatedAt

        const now = new Date()
        await prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'refunded',
            refundedAt: now,
            refundedAmount: refundedCents / 100,
            // Always stamp refundId if it's still null (covers the rare case
            // where refundOrder reserved + called Stripe but its post-Stripe
            // DB update failed — webhook now backfills the id).
            ...(order.refundId ? {} : { refundId: stripeRefundId }),
            ...(dashboardInitiated
              ? {
                  refundInitiatedAt: now,
                  status: 'cancelled',
                  cancelledAt: now,
                  cancelReason: 'stripe_dashboard',
                }
              : {}),
          },
        })

        if (dashboardInitiated) {
          try {
            await releaseOrderHoldsAndRestoreInventory(
              order.id,
              'stripe_dashboard',
              { system: true },
              request,
            )
          } catch (err) {
            console.error(
              `Webhook charge.refunded: failed to release holds for order ${order.id}:`,
              err,
            )
          }
        }

        // Reserve email slot via conditional update so refundOrder (route-
        // initiated path) and this webhook can't double-send. Whichever
        // updateMany lands first wins; the other gets count=0 and no-ops.
        const emailReserved = await prisma.order.updateMany({
          where: { id: order.id, refundEmailSentAt: null },
          data: { refundEmailSentAt: now },
        })
        if (emailReserved.count > 0) {
          try {
            const recipient = await resolveRefundRecipient(order)
            await sendRefundConfirmationEmail({
              recipientName: recipient.fullName,
              recipientEmail: recipient.email,
              orderNumber: order.orderNumber,
              propertyAddress: `${order.propertyAddress}, ${order.propertyCity}, ${order.propertyState} ${order.propertyZip}`,
              refundAmount: refundedCents / 100,
              refundReason: order.refundReason ?? undefined,
              refundedAt: now,
              refundedBy: 'admin',
              auto: false,
            })
          } catch (err) {
            console.error(
              `Webhook charge.refunded: failed to send refund email for order ${order.id}:`,
              err,
            )
            // Roll back the reservation so an operator (or replay) can retry.
            await prisma.order.updateMany({
              where: { id: order.id, refundEmailSentAt: { not: null } },
              data: { refundEmailSentAt: null },
            })
          }
        }

        await audit({
          actor: { system: true },
          action: AuditAction.OrderRefundWebhook,
          targetType: 'order',
          targetId: order.id,
          metadata: {
            refundId: stripeRefundId,
            amountCents: refundedCents,
            dashboard_initiated: dashboardInitiated,
          },
          request,
        })
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
