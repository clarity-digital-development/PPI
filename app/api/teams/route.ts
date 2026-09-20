import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isAdminOrTeamAdmin } from '@/lib/auth-utils'

// GET /api/teams — the current team_admin's team + its active managed members.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!user.teamId) {
    return NextResponse.json({ team: null, members: [] })
  }

  const team = await prisma.team.findUnique({
    where: { id: user.teamId },
    include: {
      teamMembers: {
        where: { removedAt: null },
        orderBy: { createdAt: 'asc' },
        // The linked login's own teamId, to distinguish a member of this team
        // from an inventory-only brokerage link (whose teamId is NULL by
        // design). See sharesTeamScope below.
        include: { user: { select: { teamId: true } } },
      },
    },
  })

  if (!team) return NextResponse.json({ team: null, members: [] })

  return NextResponse.json({
    team: { id: team.id, name: team.name, freeLockboxInstall: team.freeLockboxInstall },
    members: team.teamMembers.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      phone: m.phone,
      hasLogin: !!m.userId,
      userId: m.userId,
      // True only when the linked login is genuinely inside this team's
      // visibility scope. Linked brokerage inventory (Ryan, 2026-09-08) gives
      // agents a roster row WITHOUT putting them in the team's scope -- Ryan
      // declined broker-side visibility -- so anything that lists members as
      // "agents whose records I can see" must filter on this, not on hasLogin.
      // Every query that scopes by team uses `user: { teamId }`, so a member
      // failing this test can never match one and would render as an agent with
      // permanently empty results.
      sharesTeamScope: !!m.userId && m.user?.teamId === team.id,
    })),
  })
}

// POST /api/teams — create the team_admin's team (idempotent if one exists).
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const name = (body.name ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })

  if (user.teamId) {
    const existing = await prisma.team.findUnique({ where: { id: user.teamId } })
    if (existing) {
      return NextResponse.json({ team: { id: existing.id, name: existing.name } })
    }
  }

  const team = await prisma.team.create({ data: { name } })
  await prisma.user.update({ where: { id: user.id }, data: { teamId: team.id } })
  return NextResponse.json({ team: { id: team.id, name: team.name } }, { status: 201 })
}

// PATCH /api/teams — rename the current team.
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!user.teamId) return NextResponse.json({ error: 'No team to rename' }, { status: 400 })

  const body = await request.json()
  const name = (body.name ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })

  const team = await prisma.team.update({ where: { id: user.teamId }, data: { name } })
  return NextResponse.json({ team: { id: team.id, name: team.name } })
}
