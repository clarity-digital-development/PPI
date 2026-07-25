// Admin "Charge" retry for a failed second out-of-area charge. Immediate
// synchronous attempt (unlike the post-rental cron-based retry) — this is a
// one-shot fee, not a recurring series, so there's no cron pass to defer to.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { chargeSecondOutOfAreaFee } from '@/lib/orders/out-of-area-charge'

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

    const { id: orderId } = await params
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, serviceAreaSecondChargeStatus: true, serviceAreaSecondChargeError: true },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (order.serviceAreaSecondChargeStatus !== 'failed') {
      return NextResponse.json(
        { error: `Only a failed charge can be retried (status: ${order.serviceAreaSecondChargeStatus ?? 'none'})` },
        { status: 409 }
      )
    }

    // Conditional flip back to 'pending' — guards against a double-click
    // racing two retries. chargeSecondOutOfAreaFee only acts on 'pending'.
    const flipped = await prisma.order.updateMany({
      where: { id: orderId, serviceAreaSecondChargeStatus: 'failed' },
      data: { serviceAreaSecondChargeStatus: 'pending', serviceAreaSecondChargeError: null },
    })
    if (flipped.count === 0) {
      return NextResponse.json(
        { error: 'Charge state changed during retry — refresh and try again' },
        { status: 409 }
      )
    }

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.ServiceAreaSecondChargeRetry,
      targetType: 'order',
      targetId: orderId,
      metadata: { previousError: order.serviceAreaSecondChargeError },
      request,
    })

    await chargeSecondOutOfAreaFee(orderId)

    const updated = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        serviceAreaSecondChargeStatus: true,
        serviceAreaSecondChargeError: true,
        serviceAreaSecondChargePaymentIntentId: true,
        serviceAreaSecondChargedAt: true,
      },
    })

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('Error retrying out-of-area second charge:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
