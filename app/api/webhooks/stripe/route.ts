import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe/server'
import { prisma } from '@/lib/prisma'
import { sendOrderConfirmationEmail, sendAdminOrderNotification, sendRefundConfirmationEmail } from '@/lib/email'
import { releaseOrderHoldsAndRestoreInventory } from '@/lib/inventory-holds'
import { resolveRefundRecipient } from '@/lib/orders/refund-recipient'
import { resolveAssignedAgent } from '@/lib/orders/assigned-agent'
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

        // Order-edit-diff branch — tagged by app/api/orders/[id]/edit with
        // metadata.kind = 'order_edit_diff'. The DB row for this PI is NOT
        // on order.paymentIntentId (that still points to the original PI);
        // it's on order.lastEditPaymentIntentId. The synchronous edit-route
        // handler already persisted editChargeStatus='charged_diff' before
        // returning, so this webhook event is purely informational — we ack
        // it (200) to stop Stripe's exponential retry storm instead of
        // falling through to the orphan-handler 500.
        if (paymentIntent.metadata?.kind === 'order_edit_diff') {
          console.log(`Webhook: payment_intent.succeeded for order-edit-diff PI ${paymentIntent.id} (orderId ${paymentIntent.metadata.orderId}) — ack'd`)
          return NextResponse.json({ received: true, kind: 'order_edit_diff' })
        }

        // Invoice-payment branch — tagged by app/api/invoices/[id]/pay-intent
        // with metadata.kind = 'invoice'. Flip the Invoice to paid AND every
        // bundled Order's paymentStatus from pending_invoice → succeeded.
        if (paymentIntent.metadata?.kind === 'invoice' && paymentIntent.metadata.invoiceId) {
          const invoiceId = paymentIntent.metadata.invoiceId
          const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId },
            include: {
              orders: { select: { id: true } },
              serviceRequests: { select: { id: true } },
            },
          })
          if (!invoice) {
            console.warn(`Webhook: invoice ${invoiceId} not found for PI ${paymentIntent.id} — returning 500 for Stripe retry`)
            return NextResponse.json({ error: 'invoice_not_ready', paymentIntentId: paymentIntent.id }, { status: 500 })
          }
          // Idempotent — if already paid, do nothing.
          if (invoice.status === 'paid') {
            console.log(`Webhook: invoice ${invoiceId} already paid — skipping`)
            return NextResponse.json({ received: true })
          }

          const paidAt = new Date()
          await prisma.$transaction([
            prisma.invoice.update({
              where: { id: invoice.id },
              data: { status: 'paid', paidAt, paymentIntentId: paymentIntent.id },
            }),
            // Flip every bundled order to succeeded in one shot.
            prisma.order.updateMany({
              where: { id: { in: invoice.orders.map((o) => o.id) } },
              data: { paymentStatus: 'succeeded', paidAt, paymentIntentId: paymentIntent.id },
            }),
            // Same flip for bundled service requests — invoiceStatus moves from
            // pending_invoice → paid and the SR-level invoicePaidAt + PI id are
            // stamped for parity with the legacy single-SR charge flow.
            prisma.serviceRequest.updateMany({
              where: { id: { in: invoice.serviceRequests.map((sr) => sr.id) } },
              data: { invoiceStatus: 'paid', invoicePaidAt: paidAt, invoicePaymentIntentId: paymentIntent.id },
            }),
          ])

          await audit({
            actor: { system: true },
            action: AuditAction.InvoicePaid,
            targetType: 'invoice',
            targetId: invoice.id,
            metadata: {
              paidVia: 'stripe',
              paymentIntentId: paymentIntent.id,
              orderCount: invoice.orders.length,
              serviceRequestCount: invoice.serviceRequests.length,
              total: Number(invoice.total),
            },
            request,
          })

          console.log(`Webhook: invoice ${invoice.invoiceNumber} marked paid (${invoice.orders.length} orders + ${invoice.serviceRequests.length} SRs flipped)`)
          return NextResponse.json({ received: true })
        }

        // Standalone-charge branches — PIs that are deliberately NOT stamped on
        // any order.paymentIntentId, because that column holds the order's
        // ORIGINAL checkout PI and must keep pointing there. Each of these is
        // already recorded synchronously by the code that raised it, so the
        // event is purely informational. They must be ack'd explicitly: without
        // this, they fall through to the orphan branch below and get a 500,
        // which puts Stripe into a 24h exponential-retry storm on a charge that
        // actually succeeded.
        if (paymentIntent.metadata?.kind === 'service_area_second_charge') {
          console.log(`Webhook: payment_intent.succeeded for out-of-area pickup fee PI ${paymentIntent.id} (orderId ${paymentIntent.metadata.orderId}) — ack'd`)
          return NextResponse.json({ received: true, kind: 'service_area_second_charge' })
        }
        if (paymentIntent.metadata?.post_rental_charge_id) {
          console.log(`Webhook: payment_intent.succeeded for post-rental charge ${paymentIntent.metadata.post_rental_charge_id} (PI ${paymentIntent.id}) — ack'd`)
          return NextResponse.json({ received: true, kind: 'post_rental' })
        }
        if (paymentIntent.metadata?.serviceRequestId) {
          console.log(`Webhook: payment_intent.succeeded for service-trip invoice on SR ${paymentIntent.metadata.serviceRequestId} (PI ${paymentIntent.id}) — ack'd`)
          return NextResponse.json({ received: true, kind: 'service_request_invoice' })
        }

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

        // 'refunded' is excluded alongside 'succeeded': a re-delivered
        // payment_intent.succeeded for an order that has since been refunded
        // would otherwise flip it back to paid with a fresh paidAt while
        // refundedAt/refundId stay set, quietly un-refunding it in the admin
        // UI. Re-delivery is a live possibility whenever this endpoint starts
        // receiving events it previously missed.
        await prisma.order.updateMany({
          where: {
            paymentIntentId: paymentIntent.id,
            paymentStatus: { notIn: ['succeeded', 'refunded'] },
          },
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
          const assignedAgent = await resolveAssignedAgent({
            placedForAgentName: order.placedForAgentName,
            teamId: order.user.teamId,
          })
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
                // Pref gate — order recipient is the order's userId.
                recipientUserId: order.userId,
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
                assignedAgentName: assignedAgent?.name ?? null,
                assignedAgentPhone: assignedAgent?.phone ?? null,
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

        // Order-edit-diff branch — the diff PI is on order.lastEditPaymentIntentId,
        // not order.paymentIntentId. The sync edit-route catch already handles
        // off_session synchronous failures; this event covers any async/3DS
        // post-confirm failures. Flip editChargeStatus so the admin worklist
        // surfaces it. Don't touch order.paymentStatus or inventory — the
        // ORIGINAL order is unaffected.
        if (paymentIntent.metadata?.kind === 'order_edit_diff' && paymentIntent.metadata.orderId) {
          await prisma.order.updateMany({
            where: {
              id: paymentIntent.metadata.orderId,
              lastEditPaymentIntentId: paymentIntent.id,
            },
            data: {
              editChargeStatus: 'charge_failed',
              editChargeLastError: `Asynchronous Stripe failure: ${paymentIntent.last_payment_error?.message ?? 'unknown'}`,
            },
          })
          console.log(`Webhook: edit-diff PI ${paymentIntent.id} failed asynchronously — marked order ${paymentIntent.metadata.orderId} editChargeStatus=charge_failed`)
          break
        }

        // Only demote orders that haven't already settled. A single PI legally
        // emits payment_failed AND payment_intent.succeeded — a declined 3DS
        // attempt followed by a successful retry on the same PI, or an admin
        // re-confirming an existing PI with a different card. Stripe does not
        // guarantee delivery order and re-delivers on our 500s, so without this
        // the late failure event flips a genuinely PAID order to 'failed' AND
        // hands the customer's signs/riders/lockboxes back to inventory (the
        // restore below deliberately ignores this order's own state) while the
        // post is still scheduled for install. Mirrors the succeeded branch's
        // guard, which had it and this one didn't.
        const demoted = await prisma.order.updateMany({
          where: {
            paymentIntentId: paymentIntent.id,
            paymentStatus: { notIn: ['succeeded', 'refunded'] },
          },
          data: { paymentStatus: 'failed' },
        })

        // Restore any inventory that was marked out-of-storage at order creation
        // so a failed payment doesn't leave the customer's signs/riders locked.
        // Skipped entirely when nothing was demoted — otherwise a stale failure
        // event would strip inventory off an order that's already paid for.
        if (demoted.count > 0) {
          await restoreOrderInventory(paymentIntent.id, 'payment_failed', request)
        } else {
          console.log(`Webhook: payment_failed for PI ${paymentIntent.id} matched no unsettled order — inventory left alone`)
        }
        break
      }

      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent

        // Order-edit-diff: same logic as payment_failed but for explicit cancel.
        if (paymentIntent.metadata?.kind === 'order_edit_diff' && paymentIntent.metadata.orderId) {
          await prisma.order.updateMany({
            where: {
              id: paymentIntent.metadata.orderId,
              lastEditPaymentIntentId: paymentIntent.id,
            },
            data: {
              editChargeStatus: 'charge_failed',
              editChargeLastError: 'Edit-diff PaymentIntent canceled',
            },
          })
          console.log(`Webhook: edit-diff PI ${paymentIntent.id} canceled — marked order ${paymentIntent.metadata.orderId} editChargeStatus=charge_failed`)
          break
        }

        // Same settled-order guard as payment_failed above — a cancel event on
        // a PI that later succeeded (or was since refunded) must not cancel a
        // paid order out from under the customer or return its inventory.
        const cancelled = await prisma.order.updateMany({
          where: {
            paymentIntentId: paymentIntent.id,
            paymentStatus: { notIn: ['succeeded', 'refunded'] },
          },
          data: {
            paymentStatus: 'failed',
            status: 'cancelled',
          },
        })

        if (cancelled.count > 0) {
          await restoreOrderInventory(paymentIntent.id, 'canceled', request)
        } else {
          console.log(`Webhook: canceled for PI ${paymentIntent.id} matched no unsettled order — inventory left alone`)
        }
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

        // paymentIntentId is NOT unique — a cart batch shares one PI across
        // every order in it, and the invoice branch above stamps the invoice's
        // PI onto every bundled order. findFirst therefore used to reconcile
        // one arbitrary order and silently leave its siblings showing as paid
        // even though the whole charge had been refunded. Oldest-first just
        // makes the primary (the one that carries the email + cancel side
        // effects) deterministic; the refund columns are applied to all of
        // them below.
        const ordersOnCharge = await prisma.order.findMany({
          where: { paymentIntentId },
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        })
        const order = ordersOnCharge[0]
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

        // Siblings sharing this PI (cart batch / bundled invoice). The refund
        // covered the whole charge, so every order on it is refunded — carry
        // the same columns across rather than leaving them reading as paid.
        // refundedAmount stays on the primary only: splitting one charge-level
        // refund across N orders would be a guess, and the per-order figure is
        // what the admin credit tooling reads.
        const siblingIds = ordersOnCharge.slice(1).map((o) => o.id)
        if (siblingIds.length > 0) {
          await prisma.order.updateMany({
            where: { id: { in: siblingIds }, paymentStatus: { not: 'refunded' } },
            data: {
              paymentStatus: 'refunded',
              refundedAt: now,
              ...(dashboardInitiated
                ? { status: 'cancelled', cancelledAt: now, cancelReason: 'stripe_dashboard' }
                : {}),
            },
          })
          console.log(`Webhook charge.refunded: PI ${paymentIntentId} backs ${ordersOnCharge.length} orders — marked ${siblingIds.length} sibling(s) refunded alongside ${order.orderNumber}`)
        }

        if (dashboardInitiated) {
          for (const o of ordersOnCharge) {
            try {
              await releaseOrderHoldsAndRestoreInventory(
                o.id,
                'stripe_dashboard',
                { system: true },
                request,
              )
            } catch (err) {
              console.error(
                `Webhook charge.refunded: failed to release holds for order ${o.id}:`,
                err,
              )
            }
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
              // Pref gate — refund email is treated as order-confirmation traffic.
              recipientUserId: recipient.id,
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
