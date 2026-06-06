// Admin per-order opt-in toggle for post-rental billing. Flips
// Order.postRentalEnabledOverride — the ONLY way to bring a grandfathered
// (pre-rollout) order onto the rental schedule this round. No mass backfill;
// admin negotiates with relationship customers one order at a time.

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
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })
    }
    const enabled: boolean = body.enabled
    const reason: string | null = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null

    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, postRentalEnabledOverride: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const before = existing.postRentalEnabledOverride

    // No-op if value is unchanged — still 200 so client UI stays in sync,
    // but skip the audit row so toggle-spam doesn't fill the log.
    if (before === enabled) {
      return NextResponse.json({ success: true, enabled, changed: false })
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { postRentalEnabledOverride: enabled },
    })

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.PostRentalOverrideToggle,
      targetType: 'order',
      targetId: orderId,
      metadata: {
        orderNumber: existing.orderNumber,
        before,
        after: enabled,
        reason,
      },
      request,
    })

    return NextResponse.json({ success: true, enabled, changed: true })
  } catch (error) {
    console.error('Error toggling post-rental override:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
