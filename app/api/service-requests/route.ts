import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { createNotification } from '@/lib/notifications'
import { sendAdminServiceRequestNotification, sendServiceRequestConfirmationEmail } from '@/lib/email'
import { closedDayReason } from '@/lib/scheduling'
import { INSTALLABLE_ITEM_TYPES } from '@/lib/dispatch/types'
import { sameProperty } from '@/lib/installations/address-match'

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

    // Closed-day gate (Ryan 2026-08-31: Saturdays closed + holiday list).
    // The modals guard client-side; this stops direct API calls and stale tabs.
    const closedReason = closedDayReason(requested_date.trim())
    if (closedReason) {
      return NextResponse.json({ error: closedReason }, { status: 400 })
    }

    if (!['removal', 'service', 'repair', 'replacement'].includes(type)) {
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 })
    }

    // Every part of the address is required: a blank street or city would
    // turn the `contains` match below into "any installation on the account".
    if (address) {
      const parts = [address.street, address.city, address.state, address.zip]
      if (!parts.every((p) => typeof p === 'string' && p.trim())) {
        return NextResponse.json(
          { error: 'Please enter the street, city, state and ZIP.' },
          { status: 400 }
        )
      }
      address.street = address.street.trim()
      address.city = address.city.trim()
      address.state = address.state.trim()
      address.zip = address.zip.trim()
    }

    // A removal for a sign that IS on the customer's list has to go through
    // the listed route (/api/installations/[id]/service-request), which marks
    // the installation removal_scheduled and bills the second half of an
    // out-of-area fee; booking it here would skip both. The Schedule Removal
    // modal already sends a typed-in listed address that way, so this only
    // catches a stale page or a direct call. Matched on the whole normalized
    // address (lib/installations/address-match.ts), not a substring: "12 Main
    // St" is a different sign from "112 Main St". Installs already taken down
    // don't count: a new sign at an address we removed from before is one we
    // lost track of, so it goes in unlisted.
    if (type === 'removal' && address) {
      const candidates = await prisma.installation.findMany({
        where: { userId: user.id, status: { not: 'removed' } },
        select: { propertyAddress: true, propertyCity: true, propertyZip: true, status: true },
      })
      const match = candidates.find((i) =>
        sameProperty({ street: i.propertyAddress, city: i.propertyCity, zip: i.propertyZip }, address)
      )
      if (match) {
        const where = `${match.propertyAddress}, ${match.propertyCity}`
        return NextResponse.json(
          {
            error: match.status === 'removal_scheduled'
              ? `A removal is already scheduled for ${where}. You can see it under Service Requests.`
              : `${where} is already on your list. Pick it under "Which listing are we removing?" instead.`,
          },
          { status: 409 }
        )
      }
    }

    // Try to attach this request to an existing installation at the same address.
    // If we can't find one and the customer supplied an address, we create a
    // standalone (unlisted-address) request — admin sees the address fields
    // directly on the request. This is how same-day pickups from places we've
    // never been to get scheduled, and how a customer books a removal for a
    // sign the site has no record of (the "isn't listed" option on Schedule
    // Removal). A removal never attaches here (see above). Same whole-address
    // match, and only on exactly one live install: a substring match sent a
    // "12 Main St" trip to the "112 Main St" install.
    let installation = null
    if (address && type !== 'removal') {
      const candidates = await prisma.installation.findMany({
        where: { userId: user.id, status: { not: 'removed' } },
        select: { id: true, propertyAddress: true, propertyCity: true, propertyZip: true },
      })
      const matches = candidates.filter((i) =>
        sameProperty({ street: i.propertyAddress, city: i.propertyCity, zip: i.propertyZip }, address)
      )
      installation = matches.length !== 1 ? null : await prisma.installation.findUnique({
        where: { id: matches[0].id },
        include: {
          // On-site lockboxes — surfaced in SR emails so the install crew sees what's there.
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
    }

    // Shape for SR email helpers — prefer live CustomerLockbox data, fall back to copied fields.
    const existingLockboxes = installation
      ? installation.lockboxes.map(lb => ({
          type: lb.lockboxType.name,
          serialNumber: lb.customerLockbox?.serialNumber ?? null,
          code: lb.customerLockbox?.code ?? lb.code ?? null,
        }))
      : []

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
        // Use the pre-parsed date from the validation guard above — the
        // string version was already trimmed and Date-validated, so we avoid
        // re-parsing (and avoid a stale fallback to null that the guard
        // would never let through anyway).
        requestedDate: parsedDate,
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
          // Narrowed: nothing else on the order is read here, and physical
          // items only — money lines ('surcharge', 'pickup_fee') are not
          // things to bring back.
          select: {
            orderItems: {
              where: { itemType: { in: [...INSTALLABLE_ITEM_TYPES] } },
              select: { description: true, quantity: true },
            },
          },
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
        existingLockboxes: existingLockboxes.length ? existingLockboxes : undefined,
      })
    } catch (emailError) {
      console.error('Failed to send admin service request notification:', emailError)
    }

    // Customer-facing confirmation — wrapped so a Resend failure can't break
    // the request. propertyAddress falls back to the unlisted address when
    // the request isn't tied to an existing installation.
    try {
      const userInfo = await prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true, name: true, email: true },
      })
      if (userInfo?.email) {
        const customerName = userInfo.fullName || userInfo.name || userInfo.email
        const propertyAddress = installation
          ? [
              installation.propertyAddress,
              installation.propertyCity,
            ].filter(Boolean).join(', ')
          : addressLine || '(address on file)'

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
    const memberId = searchParams.get('member_id') // team_admin: filter to one member's requests
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // team_admins see service requests across their whole team (their own +
    // any team member with a login); they can narrow to one member. Regular
    // customers see only their own.
    const srOwnership =
      user.role === 'team_admin' && user.teamId
        ? { user: { teamId: user.teamId }, ...(memberId ? { userId: memberId } : {}) }
        : { userId: user.id }

    // Fetch only this user's service requests
    let serviceRequests: any[] = []

    try {
      serviceRequests = await prisma.serviceRequest.findMany({
        where: {
          ...srOwnership,
          ...(status ? { status: status as any } : {}),
        },
        include: {
          user: { select: { id: true, fullName: true, name: true, email: true } },
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

    // Count by status (same ownership scope as the list)
    let statusCounts: Record<string, number> = {}
    try {
      const counts = await prisma.serviceRequest.groupBy({
        by: ['status'],
        where: srOwnership,
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
        completedAt: sr.completedAt?.toISOString() || null,
        createdAt: sr.createdAt.toISOString(),
        updatedAt: sr.updatedAt.toISOString(),
        // Trip-charge state for the dashboard's "Pending invoice $X" / "Paid
        // $X" badges. This mapping used to drop both fields, so those badges
        // never rendered (found 2026-09-28 alongside Ryan's OOA pickup ask).
        invoiceStatus: sr.invoiceStatus ?? null,
        invoiceAmount: sr.invoiceAmount != null ? Number(sr.invoiceAmount) : null,
        // Who the request belongs to (used by the team_admin team view/filter)
        userId: sr.userId,
        userName: sr.user?.fullName || sr.user?.name || sr.user?.email || null,
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
