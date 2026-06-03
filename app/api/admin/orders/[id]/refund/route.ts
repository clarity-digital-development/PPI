import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { refundOrder } from '@/lib/refunds'

/**
 * Admin: Issue a full refund on a paid order (e.g. crew couldn't make it,
 * customer called in). No 24h cutoff and no double-confirm — admin path is
 * always deliberate. paymentStatus flip is owned by the charge.refunded
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

    let body: { reason?: string } = {}
    try {
      body = (await request.json()) as { reason?: string }
    } catch {
      body = {}
    }
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : null

    const order = await prisma.order.findUnique({ where: { id } })
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (order.refundId || order.paymentStatus === 'refunded') {
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

    const result = await refundOrder(id, {
      reason: 'admin_cancel',
      customerReason: reason,
      actor: { id: user.id, email: user.email, role: user.role },
      request,
      auto: false,
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
