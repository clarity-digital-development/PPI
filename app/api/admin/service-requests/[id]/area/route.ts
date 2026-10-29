// Admin: tag a service request with its crew area (Ryan, 2026-10-29), the
// same internal-only tag orders have (app/api/admin/orders/[id]/area). Only
// needed when the request's order has no area or the trip has no order; the
// list follows the order's area otherwise. Never emails the customer.
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

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    // null / '' clears the tag, so the request follows its order's area again.
    const raw = body?.area
    const area = raw === null || raw === '' ? null : raw
    if (area !== null && !isOrderArea(area)) {
      return NextResponse.json({ error: 'Unknown area' }, { status: 400 })
    }

    const existing = await prisma.serviceRequest.findUnique({
      where: { id },
      select: { id: true, area: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Service request not found' }, { status: 404 })
    }
    if (existing.area === area) {
      return NextResponse.json({ success: true, area })
    }

    await prisma.serviceRequest.update({ where: { id }, data: { area } })

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.ServiceRequestAreaSet,
      targetType: 'service_request',
      targetId: id,
      metadata: { from: existing.area, to: area },
      request,
    })

    return NextResponse.json({ success: true, area })
  } catch (error) {
    console.error('Error setting service request area:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
