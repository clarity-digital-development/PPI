import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { refundOrder, cancelPaidOrderWithoutRefund } from '@/lib/refunds'

/**
 * Admin: cancel/refund a paid order. One deliberate path with three choices
 * (Ryan, 2026-11-09 — a paid order cancelled from the status dropdown was
 * never refunded and turned into a bank dispute):
 *
 *   refund: 'full'    — refund the whole order (default; previous behavior)
 *   refund: 'partial' — refund `amount` dollars (0 < amount < order total)
 *   refund: 'none'    — cancel and keep the payment
 *
 * Works on an order that's already cancelled but was never refunded (the
 * old dropdown left those behind), so the admin can still refund it.
 * paymentStatus flips for full refunds are owned by the charge.refunded
 * webhook (single source of truth).
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

    let body: { reason?: unknown; refund?: unknown; amount?: unknown } = {}
    try {
      body = (await request.json()) as typeof body
    } catch {
      body = {}
    }
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : null
    const mode = body.refund === undefined ? 'full' : body.refund
    if (mode !== 'full' && mode !== 'partial' && mode !== 'none') {
      return NextResponse.json({ error: 'Choose full, partial or no refund' }, { status: 400 })
    }

    const order = await prisma.order.findUnique({ where: { id } })
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.refundId || order.refundInitiatedAt || order.paymentStatus === 'refunded') {
      return NextResponse.json(
        { error: 'Order has already been refunded' },
        { status: 409 }
      )
    }
    if (order.paymentStatus !== 'succeeded') {
      return NextResponse.json(
        { error: 'Only paid orders can be refunded' },
        { status: 409 }
      )
    }

    const actor = { id: user.id, email: user.email, role: user.role }

    if (mode !== 'none') {
      if (!order.paymentIntentId) {
        return NextResponse.json(
          { error: "There's no card payment on this order to refund. Pick No refund to cancel it." },
          { status: 409 }
        )
      }
      // A cart checkout charges several orders in ONE PaymentIntent. Stripe
      // can't refund "this order" out of it here: a full refund returns the
      // whole cart, and the charge.refunded webhook reconciles by
      // PaymentIntent, so it can't attribute a partial to one order either.
      const onCharge = await prisma.order.count({ where: { paymentIntentId: order.paymentIntentId } })
      if (onCharge > 1) {
        return NextResponse.json(
          {
            error: `This order was paid in one card charge together with ${onCharge - 1} other order${onCharge > 2 ? 's' : ''}, so refunding it here would refund all of them. Cancel it with No refund, then refund this order's $${Number(order.total).toFixed(2)} by hand in Stripe.`,
          },
          { status: 409 }
        )
      }
    }

    if (mode === 'none') {
      const result = await cancelPaidOrderWithoutRefund(id, { note: reason, actor, request })
      if (!result.ok) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: 409 })
      }
      return NextResponse.json({ success: true, refunded: false })
    }

    let amountCents: number | undefined
    if (mode === 'partial') {
      const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount)
      const totalCents = Math.round(Number(order.total) * 100)
      const cents = Math.round(amount * 100)
      if (!Number.isFinite(amount) || cents <= 0) {
        return NextResponse.json({ error: 'Enter a refund amount above $0' }, { status: 400 })
      }
      if (cents >= totalCents) {
        return NextResponse.json(
          { error: `A partial refund has to be less than the order total ($${(totalCents / 100).toFixed(2)}). Use Full refund instead.` },
          { status: 400 }
        )
      }
      amountCents = cents
    }

    const result = await refundOrder(id, {
      reason: 'admin_cancel',
      customerReason: reason,
      actor,
      request,
      auto: false,
      ...(amountCents !== undefined ? { amountCents } : {}),
    })

    if (!result.ok) {
      const status =
        result.code === 'ALREADY_REFUNDED'
          ? 409
          : result.code === 'NOT_REFUNDABLE'
            ? 409
            : 502
      return NextResponse.json({ error: result.error, code: result.code }, { status })
    }

    return NextResponse.json({
      success: true,
      refunded: true,
      refundId: result.refundId,
      amountCents: result.amountCents,
      emailed: result.emailed,
    })
  } catch (error) {
    console.error('Error issuing admin refund:', error)
    return NextResponse.json(
      { error: 'Could not issue the refund. Please try again.' },
      { status: 500 }
    )
  }
}
