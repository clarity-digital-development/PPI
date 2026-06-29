import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { sendAdminServiceRequestNotification, sendServiceRequestConfirmationEmail } from '@/lib/email'

// Statuses a customer is allowed to edit. Once a request is in_progress,
// completed, or cancelled it can no longer be edited by the customer.
const EDITABLE_STATUSES = ['pending', 'acknowledged', 'scheduled']

// Resolve the address string + on-site lockbox summary used by the SR emails.
// Mirrors the shape sendAdminServiceRequestNotification / sendServiceRequestConfirmationEmail
// expect (installation address or unlisted-address fallback + lockbox details).
async function resolveSREmailContext(installationId: string | null, unlisted: {
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}) {
  let installationAddress = '(no address)'
  let propertyAddress = '(address on file)'
  let existingLockboxes: Array<{ type: string; serialNumber: string | null; code: string | null }> = []

  if (installationId) {
    const installation = await prisma.installation.findUnique({
      where: { id: installationId },
      include: {
        lockboxes: {
          where: { removedAt: null },
          include: {
            lockboxType: true,
            customerLockbox: { select: { code: true, serialNumber: true } },
          },
        },
      },
    })
    if (installation) {
      installationAddress = `${installation.propertyAddress}, ${installation.propertyCity}, ${installation.propertyState} ${installation.propertyZip}`
      propertyAddress = [installation.propertyAddress, installation.propertyCity].filter(Boolean).join(', ')
      existingLockboxes = installation.lockboxes.map(lb => ({
        type: lb.lockboxType.name,
        serialNumber: lb.customerLockbox?.serialNumber ?? null,
        code: lb.customerLockbox?.code ?? lb.code ?? null,
      }))
    }
  } else if (unlisted.address) {
    const line = `${unlisted.address}, ${unlisted.city ?? ''}, ${unlisted.state ?? ''} ${unlisted.zip ?? ''}`.trim()
    installationAddress = `${line} (unlisted)`
    propertyAddress = line
  }

  return { installationAddress, propertyAddress, existingLockboxes }
}

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

      // Admin notification — without this admin doesn't know the customer
      // cancelled and the dispatch crew may show up to a job that's off.
      // Per Ryan 2026-06-29 ("SR edits aren't coming through as email") —
      // applies to cancellations too. Customer doesn't get a confirmation
      // since they initiated the cancel themselves; sessionStorage / UI
      // toast handles the in-app feedback.
      try {
        const userInfo = await prisma.user.findUnique({
          where: { id: user.id },
          select: { fullName: true, name: true, email: true, phone: true },
        })
        const customerName = userInfo?.fullName || userInfo?.name || userInfo?.email || 'Unknown'
        const ctx = await resolveSREmailContext(cancelled.installationId, {
          address: cancelled.unlistedAddress,
          city: cancelled.unlistedCity,
          state: cancelled.unlistedState,
          zip: cancelled.unlistedZip,
        })
        await sendAdminServiceRequestNotification({
          customerName,
          customerEmail: userInfo?.email,
          customerPhone: userInfo?.phone ?? undefined,
          requestType: cancelled.type,
          description: cancelled.description ?? undefined,
          requestedDate: cancelled.requestedDate ? cancelled.requestedDate.toISOString().slice(0, 10) : undefined,
          notes: cancelled.notes ?? undefined,
          installationAddress: ctx.installationAddress,
          existingLockboxes: ctx.existingLockboxes.length ? ctx.existingLockboxes : undefined,
          isCancelled: true,
        })
      } catch (emailError) {
        console.error('Failed to send admin SR cancellation notification:', emailError)
      }

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
      // Mirror the POST-create guard added 2026-06-29 per Ryan: the customer
      // edit path can no longer clear the date to null on an existing SR
      // either. Without this, an agent could create with a date then PATCH it
      // away — leaving admin with no dispatch signal, which is exactly the
      // failure Ryan reported. To genuinely cancel a service request, use the
      // status=cancelled path; to change the date, supply a new one.
      const parsed = typeof requested_date === 'string' && requested_date.trim()
        ? new Date(requested_date + 'T12:00:00Z')
        : null
      if (!parsed || isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'A valid preferred date is required for service requests.' },
          { status: 400 }
        )
      }
      // Store at noon UTC so the calendar date is stable across timezones
      // (mirrors POST /api/service-requests and the admin PUT).
      updateData.requestedDate = parsed
    }

    // Normalize empty/whitespace-only strings to null before storing AND
    // comparing. Without this, a customer who never typed notes (the form
    // initializes the textarea to '' and submits the full payload on save)
    // would land null !== '' = true and falsely flag a change, spamming
    // admin's inbox with [EDITED] emails for no-op date saves.
    const normNotes = typeof notes === 'string' && notes.trim() === '' ? null : notes
    const normDescription = typeof description === 'string' && description.trim() === '' ? null : description

    if (notes !== undefined) {
      updateData.notes = normNotes
    }

    if (description !== undefined) {
      updateData.description = normDescription
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

    // Detect whether anything actually changed — if the customer PATCHs with
    // the same values, skip the email send so we don't spam admin's inbox
    // with no-op notifications. null and '' are treated as equivalent on
    // both sides (the normalization above + the ?? null fallback) so a save
    // of a previously-null field with an empty form input doesn't count as
    // a change.
    const newTs = updateData.requestedDate instanceof Date ? updateData.requestedDate.getTime() : null
    const oldTs = existing.requestedDate ? existing.requestedDate.getTime() : null
    const dateChanged = updateData.requestedDate !== undefined && oldTs !== newTs
    const notesChanged = updateData.notes !== undefined && (existing.notes ?? null) !== (updateData.notes ?? null)
    const descChanged = updateData.description !== undefined && (existing.description ?? null) !== (updateData.description ?? null)
    const anythingChanged = dateChanged || notesChanged || descChanged

    if (anythingChanged) {
      // Admin notification — Ryan 2026-06-29: customer SR edits weren't
      // firing any email, so the dispatch crew worked off stale data
      // (mostly stale dates). Fix: re-send the admin notification with
      // an [EDITED] prefix so it's clearly distinguishable from the
      // original placement notification.
      const userInfo = await prisma.user.findUnique({
        where: { id: user.id },
        select: { fullName: true, name: true, email: true, phone: true },
      })
      const customerName = userInfo?.fullName || userInfo?.name || userInfo?.email || 'Unknown'
      const ctx = await resolveSREmailContext(updated.installationId, {
        address: updated.unlistedAddress,
        city: updated.unlistedCity,
        state: updated.unlistedState,
        zip: updated.unlistedZip,
      })

      try {
        await sendAdminServiceRequestNotification({
          customerName,
          customerEmail: userInfo?.email,
          customerPhone: userInfo?.phone ?? undefined,
          requestType: updated.type,
          description: updated.description ?? undefined,
          requestedDate: updated.requestedDate ? updated.requestedDate.toISOString().slice(0, 10) : undefined,
          notes: updated.notes ?? undefined,
          installationAddress: ctx.installationAddress,
          existingLockboxes: ctx.existingLockboxes.length ? ctx.existingLockboxes : undefined,
          isEdited: true,
        })
      } catch (emailError) {
        console.error('Failed to send admin SR edit notification:', emailError)
      }

      // Customer-facing confirmation — mirrors the create-flow confirmation
      // but with isEdited copy ("Service Request Updated") so the customer
      // sees the new snapshot in their inbox.
      if (userInfo?.email) {
        try {
          await sendServiceRequestConfirmationEmail({
            customerName,
            customerEmail: userInfo.email,
            requestId: updated.id,
            requestType: updated.type,
            description: updated.description ?? undefined,
            notes: updated.notes ?? undefined,
            requestedDate: updated.requestedDate ? updated.requestedDate.toISOString().slice(0, 10) : undefined,
            propertyAddress: ctx.propertyAddress,
            existingLockboxes: ctx.existingLockboxes.length ? ctx.existingLockboxes : undefined,
            recipientUserId: user.id,
            isEdited: true,
          })
        } catch (emailError) {
          console.error('Failed to send customer SR edit confirmation:', emailError)
        }
      }
    }

    return NextResponse.json({ serviceRequest: updated })
  } catch (error) {
    console.error('Error updating service request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
