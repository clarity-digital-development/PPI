import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { CURRENT_NOTICE_VERSION, isPolicyExempt } from '@/lib/policy-notices'

// POST /api/profile/accept-notice
// Body: { version: number }
// Records the authenticated user's acceptance of the current policy notice
// modal and writes an audit row (legal trail). Idempotent — re-accepting the
// same version just bumps the timestamp.
const AcceptBodySchema = z.object({
  version: z.number().int().min(1).max(CURRENT_NOTICE_VERSION),
})

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // WHY: exempt users (team_admin / admin / flagged customer) should never
    // see the modal; if a stale client tab POSTs anyway, no-op cleanly.
    if (isPolicyExempt(user)) {
      return NextResponse.json({ ok: true, exempt: true })
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = AcceptBodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid version', details: parsed.error.errors },
        { status: 400 }
      )
    }

    const { version } = parsed.data
    const acceptedAt = new Date()

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        policyNoticeAcceptedAt: acceptedAt,
        policyNoticeVersion: version,
      },
      select: {
        policyNoticeAcceptedAt: true,
        policyNoticeVersion: true,
      },
    })

    // Legal trail — audit() never throws so a logging hiccup can't undo the acceptance.
    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.PolicyNoticeAccepted,
      targetType: 'User',
      targetId: user.id,
      metadata: { version },
      request,
    })

    return NextResponse.json({
      ok: true,
      policyNoticeAcceptedAt: updated.policyNoticeAcceptedAt,
      policyNoticeVersion: updated.policyNoticeVersion,
    })
  } catch (error) {
    console.error('[accept-notice] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
