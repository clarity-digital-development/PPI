import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { sendAdminServiceRequestNotification, sendServiceRequestConfirmationEmail } from '@/lib/email'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { type, description, requested_date, notes } = body

    if (!type) {
      return NextResponse.json(
        { error: 'Request type is required' },
        { status: 400 }
      )
    }

    // Date is required so admin has a dispatch signal — the client modals
    // already gate the submit, this is defense-in-depth for any direct API
    // caller / cached old client. Added 2026-06-29 per Ryan. Also validates
    // the string parses to a real Date so whitespace / "yesterday" / etc.
    // can't slip past and fall into a generic 500 downstream.
    const parsedDate = typeof requested_date === 'string' && requested_date.trim()
      ? new Date(requested_date + 'T12:00:00Z')
      : null
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { error: 'A valid preferred date is required for service requests.' },
        { status: 400 }
      )
    }

    // Validate type
    const validTypes = ['removal', 'service', 'repair', 'replacement']
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: 'Invalid request type' },
        { status: 400 }
      )
    }

    // Get the installation — include on-site lockboxes so SR emails can list
    // what's already at the property for the install crew.
    const installation = await prisma.installation.findFirst({
      where: { id, userId: user.id },
      include: {
        lockboxes: {
          where: { removedAt: null },
          include: {
            lockboxType: true,
            // Prefer live inventory code/serial via FK; fall back to legacy .code copy.
            customerLockbox: { select: { code: true, serialNumber: true } },
          },
        },
      },
    })

    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }

    // Shape for both SR email helpers — prefer live CustomerLockbox data, fall back to copied fields.
    const existingLockboxes = installation.lockboxes.map(lb => ({
      type: lb.lockboxType.name,
      serialNumber: lb.customerLockbox?.serialNumber ?? null,
      code: lb.customerLockbox?.code ?? lb.code ?? null,
    }))

    if (installation.status === 'removed') {
      return NextResponse.json(
        { error: 'Cannot create service request for removed installation' },
        { status: 400 }
      )
    }

    // Create the service request
    const serviceRequest = await prisma.serviceRequest.create({
      data: {
        installationId: id,
        userId: user.id,
        type,
        description,
        // Use the pre-parsed date from the validation guard above (already
        // trimmed + Date-validated; can't be null here).
        requestedDate: parsedDate,
        notes,
      },
    })

    // Send admin email notification
    try {
      const userInfo = await prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true, name: true, email: true, phone: true },
      })
      const customerName = userInfo?.fullName || userInfo?.name || userInfo?.email || 'Unknown'
      const installationAddress = [
        installation.propertyAddress,
        installation.propertyCity,
        installation.propertyState,
        installation.propertyZip,
      ].filter(Boolean).join(', ')

      // For removal requests, include what was originally installed at this
      // address so admin knows what to bring back
      let installedItems: string | undefined
      if (type === 'removal') {
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
        installationAddress,
        installedItems,
        existingLockboxes: existingLockboxes.length ? existingLockboxes : undefined,
      })
    } catch (emailError) {
      console.error('Failed to send admin service request notification:', emailError)
    }

    // Customer-facing confirmation — same pattern as the admin email above so
    // a Resend failure can't break the route.
    try {
      const userInfo = await prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true, name: true, email: true },
      })
      if (userInfo?.email) {
        const customerName = userInfo.fullName || userInfo.name || userInfo.email
        const propertyAddress = [
          installation.propertyAddress,
          installation.propertyCity,
          installation.propertyState,
          installation.propertyZip,
        ].filter(Boolean).join(', ')

        await sendServiceRequestConfirmationEmail({
          customerName,
          customerEmail: userInfo.email,
          requestId: serviceRequest.id,
          requestType: type,
          description: description || undefined,
          notes: notes || undefined,
          requestedDate: requested_date || undefined,
          propertyAddress,
          existingLockboxes: existingLockboxes.length ? existingLockboxes : undefined,
          // Pref gate — SR confirmations are emailServiceRequests traffic.
          recipientUserId: user.id,
        })
      }
    } catch (emailError) {
      console.error('Failed to send service request confirmation email:', emailError)
    }

    // If it's a removal request, also update the installation status
    if (type === 'removal' && requested_date) {
      await prisma.installation.update({
        where: { id },
        data: {
          status: 'removal_scheduled',
          removalDate: new Date(requested_date + 'T12:00:00Z'),
        },
      })
    }

    return NextResponse.json({ serviceRequest })
  } catch (error) {
    console.error('Error creating service request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
