import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { validateScheduling } from '@/lib/scheduling'

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

    if (body.scheduled_date) {
      // Same business rules apply to admin-initiated schedule changes —
      // support can't "fix a date" past the 4pm cutoff via this route.
      // Override escape hatch: pass override_schedule: true (logged
      // implicitly via the order update — caller is admin-gated above).
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
