// Admin per-order opt-OUT toggle for post-rental billing (CR2 / Round 22).
// Flips Order.postRentalDisabled — used when the agent supplied their own post,
// so PPI charges no recurring rental. Distinct from (and wins over) the
// grandfathered opt-IN override. Mirrors the override route's shape.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

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
    const body = await request.json().catch(() => ({}))
    if (typeof body?.disabled !== 'boolean') {
      return NextResponse.json({ error: 'disabled (boolean) is required' }, { status: 400 })
    }
    const disabled: boolean = body.disabled
    const reason: string | null = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null

    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, postRentalDisabled: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const before = existing.postRentalDisabled

    // No-op if unchanged — still 200 so client UI stays in sync, but skip the
    // audit row so toggle-spam doesn't fill the log.
    if (before === disabled) {
      return NextResponse.json({ success: true, disabled, changed: false })
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { postRentalDisabled: disabled },
    })

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.PostRentalDisableToggle,
      targetType: 'order',
      targetId: orderId,
      metadata: {
        orderNumber: existing.orderNumber,
        before,
        after: disabled,
        reason,
      },
      request,
    })

    return NextResponse.json({ success: true, disabled, changed: true })
  } catch (error) {
    console.error('Error toggling post-rental disable:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
