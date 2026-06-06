// Admin "Retry charge" endpoint. Flips a failed PostRentalCharge back to
// 'scheduled' so the next cron pass picks it up — clears failure fields and
// audits the manual intervention. Intentionally does NOT call Stripe inline;
// the cron's Pass-2 logic is the single charging path so retries go through
// the same idempotency-keyed code path as the original attempt.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

export async function POST(
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

    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const chargeId = typeof body?.chargeId === 'string' ? body.chargeId : null
    if (!chargeId) {
      return NextResponse.json({ error: 'chargeId is required' }, { status: 400 })
    }

    // Load the charge — must belong to this order and be in 'failed' state.
    const charge = await prisma.postRentalCharge.findUnique({
      where: { id: chargeId },
    })
    if (!charge || charge.orderId !== orderId) {
      return NextResponse.json({ error: 'Charge not found for this order' }, { status: 404 })
    }
    if (charge.status !== 'failed') {
      return NextResponse.json(
        { error: `Only failed charges can be retried (status: ${charge.status})` },
        { status: 409 }
      )
    }

    // Conditional flip — guards against TOCTOU if the cron simultaneously
    // re-fired this row. updateMany returns count so we can detect the race.
    const flipped = await prisma.postRentalCharge.updateMany({
      where: { id: chargeId, status: 'failed' },
      data: {
        status: 'scheduled',
        failureCode: null,
        failureMessage: null,
        attemptedAt: null,
      },
    })

    if (flipped.count === 0) {
      return NextResponse.json(
        { error: 'Charge state changed during retry — refresh and try again' },
        { status: 409 }
      )
    }

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.PostRentalChargeRetry,
      targetType: 'post_rental_charge',
      targetId: chargeId,
      metadata: {
        orderId,
        previousFailureCode: charge.failureCode,
        previousFailureMessage: charge.failureMessage,
        attemptCount: charge.attemptCount,
      },
      request,
    })

    return NextResponse.json({ success: true, chargeId, status: 'scheduled' })
  } catch (error) {
    console.error('Error retrying post-rental charge:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
