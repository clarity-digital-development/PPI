import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { stripe, getStripeErrorMessage } from '@/lib/stripe/server'
import { releaseOrderHoldsAndRestoreInventory } from '@/lib/inventory-holds'
import { audit, AuditAction } from '@/lib/audit'

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

    // Atomic claim BEFORE doing any Stripe/inventory work — closes the race
    // against the customer-facing pending_invoice cancel (lib/refunds.ts
    // cancelUnpaidOrder), which didn't exist before that path was added
    // (Ryan, 2026-07-17). Without this, a customer cancelling first and an
    // admin's already-loaded page cancelling moments later would both
    // "succeed": harmless in practice (Stripe cancel/inventory restore are
    // guarded/idempotent) but writes a duplicate audit log entry and shows
    // the admin a false "Order cancelled" success message for an action
    // that already happened.
    const claimed = await prisma.order.updateMany({
      where: { id, status: { not: 'cancelled' }, paymentStatus: { not: 'succeeded' } },
      data: { status: 'cancelled', paymentStatus: 'failed' },
    })

    if (claimed.count === 0) {
      const existing = await prisma.order.findUnique({ where: { id }, select: { status: true, paymentStatus: true } })
      if (existing?.status === 'cancelled') {
        return NextResponse.json({ error: 'Order already cancelled' }, { status: 409 })
      }
      if (existing?.paymentStatus === 'succeeded') {
        return NextResponse.json(
          { error: 'Cannot cancel a paid order from here. Refund it from Stripe first.' },
          { status: 400 }
        )
      }
      return NextResponse.json({ error: 'Order is not in a cancellable state' }, { status: 409 })
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

    // Guarded inventory restore + consumed-hold cleanup (won't clobber a
    // successful re-allocation)
    try {
      await releaseOrderHoldsAndRestoreInventory(
        order.id,
        'admin_cancel',
        { id: user.id, email: user.email, role: user.role },
        request
      )
    } catch (invErr) {
      console.error('Could not restore inventory:', invErr)
      // Continue with cancellation
    }

    // The atomic claim above already wrote status/paymentStatus — no need for
    // a second update. Build the response from the pre-claim `order` fetch
    // (only those two fields changed).
    const updatedOrder = { ...order, status: 'cancelled', paymentStatus: 'failed' }

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.OrderCancel,
      targetType: 'order',
      targetId: order.id,
      metadata: { reason: 'admin_cancel', stripeCancelled },
      request,
    })

    return NextResponse.json({
      success: true,
      order: updatedOrder,
      stripe_cancelled: stripeCancelled,
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
