// Admin: tag an order with its crew area (Ryan, 2026-10-05). Deliberately its
// own route rather than the order PUT, which emails the customer on status
// changes — an area is internal bookkeeping and must never reach them.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { isOrderArea } from '@/lib/orders/areas'

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
    // null / '' clears the tag.
    const raw = body?.area
    const area = raw === null || raw === '' ? null : raw
    if (area !== null && !isOrderArea(area)) {
      return NextResponse.json({ error: 'Unknown area' }, { status: 400 })
    }

    const existing = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, area: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (existing.area === area) {
      return NextResponse.json({ success: true, area })
    }

    await prisma.order.update({ where: { id: orderId }, data: { area } })

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.OrderAreaSet,
      targetType: 'order',
      targetId: orderId,
      metadata: { orderNumber: existing.orderNumber, from: existing.area, to: area },
      request,
    })

    return NextResponse.json({ success: true, area })
  } catch (error) {
    console.error('Error setting order area:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
