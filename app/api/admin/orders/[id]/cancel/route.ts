import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { stripe, getStripeErrorMessage } from '@/lib/stripe/server'

/**
 * Admin: Cancel a stuck/unpaid order.
 *
 * - Cancels the Stripe PaymentIntent if it's in a cancellable state (so it
 *   stops sitting around in `requires_action` or `requires_payment_method`)
 * - Restores any inventory items that were marked out-of-storage by this order
 *   (only happens for orders created before the inventory-defer change; new
 *   orders only lock inventory on payment_intent.succeeded)
 * - Marks the order as `status: cancelled`, `paymentStatus: failed`
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const order = await prisma.order.findUnique({
      where: { id },
      include: { orderItems: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.paymentStatus === 'succeeded') {
      return NextResponse.json(
        { error: 'Cannot cancel a paid order from here. Refund it from Stripe first.' },
        { status: 400 }
      )
    }

    // Cancel Stripe PaymentIntent if present and in a cancellable state
    const cancellable = ['requires_payment_method', 'requires_capture', 'requires_confirmation', 'requires_action', 'processing']
    let stripeCancelled = false
    if (order.paymentIntentId) {
      try {
        const pi = await stripe().paymentIntents.retrieve(order.paymentIntentId)
        if (cancellable.includes(pi.status)) {
          await stripe().paymentIntents.cancel(order.paymentIntentId)
          stripeCancelled = true
        }
      } catch (stripeErr) {
        console.error('Could not cancel Stripe PI:', stripeErr)
        // Don't block the order cancellation if Stripe call fails
      }
    }

    // Restore any inventory items linked to this order (in case the old code
    // path locked them before payment confirmed)
    const inventoryRestores: Promise<unknown>[] = []
    for (const item of order.orderItems) {
      if (item.customerSignId) {
        inventoryRestores.push(
          prisma.customerSign.update({ where: { id: item.customerSignId }, data: { inStorage: true } })
        )
      }
      if (item.customerRiderId) {
        inventoryRestores.push(
          prisma.customerRider.update({ where: { id: item.customerRiderId }, data: { inStorage: true } })
        )
      }
      if (item.customerLockboxId) {
        inventoryRestores.push(
          prisma.customerLockbox.update({ where: { id: item.customerLockboxId }, data: { inStorage: true } })
        )
      }
      if (item.customerBrochureBoxId) {
        inventoryRestores.push(
          prisma.customerBrochureBox.update({ where: { id: item.customerBrochureBoxId }, data: { inStorage: true } })
        )
      }
    }
    if (inventoryRestores.length > 0) {
      try {
        await Promise.all(inventoryRestores)
      } catch (invErr) {
        console.error('Could not restore inventory:', invErr)
        // Continue with cancellation
      }
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'cancelled',
        paymentStatus: 'failed',
      },
    })

    return NextResponse.json({
      success: true,
      order: updatedOrder,
      stripe_cancelled: stripeCancelled,
      inventory_restored: inventoryRestores.length,
    })
  } catch (error) {
    console.error('Error cancelling order:', error)
    const message = getStripeErrorMessage(error)
    return NextResponse.json(
      { error: message || 'Could not cancel the order. Please try again.' },
      { status: 500 }
    )
  }
}
