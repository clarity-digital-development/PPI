import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const holds = await prisma.inventoryHold.findMany({
      where: {
        consumedByOrderId: null,
        releasedAt: null,
      },
      include: {
        owner: { select: { email: true, fullName: true, name: true } },
        actor: { select: { email: true } },
        onBehalfOf: { select: { email: true } },
      },
      orderBy: { expiresAt: 'asc' },
    })

    const signIds: string[] = []
    const riderIds: string[] = []
    const lockboxIds: string[] = []
    for (const h of holds) {
      if (h.itemType === 'sign') signIds.push(h.itemId)
      else if (h.itemType === 'rider') riderIds.push(h.itemId)
      else if (h.itemType === 'lockbox') lockboxIds.push(h.itemId)
    }

    const [signs, riders, lockboxes] = await Promise.all([
      signIds.length
        ? prisma.customerSign.findMany({
            where: { id: { in: signIds } },
            select: { id: true, description: true },
          })
        : Promise.resolve([] as Array<{ id: string; description: string }>),
      riderIds.length
        ? prisma.customerRider.findMany({
            where: { id: { in: riderIds } },
            select: { id: true, rider: { select: { name: true } } },
          })
        : Promise.resolve([] as Array<{ id: string; rider: { name: string } }>),
      lockboxIds.length
        ? prisma.customerLockbox.findMany({
            where: { id: { in: lockboxIds } },
            select: {
              id: true,
              serialNumber: true,
              lockboxType: { select: { name: true } },
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: string
              serialNumber: string | null
              lockboxType: { name: string }
            }>,
          ),
    ])

    const signDesc = new Map(signs.map((s) => [s.id, s.description]))
    const riderDesc = new Map(riders.map((r) => [r.id, r.rider.name]))
    const lockboxDesc = new Map(
      lockboxes.map((l) => [
        l.id,
        l.serialNumber ? `${l.lockboxType.name} (#${l.serialNumber})` : l.lockboxType.name,
      ]),
    )

    const now = Date.now()

    const result = holds.map((h) => {
      let itemDescription: string | null = null
      if (h.itemType === 'sign') itemDescription = signDesc.get(h.itemId) ?? null
      else if (h.itemType === 'rider') itemDescription = riderDesc.get(h.itemId) ?? null
      else if (h.itemType === 'lockbox') itemDescription = lockboxDesc.get(h.itemId) ?? null

      return {
        id: h.id,
        itemType: h.itemType,
        itemId: h.itemId,
        itemDescription,
        ownerEmail: h.owner.email,
        ownerFullName: h.owner.fullName ?? h.owner.name ?? null,
        actorEmail: h.actor.email,
        onBehalfOfEmail: h.onBehalfOf?.email ?? null,
        cartSessionId: h.cartSessionId,
        cartItemId: h.cartItemId,
        expiresAt: h.expiresAt.toISOString(),
        ageSeconds: Math.floor((now - h.createdAt.getTime()) / 1000),
        assignedToMemberIdSnapshot: h.assignedToMemberIdSnapshot,
      }
    })

    return NextResponse.json({ holds: result })
  } catch (error) {
    console.error('Error fetching live holds:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
