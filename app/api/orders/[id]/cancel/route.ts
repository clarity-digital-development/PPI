import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { refundOrder, cancelUnpaidOrder, CLICK_THROUGH_THRESHOLD_CENTS } from '@/lib/refunds'
import { easternMidnightMs } from '@/lib/scheduling'

/**
 * Customer-initiated order cancel.
 *
 * Paid orders (paymentStatus='succeeded') get a full refund — see the
 * high-value / Stripe notes below. Invoice-billing orders
 * (paymentStatus='pending_invoice') were never charged, so they skip the
 * refund flow entirely and just cancel (Ryan, 2026-07-17: invoice-billing
 * customers had no self-service way to cancel a pending order at all —
 * the only paths were "contact support" or wait for an admin).
 *
 * High-value PAID orders (>= $250) require a 2-step confirm flow handled
 * client-side: the first POST returns 409 { requiresConfirmation }, the
 * client shows a modal, and a second POST with { confirmed: true } executes.
 * Not applicable to the no-refund path — there's no dollar amount moving.
 *
 * Refunds are full-only (locked decision). The 24h cancellation window is
 * computed at UTC midnight of scheduledDate for safety. Next-Available orders
 * (scheduledDate null) skip the cutoff.
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

    const { id } = await params

    const body = await request.json().catch(() => ({}))
    const confirmed: boolean = body?.confirmed === true
    const rawReason: unknown = body?.reason
    const customerReason: string | null =
      typeof rawReason === 'string' && rawReason.trim().length > 0
        ? rawReason.slice(0, 500)
        : null

    const order = await prisma.order.findUnique({
      where: { id },
      include: { user: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.userId !== user.id && order.placedByUserId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const blockedStatuses = ['in_progress', 'completed', 'cancelled']
    if (blockedStatuses.includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot cancel an order in status: ${order.status}` },
        { status: 409 }
      )
    }

    // Eastern midnight (NOT UTC midnight) — the crew dispatches in Eastern
    // time, so the customer's "24 hours before the install day" is measured
    // against ET, not UTC. Previously this used UTC midnight and customers
    // in EDT lost ~4 hours of their cancellation window. Shared by both the
    // pending_invoice and succeeded paths below (each checks it separately so
    // the pre-existing paymentStatus-rejection precedence for every OTHER
    // paymentStatus — pending/processing/failed/refunded — stays exactly
    // where it was: immediately after blockedStatuses, before any cutoff
    // check runs).
    const pastCutoff = (): boolean => {
      if (!order.scheduledDate) return false
      const cutoff = easternMidnightMs(new Date(order.scheduledDate)) - 24 * 60 * 60 * 1000
      return Date.now() > cutoff
    }

    if (order.paymentStatus === 'pending_invoice') {
      if (pastCutoff()) {
        return NextResponse.json(
          { error: 'Cancellation window closed (must cancel at least 24 hours before install date)' },
          { status: 409 }
        )
      }

      const result = await cancelUnpaidOrder(order.id, {
        reason: 'customer_cancel',
        customerReason,
        actor: { id: user.id, email: user.email, role: user.role },
        request,
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 409 })
      }

      return NextResponse.json({ success: true, refunded: false })
    }

    if (order.paymentStatus !== 'succeeded') {
      return NextResponse.json(
        { error: 'Order is not paid; contact support to cancel' },
        { status: 409 }
      )
    }

    if (order.refundId) {
      // refundId being non-null is the durable marker that a refund has been
      // initiated — paymentStatus may still be 'succeeded' briefly if the
      // charge.refunded webhook hasn't reconciled yet.
      return NextResponse.json({ error: 'Order already refunded' }, { status: 409 })
    }

    if (pastCutoff()) {
      return NextResponse.json(
        { error: 'Cancellation window closed (must cancel at least 24 hours before install date)' },
        { status: 409 }
      )
    }

    const totalCents = Math.round(Number(order.total) * 100)
    const isHighValue = totalCents >= CLICK_THROUGH_THRESHOLD_CENTS

    if (isHighValue && !confirmed) {
      const amount = Number(order.total)
      return NextResponse.json(
        {
          requiresConfirmation: true,
          amount,
          message: `This will refund $${amount.toFixed(2)} to your original payment method. Refunds take 5-10 business days. Please confirm to proceed.`,
        },
        { status: 409 }
      )
    }

    const result = await refundOrder(order.id, {
      reason: 'customer_cancel',
      customerReason,
      actor: { id: user.id, email: user.email, role: user.role },
      request,
      auto: !isHighValue,
    })

    if (!result.ok) {
      if (result.code === 'STRIPE_ERROR') {
        return NextResponse.json(
          { error: result.error, code: 'STRIPE_ERROR' },
          { status: 502 }
        )
      }
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: 409 }
      )
    }

    return NextResponse.json({
      success: true,
      refunded: true,
      refundId: result.refundId,
      amount: result.amountCents / 100,
      emailed: result.emailed,
    })
  } catch (error) {
    console.error('Error cancelling order:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
