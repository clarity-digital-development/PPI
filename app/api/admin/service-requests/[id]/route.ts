import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { createServiceRequestNotification } from '@/lib/notifications'

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

    const serviceRequest = await prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            phone: true,
            company: true,
          },
        },
        installation: {
          include: {
            order: {
              include: {
                postType: true,
              },
            },
            riders: {
              include: { rider: true },
            },
            lockboxes: {
              include: { lockboxType: true },
            },
          },
        },
      },
    })

    if (!serviceRequest) {
      return NextResponse.json({ error: 'Service request not found' }, { status: 404 })
    }

    return NextResponse.json({ serviceRequest })
  } catch (error) {
    console.error('Error fetching service request:', error)
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
    const { status, admin_notes, scheduled_date } = body

    const serviceRequest = await prisma.serviceRequest.findUnique({
      where: { id },
    })

    if (!serviceRequest) {
      return NextResponse.json({ error: 'Service request not found' }, { status: 404 })
    }

    // Prepare update data
    const updateData: any = {}

    if (status) {
      const validStatuses = ['pending', 'acknowledged', 'scheduled', 'in_progress', 'completed', 'cancelled']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      updateData.status = status

      // Set completedAt when marking as completed
      if (status === 'completed') {
        updateData.completedAt = new Date()
      }
    }

    if (admin_notes !== undefined) {
      updateData.adminNotes = admin_notes
    }

    if (scheduled_date) {
      // Noon UTC to keep the calendar date stable across timezones
      updateData.requestedDate = new Date(scheduled_date + 'T12:00:00Z')
      if (!status) {
        updateData.status = 'scheduled'
      }
    }

    const updated = await prisma.serviceRequest.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        installation: {
          select: {
            id: true,
            propertyAddress: true,
            propertyCity: true,
            propertyState: true,
            propertyZip: true,
          },
        },
      },
    })

    // If it's a removal request being completed AND it's tied to an existing
    // installation, mark that installation as removed. Unlisted-address
    // requests have no installationId, so we skip.
    if (status === 'completed' && serviceRequest.type === 'removal' && serviceRequest.installationId) {
      await prisma.installation.update({
        where: { id: serviceRequest.installationId },
        data: {
          status: 'removed',
          removedAt: new Date(),
        },
      })
    }

    // Create notification for status change
    const notifiableStatuses = ['acknowledged', 'scheduled', 'completed']
    if (status && notifiableStatuses.includes(status)) {
      try {
        const address = updated.installation
          ? `${updated.installation.propertyAddress}, ${updated.installation.propertyCity}`
          : updated.unlistedAddress
            ? `${updated.unlistedAddress}, ${updated.unlistedCity}`
            : '(unlisted address)'
        await createServiceRequestNotification(updated.userId, address, status)
      } catch (notifError) {
        console.error('Error creating notification:', notifError)
      }
    }

    return NextResponse.json({ serviceRequest: updated })
  } catch (error) {
    console.error('Error updating service request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
