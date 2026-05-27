import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isAdminOrTeamAdmin } from '@/lib/auth-utils'

// POST /api/teams/members — add a (name-only) managed agent to the team_admin's
// team. Hybrid model: members start as name-only records and can be upgraded to
// a full login account later.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!user.teamId) {
    return NextResponse.json({ error: 'Create your team before adding members.' }, { status: 400 })
  }

  const body = await request.json()
  const name = (body.name ?? '').toString().trim()
  const email = (body.email ?? '').toString().trim()
  const phone = (body.phone ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Member name is required' }, { status: 400 })

  const member = await prisma.teamMember.create({
    data: {
      teamId: user.teamId,
      name,
      email: email || null,
      phone: phone || null,
    },
  })

  return NextResponse.json(
    {
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        hasLogin: false,
        userId: null,
      },
    },
    { status: 201 }
  )
}
