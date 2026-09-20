/**
 * The brokerages an agent can be linked to for inventory sharing
 * (Ryan, Slack 2026-09-08).
 *
 * A "brokerage" here is a `team_admin` account that owns a Team — the Team is
 * what actually holds the inventory pool and the agent roster. A team_admin
 * with no team can't be a pool, so it isn't offered.
 *
 * Admin-only, matching `POST /api/admin/customers/[id]/brokerage`: this list
 * is the picker for that action, and a team_admin must not be able to enumerate
 * or link into other brokerages.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function GET() {
  try {
    const actor = await getCurrentUser()
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (actor.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admins = await prisma.user.findMany({
      where: { role: 'team_admin', teamId: { not: null } },
      select: {
        id: true,
        teamId: true,
        fullName: true,
        name: true,
        email: true,
        company: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    // One option PER TEAM, not per team_admin user. Nothing stops two
    // team_admin logins sharing a Team, and emitting both would render
    // duplicate options with duplicate React keys and let the admin pick
    // "the same" brokerage twice.
    const byTeam = new Map<string, { teamId: string; name: string; accountEmail: string | null }>()
    for (const a of admins) {
      if (!a.team || byTeam.has(a.team.id)) continue
      byTeam.set(a.team.id, {
        teamId: a.team.id,
        // The Team name is the brokerage's real name ("Semonin Realtors");
        // the account's own name is the login behind it. Prefer the Team.
        name: a.team.name || a.company || a.fullName || a.name || a.email || 'Brokerage',
        accountEmail: a.email,
      })
    }
    const brokerages = Array.from(byTeam.values()).sort((x, y) => x.name.localeCompare(y.name))

    return NextResponse.json({ brokerages })
  } catch (error) {
    console.error('Error listing brokerages:', error)
    return NextResponse.json({ error: 'Failed to list brokerages' }, { status: 500 })
  }
}
