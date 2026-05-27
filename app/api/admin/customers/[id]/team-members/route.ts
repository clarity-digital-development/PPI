import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

// POST /api/admin/customers/[id]/team-members
// Pink Posts admins add a managed agent to a team_admin's team (creating the
// team if they don't have one yet). The new member shows up on the team_admin's
// own "My Team" page too, since both read the same Team.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (target.role !== 'team_admin') {
    return NextResponse.json({ error: 'This customer is not a team admin' }, { status: 400 })
  }

  const body = await request.json()
  const name = (body.name ?? '').toString().trim()
  const email = (body.email ?? '').toString().trim()
  const phone = (body.phone ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'Member name is required' }, { status: 400 })

  // Ensure the team_admin has a team
  let teamId = target.teamId
  if (!teamId) {
    const team = await prisma.team.create({
      data: { name: `${target.fullName || target.name || target.email}'s Team` },
    })
    teamId = team.id
    await prisma.user.update({ where: { id: target.id }, data: { teamId } })
  }

  const member = await prisma.teamMember.create({
    data: { teamId, name, email: email || null, phone: phone || null },
  })

  return NextResponse.json(
    {
      member: { id: member.id, name: member.name, email: member.email, hasLogin: false },
    },
    { status: 201 }
  )
}
