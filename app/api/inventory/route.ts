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

    // Single Date instance shared by the hold-visibility filter and the
    // held_until_other computation so a row that's "live" in the query is
    // consistently flagged as a foreign-cart hold in the response.
    const currentMoment = new Date()

    // Fetch live holds owned by the requester. Items pointing at these holds
    // are visible to them (their own cart). Stale or foreign holds are handled
    // in the OR clause below.
    const myHoldRows = await prisma.inventoryHold.findMany({
      where: {
        ownerUserId: user.id,
        consumedByOrderId: null,
        releasedAt: null,
        expiresAt: { gt: currentMoment },
      },
      select: { id: true },
    })
    const myHoldIds = myHoldRows.map(h => h.id)
    const myHoldIdSet = new Set(myHoldIds)
    const canSeeForeignExpiry = user.role === 'admin'

    const holdVisibilityFilter = {
      OR: [
        { heldByHoldId: null },
        { heldUntil: { lt: currentMoment } },
        { heldByHoldId: { in: myHoldIds } },
      ],
    }

    // Fetch all inventory types in parallel
    const [rawSigns, rawRiders, rawLockboxes, rawBrochureBoxes] = await Promise.all([
      prisma.customerSign.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter, ...holdVisibilityFilter },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customerRider.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter, ...holdVisibilityFilter },
        include: { rider: true },
      }),
      prisma.customerLockbox.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter, ...holdVisibilityFilter },
        include: { lockboxType: true },
      }),
      prisma.customerBrochureBox.findMany({
        where: { userId: targetUserId, inStorage: true, ...memberFilter },
      }),
    ])

    // A row is "held by me" if it points to one of my live holds. Otherwise it
    // may have a stale heldUntil — treat that as unheld.
    const holdFlagsFor = (row: { heldByHoldId: string | null; heldUntil: Date | null }) => {
      const heldByMe = row.heldByHoldId !== null && myHoldIdSet.has(row.heldByHoldId)
      const foreignLive =
        !heldByMe &&
        row.heldByHoldId !== null &&
        row.heldUntil !== null &&
        row.heldUntil > currentMoment
      return {
        held_by_me: heldByMe,
        held_until_other:
          foreignLive && canSeeForeignExpiry && row.heldUntil
            ? row.heldUntil.toISOString()
            : null,
      }
    }

    // Transform signs to expected format
    const signs = rawSigns.map(sign => ({
      id: sign.id,
      description: sign.description,
      size: null, // Not tracked in current schema
      ...holdFlagsFor(sign),
    }))

    // Aggregate riders by type with quantity counts. Hold flags are reported
    // per-type as "any row in this group held by me" / earliest foreign expiry
    // so the cart UI can label the aggregated chip.
    const riderCounts: Record<
      string,
      {
        id: string
        rider_type: string
        quantity: number
        held_by_me: boolean
        held_until_other: string | null
      }
    > = {}
    for (const rider of rawRiders) {
      const riderType = rider.rider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '')
      const flags = holdFlagsFor(rider)
      if (riderCounts[riderType]) {
        riderCounts[riderType].quantity += 1
        if (flags.held_by_me) riderCounts[riderType].held_by_me = true
        if (flags.held_until_other) {
          const existing = riderCounts[riderType].held_until_other
          if (!existing || flags.held_until_other < existing) {
            riderCounts[riderType].held_until_other = flags.held_until_other
          }
        }
      } else {
        riderCounts[riderType] = {
          id: rider.id,
          rider_type: riderType,
          quantity: 1,
          ...flags,
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
        // Serial flows into the line-item description so installers know which physical box to bring
        serial_number: lockbox.serialNumber,
        ...holdFlagsFor(lockbox),
      }
    })

    // Aggregate brochure boxes into quantity. No hold infrastructure on this
    // model, so the flags are always { held_by_me: false, held_until_other: null }.
    const brochureBoxes = rawBrochureBoxes.length > 0
      ? { quantity: rawBrochureBoxes.length, held_by_me: false, held_until_other: null }
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
