import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { validateScheduling } from '@/lib/scheduling'
import { audit, AuditAction } from '@/lib/audit'

/**
 * Narrow, invoice-safe reschedule — changes ONLY Order.scheduledDate. No item
 * or pricing recompute, no invoice-status block. Per Ryan: invoices bundle
 * orders by CREATION date (see app/api/admin/invoices/route.ts), not install
 * date, so moving an already-invoiced order's install date can't desync a
 * past or future invoice. The full edit wizard (PATCH /api/orders/[id]/edit)
 * stays blocked for invoiced orders since IT touches pricing/items — this
 * route exists precisely so a date-only change doesn't have to go through
 * that block.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Same owner-OR-admin(-OR-team_admin-on-behalf) gate as the full edit route.
  const existingOrder = await prisma.order.findFirst({
    where:
      user.role === 'admin'
        ? { id }
        : user.role === 'team_admin'
          ? { id, OR: [{ userId: user.id }, { placedByUserId: user.id }] }
          : { id, userId: user.id },
    select: { id: true, orderNumber: true, status: true, scheduledDate: true, invoiceId: true },
  })
  if (!existingOrder) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (existingOrder.status === 'completed' || existingOrder.status === 'cancelled') {
    return NextResponse.json(
      { error: 'Cannot reschedule a completed or cancelled order' },
      { status: 400 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const dateStr =
    typeof body.requested_date === 'string' && body.requested_date.length >= 10
      ? body.requested_date.slice(0, 10)
      : null
  if (!dateStr) {
    return NextResponse.json({ error: 'requested_date is required' }, { status: 400 })
  }

  // Same scheduling rules as any other date change (cutoff, blackout, etc).
  // Only admins get the override escape hatch — mirrors PUT /api/admin/orders/[id].
  const canOverride = user.role === 'admin' && !!body.override_schedule
  if (!canOverride) {
    const scheduleCheck = validateScheduling({ requestedDate: dateStr, isExpedited: false })
    if (!scheduleCheck.ok) {
      return NextResponse.json({ error: scheduleCheck.error, code: scheduleCheck.code }, { status: 400 })
    }
  }

  // Noon UTC (not midnight) — matches every other write path (order create,
  // full edit route) so a date-only field can't shift a day in US timezones.
  const updated = await prisma.order.update({
    where: { id },
    data: { scheduledDate: new Date(dateStr + 'T12:00:00Z') },
    select: { id: true, orderNumber: true, scheduledDate: true },
  })

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.OrderEdit,
    targetType: 'order',
    targetId: id,
    metadata: {
      action: 'reschedule_only',
      fromDate: existingOrder.scheduledDate?.toISOString() ?? null,
      toDate: updated.scheduledDate?.toISOString() ?? null,
      wasInvoiced: !!existingOrder.invoiceId,
      override: canOverride,
    },
    request,
  })

  return NextResponse.json({ order: updated })
}
