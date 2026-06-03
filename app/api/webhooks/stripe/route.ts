import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe/server'
import { prisma } from '@/lib/prisma'
import { sendOrderConfirmationEmail, sendAdminOrderNotification } from '@/lib/email'
import { releaseOrderHoldsAndRestoreInventory } from '@/lib/inventory-holds'

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
          console.error('No orders found for payment intent:', paymentIntent.id)
          break
        }

        await prisma.order.updateMany({
          where: { paymentIntentId: paymentIntent.id, paymentStatus: { not: 'succeeded' } },
          data: { paymentStatus: 'succeeded', paidAt: new Date() },
        })

        // Send one confirmation + admin email per order in the batch
        for (const o of existingOrders) {
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
              }),
            ])
          } catch (emailError) {
            console.error(`Webhook: Error sending emails for order ${order.orderNumber}:`, emailError)
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

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
