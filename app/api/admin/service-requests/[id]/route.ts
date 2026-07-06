import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { createServiceRequestNotification } from '@/lib/notifications'
import { sendServiceRequestCompletedEmail, sendServiceRequestStatusEmail, sendServiceRequestConfirmationEmail } from '@/lib/email'

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
      const removedInstallation = await prisma.installation.update({
        where: { id: serviceRequest.installationId },
        data: {
          status: 'removed',
          removedAt: new Date(),
        },
        select: { orderId: true },
      })
      // Stop the rental clock at the source — defense-in-depth in the cron's
      // eligibility predicate also catches this, but stamping it here avoids
      // any cron lag window between pickup completion and the next daily run.
      if (removedInstallation.orderId) {
        await prisma.order.update({
          where: { id: removedInstallation.orderId },
          data: { postRentalStoppedAt: new Date() },
        })
      }
    }

    // Symmetric release for cancellation. Without this the Installation
    // stays stuck at 'removal_scheduled' after admin cancels the SR, and
    // active-posts-table.tsx:111 hides "Schedule Removal" — the exact
    // stuck-state Ryan reported 2026-07-06 for Willie/Semonin on 12604
    // Razor Court. Guard on 'removal_scheduled' current status so we don't
    // flip 'removed' back to 'active' if a completed SR is force-cancelled.
    if (status === 'cancelled' && serviceRequest.type === 'removal' && serviceRequest.installationId) {
      await prisma.installation.updateMany({
        where: { id: serviceRequest.installationId, status: 'removal_scheduled' },
        data: { status: 'active', removalDate: null },
      })
    }

    // Create notification for status change
    const notifiableStatuses = ['acknowledged', 'scheduled', 'completed']
    const statusChanged = status && status !== serviceRequest.status
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

    // Detect a silent date change: admin set scheduled_date on an SR whose
    // status DIDN'T transition (e.g. already 'scheduled' → admin shifts the
    // date). Previously this fired no customer email — the same class of
    // gap Ryan reported on 2026-06-29 for customer self-edits. Triggers a
    // [EDITED] confirmation email below so the customer sees the new date.
    const dateSilentlyChanged = scheduled_date
      && !statusChanged
      && updateData.requestedDate instanceof Date
      && (!serviceRequest.requestedDate || serviceRequest.requestedDate.getTime() !== updateData.requestedDate.getTime())

    // Email the customer when status actually transitions. Completed stays on
    // sendServiceRequestCompletedEmail; the other states use the new helper.
    if (statusChanged) {
      try {
        const customer = await prisma.user.findUnique({
          where: { id: updated.userId },
          select: { email: true, fullName: true, name: true },
        })
        if (customer?.email) {
          const fullAddress = updated.installation
            ? `${updated.installation.propertyAddress}, ${updated.installation.propertyCity}, ${updated.installation.propertyState} ${updated.installation.propertyZip}`
            : updated.unlistedAddress
              ? `${updated.unlistedAddress}, ${updated.unlistedCity}, ${updated.unlistedState} ${updated.unlistedZip}`
              : '(unlisted address)'
          const customerName = customer.fullName || customer.name || 'there'

          // Pull on-site lockboxes so the crew sees what's at the property.
          const installationWithLockboxes = updated.installation
            ? await prisma.installation.findUnique({
                where: { id: updated.installation.id },
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
            : null
          const existingLockboxes = installationWithLockboxes
            ? installationWithLockboxes.lockboxes.map(lb => ({
                type: lb.lockboxType.name,
                serialNumber: lb.customerLockbox?.serialNumber ?? null,
                code: lb.customerLockbox?.code ?? lb.code ?? null,
              }))
            : []

          if (status === 'completed') {
            // Preserve the existing completion-email copy/subject.
            await sendServiceRequestCompletedEmail({
              customerEmail: customer.email,
              customerName,
              requestType: updated.type,
              address: fullAddress,
              existingLockboxes: existingLockboxes.length ? existingLockboxes : undefined,
              // Pref gate — SR completion is emailServiceRequests traffic.
              recipientUserId: updated.userId,
            }).catch(err => console.error('completion email failed:', err))
          } else if (status === 'acknowledged' || status === 'scheduled' || status === 'in_progress' || status === 'cancelled') {
            await sendServiceRequestStatusEmail({
              customerName,
              customerEmail: customer.email,
              requestId: updated.id,
              requestType: updated.type,
              newStatus: status,
              scheduledDate: status === 'scheduled' ? updated.requestedDate : null,
              propertyAddress: fullAddress,
              // adminNotes is INTERNAL — never surface to the customer. The
              // status email's `notes` param is for customer-facing content
              // only (currently nothing — future enhancement could add a
              // "customer_message" field on the SR for genuinely-shareable
              // context like "rescheduled due to weather"). The leak that
              // surfaced these as "Notes from our team" shipped pre-Round 27
              // and was caught by the 2026-06-29 QA sweep.
              notes: undefined,
              existingLockboxes: existingLockboxes.length ? existingLockboxes : undefined,
              // Pref gate — SR status emails are emailServiceRequests traffic.
              recipientUserId: updated.userId,
            }).catch(err => console.error(`${status} email failed:`, err))
          }
        }
      } catch (emailError) {
        console.error('Error sending status email:', emailError)
      }
    }

    // Silent-date-change fallback: admin shifted the date without flipping
    // status (already-scheduled SR moved to a new day). The block above only
    // fires on status transitions, so without this the customer would never
    // see the new date.
    if (dateSilentlyChanged) {
      try {
        const customer = await prisma.user.findUnique({
          where: { id: updated.userId },
          select: { email: true, fullName: true, name: true },
        })
        if (customer?.email) {
          const fullAddress = updated.installation
            ? `${updated.installation.propertyAddress}, ${updated.installation.propertyCity}, ${updated.installation.propertyState} ${updated.installation.propertyZip}`
            : updated.unlistedAddress
              ? `${updated.unlistedAddress}, ${updated.unlistedCity}, ${updated.unlistedState} ${updated.unlistedZip}`
              : '(unlisted address)'
          const customerName = customer.fullName || customer.name || 'there'
          await sendServiceRequestConfirmationEmail({
            customerName,
            customerEmail: customer.email,
            requestId: updated.id,
            requestType: updated.type,
            description: updated.description ?? undefined,
            notes: undefined, // adminNotes are internal — don't surface to customer
            requestedDate: updated.requestedDate ? updated.requestedDate.toISOString().slice(0, 10) : undefined,
            propertyAddress: fullAddress,
            recipientUserId: updated.userId,
            isEdited: true,
          })
        }
      } catch (emailError) {
        console.error('Failed to send admin-edited SR confirmation:', emailError)
      }
    }

    return NextResponse.json({ serviceRequest: updated })
  } catch (error) {
    console.error('Error updating service request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
