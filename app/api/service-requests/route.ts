import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { createNotification } from '@/lib/notifications'
import { sendAdminServiceRequestNotification } from '@/lib/email'

// POST - Create a service request for an unlisted address
// This is used when the system doesn't show an existing installation
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { type, description, requested_date, notes, address } = body

    if (!type || !description) {
      return NextResponse.json(
        { error: 'Type and description are required' },
        { status: 400 }
      )
    }

    // Try to attach this request to an existing installation at the same address.
    // If we can't find one and the customer supplied an address, we create a
    // standalone (unlisted-address) request — admin sees the address fields
    // directly on the request. This is how same-day pickups from places we've
    // never been to get scheduled.
    let installation = null
    if (address) {
      installation = await prisma.installation.findFirst({
        where: {
          userId: user.id,
          propertyAddress: { contains: address.street, mode: 'insensitive' },
          propertyCity: { contains: address.city, mode: 'insensitive' },
        },
      })
    }

    if (!installation && !address) {
      // No address provided AND no installation — we'd have nowhere to send anyone.
      return NextResponse.json(
        { error: 'Please provide an address for this trip.' },
        { status: 400 }
      )
    }

    // Build a readable description including the address for admin's reference
    const addressLine = address
      ? `${address.street}, ${address.city}, ${address.state} ${address.zip}`
      : null
    const fullDescription = addressLine && !installation
      ? `${description}\n\n[Unlisted Address: ${addressLine}]`
      : description

    const serviceRequest = await prisma.serviceRequest.create({
      data: {
        installationId: installation?.id ?? null,
        userId: user.id,
        type: type as any,
        description: fullDescription,
        // Store at noon UTC so admin sees the same calendar date the customer picked,
        // regardless of timezone (matches the order-creation fix in /api/orders)
        requestedDate: requested_date ? new Date(requested_date + 'T12:00:00Z') : null,
        notes: notes || null,
        // Persist the unlisted address on the request itself so admin can see
        // and act on it without parsing it out of the description string
        unlistedAddress: !installation && address ? address.street : null,
        unlistedCity:    !installation && address ? address.city : null,
        unlistedState:   !installation && address ? address.state : null,
        unlistedZip:     !installation && address ? address.zip : null,
      },
      include: {
        installation: {
          select: {
            propertyAddress: true,
            propertyCity: true,
          },
        },
      },
    })

    // Create notification for the user
    await createNotification({
      userId: user.id,
      type: 'service_request_acknowledged',
      title: 'Service Request Submitted',
      message: `Your ${type} request has been submitted and will be reviewed.`,
      link: '/dashboard/service-requests',
    })

    // Send admin email notification
    try {
      const userInfo = await prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true, name: true, email: true, phone: true },
      })
      const customerName = userInfo?.fullName || userInfo?.name || userInfo?.email || 'Unknown'
      const emailAddress = installation
        ? `${installation.propertyAddress}, ${installation.propertyCity}, ${installation.propertyState} ${installation.propertyZip}`
        : addressLine
          ? `${addressLine} (unlisted)`
          : '(no address)'

      // For removal at an existing installation, include what was originally installed
      let installedItems: string | undefined
      if (type === 'removal' && installation) {
        const originalOrder = await prisma.order.findFirst({
          where: { id: installation.orderId },
          include: { orderItems: { select: { description: true, quantity: true } } },
        })
        if (originalOrder?.orderItems?.length) {
          installedItems = originalOrder.orderItems
            .map(i => `  - ${i.description}${i.quantity > 1 ? ` (×${i.quantity})` : ''}`)
            .join('\n')
        }
      }

      await sendAdminServiceRequestNotification({
        customerName,
        customerEmail: userInfo?.email,
        customerPhone: userInfo?.phone ?? undefined,
        requestType: type,
        description: description || undefined,
        requestedDate: requested_date || undefined,
        notes: notes || undefined,
        installationAddress: emailAddress,
        installedItems,
      })
    } catch (emailError) {
      console.error('Failed to send admin service request notification:', emailError)
    }

    return NextResponse.json({
      serviceRequest: {
        id: serviceRequest.id,
        type: serviceRequest.type,
        status: serviceRequest.status,
        description: serviceRequest.description,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating service request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Fetch only this user's service requests
    let serviceRequests: any[] = []

    try {
      serviceRequests = await prisma.serviceRequest.findMany({
        where: {
          userId: user.id,
          ...(status ? { status: status as any } : {}),
        },
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
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      })
    } catch {
      // Table may not exist yet
      serviceRequests = []
    }

    // Count by status for this user
    let statusCounts: Record<string, number> = {}
    try {
      const counts = await prisma.serviceRequest.groupBy({
        by: ['status'],
        where: { userId: user.id },
        _count: true,
      })
      statusCounts = counts.reduce((acc, item) => {
        acc[item.status] = item._count
        return acc
      }, {} as Record<string, number>)
    } catch {
      statusCounts = {}
    }

    return NextResponse.json({
      serviceRequests: serviceRequests.map((sr) => ({
        id: sr.id,
        type: sr.type,
        status: sr.status,
        description: sr.description,
        requestedDate: sr.requestedDate?.toISOString() || null,
        notes: sr.notes,
        adminNotes: sr.adminNotes,
        completedAt: sr.completedAt?.toISOString() || null,
        createdAt: sr.createdAt.toISOString(),
        updatedAt: sr.updatedAt.toISOString(),
        installation: sr.installation
          ? {
              id: sr.installation.id,
              address: `${sr.installation.propertyAddress}, ${sr.installation.propertyCity}, ${sr.installation.propertyState} ${sr.installation.propertyZip}`,
              status: sr.installation.status,
            }
          : sr.unlistedAddress
          ? {
              id: null as unknown as string,
              address: `${sr.unlistedAddress}, ${sr.unlistedCity}, ${sr.unlistedState} ${sr.unlistedZip} (unlisted)`,
              status: 'unlisted',
            }
          : null,
      })),
      counts: {
        pending: statusCounts.pending || 0,
        acknowledged: statusCounts.acknowledged || 0,
        scheduled: statusCounts.scheduled || 0,
        in_progress: statusCounts.in_progress || 0,
        completed: statusCounts.completed || 0,
        cancelled: statusCounts.cancelled || 0,
        total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      },
    })
  } catch (error) {
    console.error('Error fetching service requests:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
