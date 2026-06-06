import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { validateScheduling } from '@/lib/scheduling'
import { audit, AuditAction } from '@/lib/audit'

export async function GET(
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
      include: {
        orderItems: true,
        postType: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            stripeCustomerId: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    return NextResponse.json({ order })
  } catch (error) {
    console.error('Error fetching order:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
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
    const body = await request.json()

    const updateData: Record<string, any> = {}

    if (body.status) {
      updateData.status = body.status
    }

    if (body.payment_status) {
      updateData.paymentStatus = body.payment_status
    }

    // propertyZip override on admin edit. The service-area gate is NOT
    // re-applied — admins are trusted to override intentionally — but we log a
    // WARN audit when the customer is non-exempt so there's a paper trail of
    // who pushed an order outside the normal coverage rules.
    if (typeof body.property_zip === 'string' && body.property_zip.trim()) {
      const newZip = body.property_zip.trim().slice(0, 5)
      const existing = await prisma.order.findUnique({
        where: { id },
        select: {
          propertyZip: true,
          user: { select: { id: true, role: true, isServiceAreaExempt: true } },
        },
      })
      if (existing && existing.propertyZip !== newZip) {
        const owner = existing.user
        const isExempt = owner.role === 'team_admin' || owner.isServiceAreaExempt
        if (!isExempt) {
          await audit({
            actor: { id: user.id, email: user.email, role: user.role },
            action: AuditAction.ServiceAreaBlock, // WARN: admin override on non-exempt user's ZIP
            targetType: 'order',
            targetId: id,
            metadata: {
              warn: 'admin_zip_override_no_regate',
              from: existing.propertyZip,
              to: newZip,
              ownerUserId: owner.id,
            },
            request,
          })
        }
        updateData.propertyZip = newZip
      }
    }

    if (body.scheduled_date) {
      // Same business rules apply to admin-initiated schedule changes —
      // support can't "fix a date" past the 4pm cutoff via this route.
      // Override escape hatch: pass override_schedule: true. Override use
      // is audit-logged below so there's a paper trail of who bypassed
      // the cutoff for which order.
      if (!body.override_schedule) {
        const dateStr =
          typeof body.scheduled_date === 'string' && body.scheduled_date.length >= 10
            ? body.scheduled_date.slice(0, 10)
            : null
        const scheduleCheck = validateScheduling({ requestedDate: dateStr, isExpedited: false })
        if (!scheduleCheck.ok) {
          return NextResponse.json(
            { error: scheduleCheck.error, code: scheduleCheck.code },
            { status: 400 }
          )
        }
      } else {
        await audit({
          actor: { id: user.id, email: user.email, role: user.role },
          action: AuditAction.OrderCancel, // reusing as 'order admin op'; no dedicated 'order.schedule_override' yet
          targetType: 'order',
          targetId: id,
          metadata: {
            action: 'schedule_override',
            new_scheduled_date: body.scheduled_date,
            override_reason: typeof body.override_reason === 'string' ? body.override_reason.slice(0, 500) : null,
          },
          request,
        })
      }
      updateData.scheduledDate = new Date(body.scheduled_date)
    }

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        orderItems: true,
        postType: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    })

    return NextResponse.json({ order })
  } catch (error) {
    console.error('Error updating order:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
