/**
 * Link an agent login to a brokerage so their inventory pickers can draw from
 * that brokerage's pool (Ryan, Slack 2026-09-08).
 *
 * Ryan's constraint, verbatim: *"this should only be an inventory link, not a
 * pay link"* — the agent still pays with their own card.
 *
 * WHY THIS WRITES `TeamMember.userId` AND NOT `User.teamId`
 * --------------------------------------------------------
 * The obvious implementation is `user.teamId = <brokerage team>`. It is wrong,
 * and an adversarial review of exactly that version (2026-09-20) found five
 * separate ways it breaks Ryan's constraint. `User.teamId` is not a pointer —
 * it is the team AUTHORITY field, and ~25 call sites already attach meaning to
 * it:
 *
 *   - `lib/auth-utils.ts:65` canActOnBehalfOf matches on teamId alone, so the
 *     brokerage could place orders as the agent, read their private inventory
 *     and hold their items — the relationship inverted.
 *   - `app/api/cron/post-rental-billing/route.ts:550` falls back to charging
 *     the team_admin's saved card when the agent has none. That is a pay link,
 *     on live Stripe.
 *   - `lib/orders/refund-recipient.ts:68` reroutes the agent's own refund
 *     confirmations (property address, amount) to the brokerage.
 *   - `app/api/service-requests/route.ts:250` scopes on `{ user: { teamId } }`,
 *     handing the brokerage the agent's service requests — the Phase B
 *     visibility Ryan explicitly declined.
 *   - `Team.freeLockboxInstall` is a per-team pricing perk the agent would
 *     silently inherit.
 *
 * `TeamMember.userId` carries none of that. Outside this feature it is read to
 * render a "Login" vs "Name only" badge, and by the brokerage's service-request
 * agent filter -- which is why `/api/teams` now reports whether a linked login
 * actually shares the team's visibility scope, so an inventory-only link does
 * not appear there as an agent whose requests the broker can read. It confers
 * no authority, so it can mean "this agent may draw from this pool" and nothing
 * else. The pool read resolves through the roster row, never `User.teamId`.
 *
 * Admin-only on purpose. Letting a team_admin run this would be a privilege
 * escalation: it is how an account gets attached to a brokerage at all.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

/** Someone else changed this agent's link mid-transaction. Mapped to 409. */
class ConcurrentLinkChange extends Error {}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const actor = await getCurrentUser()

    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Deliberately NOT isAdminOrTeamAdmin — see file header.
    if (actor.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // No self-linking. Mirrors the role-change guard in the sibling route:
    // an admin attaching their own account to a brokerage would hand that
    // brokerage a foothold on a Pink Posts staff account.
    if (id === actor.id) {
      return NextResponse.json(
        { error: 'You cannot link your own account to a brokerage.' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // `null` unlinks. Anything else must be a string team id.
    const rawTeamId = (body as { team_id?: unknown }).team_id
    if (rawTeamId !== null && typeof rawTeamId !== 'string') {
      return NextResponse.json(
        { error: 'team_id must be a brokerage id, or null to unlink' },
        { status: 400 }
      )
    }
    const teamId = rawTeamId === null || rawTeamId === '' ? null : rawTeamId

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, email: true, fullName: true, name: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    // Only ordinary customer accounts draw from a pool. A team_admin IS a pool,
    // and a Pink Posts internal admin must never be attached to a brokerage —
    // both were reachable in the first cut of this route.
    if (target.role !== 'customer') {
      return NextResponse.json(
        {
          error:
            target.role === 'team_admin'
              ? 'This is a brokerage account. Link agent accounts to it instead.'
              : 'Only customer accounts can be linked to a brokerage.',
        },
        { status: 400 }
      )
    }

    let team: { id: string; name: string } | null = null
    if (teamId) {
      team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } })
      if (!team) {
        return NextResponse.json({ error: 'Brokerage not found' }, { status: 404 })
      }
    }

    let previousTeamId: string | null = null

    await prisma.$transaction(async (tx) => {
      // Read INSIDE the transaction. Reading it outside left a window where two
      // concurrent calls both saw "no link" and raced on the unique index.
      // TeamMember.userId is @unique, so a login occupies at most one roster
      // row globally; the index is still the final arbiter and P2002 is handled
      // below.
      const existingLink = await tx.teamMember.findFirst({
        where: { userId: id },
        select: { id: true, teamId: true },
      })
      previousTeamId = existingLink?.teamId ?? null

      if (existingLink && existingLink.teamId !== teamId) {
        // Release, don't delete: the roster row keeps its inventory and order
        // history and reverts to name-only.
        //
        // Guarded on userId so a concurrent link that moved the agent
        // elsewhere between our read and this write is not silently clobbered.
        // updateMany (not update) because the guard is on a non-unique column.
        const released = await tx.teamMember.updateMany({
          where: { id: existingLink.id, userId: id },
          data: { userId: null },
        })
        if (released.count === 0) {
          // Someone else re-linked this agent first. Abort rather than report a
          // success we did not perform and write a misleading audit row.
          throw new ConcurrentLinkChange()
        }

        // The released row stays on the roster as a name-only member. It is
        // tempting to auto-remove one this feature created, but a released row
        // is indistinguishable from a member the brokerage added by hand: both
        // are active, name-only and may carry assigned inventory. Deleting real
        // roster history to tidy up an occasional stray is the worse trade, so
        // the row stays and the brokerage can remove it themselves. KNOWN: an
        // unlink can leave a name-only member the brokerage did not add.
      }

      if (!teamId) return

      // Prefer an existing roster row for this person over creating a second
      // one. 160 roster rows exist in production and none are linked to a login
      // yet, so creating blindly would orphan the agent's history behind a
      // duplicate. Email is the only identifier the roster and the login share.
      let claimable: { id: string } | null =
        existingLink && existingLink.teamId === teamId ? { id: existingLink.id } : null

      if (!claimable && target.email) {
        claimable = await tx.teamMember.findFirst({
          where: {
            teamId,
            userId: null,
            email: { equals: target.email, mode: 'insensitive' },
          },
          // Deterministic when two roster rows share an email — otherwise which
          // seat the login lands in is down to heap-scan luck.
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      }

      if (claimable) {
        // removedAt is cleared on purpose. Claiming a soft-removed row without
        // clearing it produces a linked seat that is hidden from the roster UI
        // and therefore cannot be unlinked from there.
        await tx.teamMember.update({
          where: { id: claimable.id },
          data: { userId: id, removedAt: null },
        })
      } else {
        await tx.teamMember.create({
          data: {
            teamId,
            name: target.fullName || target.name || target.email || 'Agent',
            email: target.email ?? null,
            userId: id,
          },
        })
      }
    })

    await audit({
      action: AuditAction.AgentLinkedToBrokerage,
      targetType: 'user',
      targetId: id,
      actor,
      request,
      metadata: { from: previousTeamId, to: teamId, brokerage: team?.name ?? null },
    })

    return NextResponse.json({ success: true, teamId, brokerage: team?.name ?? null })
  } catch (error) {
    // Both races end the same way: nothing was written, and a retry reads the
    // winner's row and succeeds.
    if (
      error instanceof ConcurrentLinkChange ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    ) {
      return NextResponse.json(
        { error: 'This agent was just linked by someone else. Reopen the page and try again.' },
        { status: 409 }
      )
    }
    console.error('Error linking agent to brokerage:', error)
    return NextResponse.json({ error: 'Failed to update brokerage link' }, { status: 500 })
  }
}
