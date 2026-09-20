import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isAdminOrTeamAdmin } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

// Load a member only if the caller may manage it: admins can manage any team's
// member; team_admins are scoped to their own team. Returns null otherwise so
// callers respond 404 (don't leak existence).
async function loadManageable(
  user: { id: string; role: string; teamId: string | null },
  id: string
) {
  const member = await prisma.teamMember.findUnique({ where: { id } })
  if (!member) return null
  if (user.role !== 'admin' && member.teamId !== user.teamId) return null
  return member
}

// PATCH /api/teams/members/[id] — edit a member's details.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const member = await loadManageable(user, id)
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const body = await request.json()
  const data: { name?: string; email?: string | null; phone?: string | null } = {}
  if (body.name !== undefined) {
    const name = body.name.toString().trim()
    if (!name) return NextResponse.json({ error: 'Member name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.email !== undefined) data.email = body.email?.toString().trim() || null
  if (body.phone !== undefined) data.phone = body.phone?.toString().trim() || null

  const updated = await prisma.teamMember.update({ where: { id }, data })
  return NextResponse.json({
    member: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      hasLogin: !!updated.userId,
      userId: updated.userId,
    },
  })
}

// DELETE /api/teams/members/[id] — soft-remove (keeps the record + any assigned
// inventory/orders; just hides them from the active roster).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const member = await loadManageable(user, id)
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Clearing userId is what actually revokes access. Since linked brokerage
  // inventory (Ryan, 2026-09-08) the roster row IS the inventory link, so
  // removing an agent from the roster has to stop them drawing from the
  // brokerage's pool -- otherwise the broker "removes" them and they keep
  // ordering with the brokerage's signs. The row itself is still only
  // soft-removed, so inventory and order history are preserved, and the agent's
  // own login and inventory are untouched.
  await prisma.teamMember.update({
    where: { id },
    data: { removedAt: new Date(), userId: null },
  })

  // Audit the REVOCATION, not just the grant. The link is created by an admin
  // and audited there; without this a team_admin could quietly undo it and the
  // log would still read as though the agent had pool access. Only fires when
  // a link actually existed, so ordinary roster tidying stays quiet.
  if (member.userId) {
    await audit({
      action: AuditAction.AgentLinkedToBrokerage,
      targetType: 'user',
      targetId: member.userId,
      actor: user,
      request,
      metadata: { from: member.teamId, to: null, via: 'roster_removal', member_id: id },
    })
  }

  return NextResponse.json({ success: true })
}
