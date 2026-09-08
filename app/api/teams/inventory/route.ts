import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isAdminOrTeamAdmin } from '@/lib/auth-utils'

// GET /api/teams/inventory[?member_id=<id|unassigned>]
// Returns the team_admin's own inventory as INDIVIDUAL items (not aggregated)
// with their agent assignment, plus the active roster for the assign dropdown.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const memberFilter = searchParams.get('member_id') // a member id, 'unassigned', or null = all

  // Narrow by assignment if requested
  const assignWhere =
    memberFilter === 'unassigned'
      ? { assignedToMemberId: null }
      : memberFilter
        ? { assignedToMemberId: memberFilter }
        : {}

  const [allSigns, allRiders, allLockboxes, allBrochureBoxes, members] = await Promise.all([
    prisma.customerSign.findMany({
      where: { userId: user.id, ...assignWhere },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customerRider.findMany({
      where: { userId: user.id, ...assignWhere },
      include: { rider: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customerLockbox.findMany({
      where: { userId: user.id, ...assignWhere },
      include: { lockboxType: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customerBrochureBox.findMany({
      where: { userId: user.id, ...assignWhere },
      orderBy: { createdAt: 'desc' },
    }),
    user.teamId
      ? prisma.teamMember.findMany({
          where: { teamId: user.teamId, removedAt: null },
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
  ])

  // IN STORAGE AND DEPLOYED ARE TWO LISTS. The page used to get one list,
  // label it "in storage" and offer all of it for assignment — Redfin's
  // brokers assigned eight signs that were all out at properties, then
  // couldn't order with them (Ryan, 2026-09-08). Only stored items are
  // assignable; deployed ones are returned separately, read-only, so the
  // broker can still see where everything is.
  const signs = allSigns.map((s) => ({
    id: s.id,
    label: s.description,
    inStorage: s.inStorage,
    assignedToMemberId: s.assignedToMemberId,
  }))
  const riders = allRiders.map((r) => ({
    id: r.id,
    label: r.rider?.name ?? 'Rider',
    inStorage: r.inStorage,
    assignedToMemberId: r.assignedToMemberId,
  }))
  const lockboxes = allLockboxes.map((l) => ({
    id: l.id,
    label: l.lockboxType?.name ?? 'Lockbox',
    code: l.code,
    inStorage: l.inStorage,
    assignedToMemberId: l.assignedToMemberId,
  }))
  const brochureBoxes = allBrochureBoxes.map((b) => ({
    id: b.id,
    label: b.description || 'Brochure Box',
    inStorage: b.inStorage,
    assignedToMemberId: b.assignedToMemberId,
  }))
  const stored = <T extends { inStorage: boolean }>(rows: T[]) => rows.filter((r) => r.inStorage)
  const deployed = <T extends { inStorage: boolean }>(rows: T[]) => rows.filter((r) => !r.inStorage)

  return NextResponse.json({
    members: members.map((m) => ({ id: m.id, name: m.name })),
    signs: stored(signs),
    riders: stored(riders),
    lockboxes: stored(lockboxes),
    brochureBoxes: stored(brochureBoxes),
    deployed: {
      signs: deployed(signs),
      riders: deployed(riders),
      lockboxes: deployed(lockboxes),
      brochureBoxes: deployed(brochureBoxes),
    },
  })
}

const MODELS = {
  sign: 'customerSign',
  rider: 'customerRider',
  lockbox: 'customerLockbox',
  brochure_box: 'customerBrochureBox',
} as const

// PATCH /api/teams/inventory — assign (or unassign) an inventory item to an
// agent. Body: { type, id, memberId: string | null }. Transfer-of-ownership
// model: the item is tagged to the member; null clears the assignment.
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminOrTeamAdmin(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const type = body.type as keyof typeof MODELS
  const id = body.id as string
  const memberId = (body.memberId ?? null) as string | null

  if (!MODELS[type]) return NextResponse.json({ error: 'Invalid inventory type' }, { status: 400 })
  if (!id) return NextResponse.json({ error: 'Inventory id is required' }, { status: 400 })

  // The item must belong to the caller (team_admins manage their own pool).
  // Admins may manage any item.
  const model = (prisma as any)[MODELS[type]]
  const item = await model.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
  if (user.role !== 'admin' && item.userId !== user.id) {
    return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 })
  }

  // If assigning to a member, it must be an active member of the caller's team.
  if (memberId) {
    const member = await prisma.teamMember.findUnique({ where: { id: memberId } })
    if (!member || member.removedAt) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (user.role !== 'admin' && member.teamId !== user.teamId) {
      return NextResponse.json({ error: 'Member not on your team' }, { status: 403 })
    }
  }

  // Refuse reassignment while item is live-held in a cart. Brochure boxes have
  // no hold infrastructure, so skip the guard for them.
  if (type !== 'brochure_box' && item.heldByHoldId && item.heldUntil && item.heldUntil > new Date()) {
    const hold = await prisma.inventoryHold.findUnique({
      where: { id: item.heldByHoldId },
      include: { owner: { select: { email: true, fullName: true, teamId: true } } },
    })
    const sameTeam =
      !!hold?.owner?.teamId && !!user.teamId && hold.owner.teamId === user.teamId
    const payload: Record<string, unknown> = {
      error: 'Item is in an active cart. Release the hold or wait until expires_at.',
      code: 'item_held',
      expires_at: item.heldUntil.toISOString(),
    }
    if (user.role === 'admin' || sameTeam) {
      payload.holder = { email: hold?.owner?.email ?? null, fullName: hold?.owner?.fullName ?? null }
    }
    return NextResponse.json(payload, { status: 409 })
  }

  await model.update({ where: { id }, data: { assignedToMemberId: memberId } })
  return NextResponse.json({ success: true })
}
