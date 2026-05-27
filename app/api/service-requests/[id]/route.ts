import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

// Statuses a customer is allowed to edit. Once a request is in_progress,
// completed, or cancelled it can no longer be edited by the customer.
const EDITABLE_STATUSES = ['pending', 'acknowledged', 'scheduled']

// PATCH - Customer edits or cancels their OWN service request.
// Ownership is enforced via findFirst({ where: { id, userId: user.id } }):
// a request that isn't theirs simply won't be found (404).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { requested_date, notes, description, cancel } = body

    // Load only if it belongs to this user — enforces ownership.
    const existing = await prisma.serviceRequest.findFirst({
      where: { id, userId: user.id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Service request not found' }, { status: 404 })
    }

    // Cancel flow
    if (cancel === true) {
      if (existing.status === 'completed' || existing.status === 'cancelled') {
        return NextResponse.json(
          { error: 'This request can no longer be cancelled' },
          { status: 400 }
        )
      }

      const cancelled = await prisma.serviceRequest.update({
        where: { id },
        data: { status: 'cancelled' },
        include: {
          installation: {
            select: {
              id: true,
              propertyAddress: true,
              propertyCity: true,
              propertyState: true,
              propertyZip: true,
              status: true,
            },
          },
        },
      })

      return NextResponse.json({ serviceRequest: cancelled })
    }

    // Edit flow — only allowed while the request is still active.
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      return NextResponse.json(
        { error: 'This request can no longer be edited' },
        { status: 400 }
      )
    }

    // Update only the fields the customer is allowed to change. Status (other
    // than cancel), adminNotes, and invoice fields are intentionally untouched.
    const updateData: any = {}

    if (requested_date !== undefined) {
      // Store at noon UTC so the calendar date is stable across timezones
      // (mirrors POST /api/service-requests and the admin PUT).
      updateData.requestedDate = requested_date
        ? new Date(requested_date + 'T12:00:00Z')
        : null
    }

    if (notes !== undefined) {
      updateData.notes = notes
    }

    if (description !== undefined) {
      updateData.description = description
    }

    const updated = await prisma.serviceRequest.update({
      where: { id },
      data: updateData,
      include: {
        installation: {
          select: {
            id: true,
            propertyAddress: true,
            propertyCity: true,
            propertyState: true,
            propertyZip: true,
            status: true,
          },
        },
      },
    })

    return NextResponse.json({ serviceRequest: updated })
  } catch (error) {
    console.error('Error updating service request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
