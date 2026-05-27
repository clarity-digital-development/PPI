import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, canActOnBehalfOf } from '@/lib/auth-utils'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Admin / team_admin can fetch another customer's inventory when placing
    // an order on their behalf. Always defer to the canActOnBehalfOf check.
    const { searchParams } = new URL(request.url)
    const onBehalfOf = searchParams.get('on_behalf_of')
    const memberId = searchParams.get('member_id')
    let targetUserId = user.id
    if (onBehalfOf && onBehalfOf !== user.id) {
      if (!(await canActOnBehalfOf(user, onBehalfOf))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      targetUserId = onBehalfOf
    }

    // Team feature: when a team_admin loads a managed agent's (TeamMember's)
    // inventory, return items from the team_admin's own pool that are assigned
    // to that member. Name-only members have no userId, so we filter by
    // assignedToMemberId rather than ownership.
    let memberFilter: { assignedToMemberId: string } | undefined
    if (memberId) {
      if (user.role !== 'admin' && user.role !== 'team_admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const member = await prisma.teamMember.findUnique({ where: { id: memberId } })
      if (!member || member.removedAt) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }
      if (user.role !== 'admin' && member.teamId !== user.teamId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Items are physically held under the team_admin's account.
      targetUserId = user.id
      memberFilter = { assignedToMemberId: memberId }
    }

    // Fetch all inventory types in parallel
    const [rawSigns, rawRiders, rawLockboxes, rawBrochureBoxes] = await Promise.all([
      prisma.customerSign.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customerRider.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter },
        include: { rider: true },
      }),
      prisma.customerLockbox.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter },
        include: { lockboxType: true },
      }),
      prisma.customerBrochureBox.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter },
      }),
    ])

    // Transform signs to expected format
    const signs = rawSigns.map(sign => ({
      id: sign.id,
      description: sign.description,
      size: null, // Not tracked in current schema
    }))

    // Aggregate riders by type with quantity counts
    const riderCounts: Record<string, { id: string; rider_type: string; quantity: number }> = {}
    for (const rider of rawRiders) {
      const riderType = rider.rider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '')
      if (riderCounts[riderType]) {
        riderCounts[riderType].quantity += 1
      } else {
        riderCounts[riderType] = {
          id: rider.id,
          rider_type: riderType,
          quantity: 1,
        }
      }
    }
    const riders = Object.values(riderCounts)

    // Transform lockboxes — include both raw name and a 'family' tag so the UI
    // can group "SentriLock" vs "Mechanical (Customer Owned)" vs "Mechanical
    // (Rental)" without depending on punctuation matching
    const lockboxes = rawLockboxes.map(lockbox => {
      const dbName = lockbox.lockboxType.name
      const lowered = dbName.toLowerCase()
      const family = lowered.includes('sentri')
        ? 'sentrilock'
        : lowered.includes('mechanical')
          ? 'mechanical'
          : lowered.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
      return {
        id: lockbox.id,
        lockbox_type: family, // 'sentrilock' | 'mechanical' — used by the order form
        lockbox_type_name: dbName, // human-readable for display
        lockbox_code: lockbox.code,
      }
    })

    // Aggregate brochure boxes into quantity
    const brochureBoxes = rawBrochureBoxes.length > 0
      ? { quantity: rawBrochureBoxes.length }
      : null

    return NextResponse.json({
      signs,
      riders,
      lockboxes,
      brochureBoxes,
    })
  } catch (error) {
    console.error('Error fetching inventory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
