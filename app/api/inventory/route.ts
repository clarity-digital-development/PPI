import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, canActOnBehalfOf } from '@/lib/auth-utils'
import { resolveBrokeragePool } from '@/lib/inventory/brokerage-pool'

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
    // team_admin ordering for THEMSELVES: only the items not handed to any
    // agent. Everything an agent has been assigned is physically stored under
    // the team_admin's account, so an unfiltered read shows every agent's
    // signs and riders as the admin's own — and riders collapse into one
    // option per type, so picking "For Sale" could quietly take an agent's.
    const unassignedOnly = searchParams.get('unassigned') === '1'
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
    //
    // Always combined with AND (see the queries below), never spread: it can be
    // an OR, and so is the hold-visibility filter — a spread keeps only one.
    let memberFilter:
      | { assignedToMemberId: null }
      | { OR: Array<{ assignedToMemberId: string | null }> }
      | undefined
    if (unassignedOnly && user.role === 'team_admin' && !memberId && targetUserId === user.id) {
      // Own-account read only: never narrows someone else's inventory, and
      // member_id already scopes the roster path on its own. team_admin only —
      // setting memberFilter skips the brokerage-pool lookup below, which a
      // linked agent (a customer) must keep.
      memberFilter = { assignedToMemberId: null }
    } else if (memberId) {
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
      // A broker who puts HERSELF on her own roster and picks her own name is
      // ordering for herself, so she also gets her unassigned stock — exactly
      // what "Order for myself" shows. Assigned-only made her assign items to
      // herself, order, then un-assign them so her agents could see them again
      // (Ryan, 2026-09-29, Katie Kelley; Rebecca Steele is set up the same way).
      //
      // ONLY for her own row. Every other member stays assigned-only: adding
      // unassigned stock to every agent's picker let one cart row be handed
      // the copy another row had already reserved (a 409 with no way out),
      // and merged an agent's own items with generic stock so the order could
      // pull the wrong physical one. Items assigned to OTHER members stay
      // hidden either way — the "every rider showed up for everyone" bug.
      const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
      const isOwnRow =
        member.userId === user.id ||
        (!!member.email && norm(member.email) === norm(user.email)) ||
        (!!norm(member.name) && [user.fullName, user.name].some((n) => norm(n) === norm(member.name)))
      memberFilter = isOwnRow
        ? { OR: [{ assignedToMemberId: memberId }, { assignedToMemberId: null }] }
        : { OR: [{ assignedToMemberId: memberId }] }
    }

    // Linked brokerage inventory (Ryan, 2026-09-08): an agent's pickers show
    // the brokerage's pool alongside their own, so they can take a brokerage
    // sign and add their own rider.
    //
    // Resolved for the TARGET (whose order this is), not the caller. Skipped
    // entirely on the member_id branch: there the team_admin IS the pool, and
    // the rows are theirs already.
    const pool = memberFilter ? null : await resolveBrokeragePool(targetUserId)

    // SIGNS, LOCKBOXES AND RIDERS are pooled; brochure boxes are not.
    //
    // Ryan asked for the whole admin inventory — "signs, riders, and lockboxes"
    // (2026-09-08). Signs shipped first. Lockboxes followed (2026-09-28, when
    // the first linked agent — Kelli Hunt on Daphne's team — found Daphne's
    // four boxes missing): the lockbox picker selects ONE specific box by id
    // (lockbox-step.tsx handlePickStored), so an own and a brokerage box can
    // sit side by side safely, and inventory ownership already allows the
    // pool owner for every item type (lib/orders/inventory-ownership.ts).
    //
    // Riders (2026-09-29, for Katie Kelley's brokerage, which has them) with
    // one rule: a brokerage rider TYPE the agent also owns is left out.
    // RiderSelector keys selection by rider type (RiderSelector.tsx:174), so an
    // own and a brokerage rider of the same type would share one selection and
    // the wizard, resolving the id by type, could consume the wrong physical
    // rider. With that type dropped from the pool there is only ever one group
    // per type, the lookup is unambiguous, and the agent uses their own — the
    // brokerage's riders fill in the types they don't have. See the rider
    // grouping below. Brochure boxes stay own-only: they are a bare count with
    // no id, so pooling them would only inflate the number.
    //
    // From the pool: what the brokerage hasn't handed to anyone, plus what it
    // has handed to THIS agent. Rows assigned to OTHER agents stay off limits
    // (Ryan, 2026-09-28: "just the admin 'unassigned' items ... so agents
    // aren't moving things around they shouldn't be"; design doc:
    // assignedToMemberId IN (null, myMemberId)). Assigning an item to an
    // agent's roster row is how a brokerage gives it to them, so excluding
    // those too would hide the agent's own items from them.
    //
    // The agent's own rows are theirs outright. Applied with AND below, never
    // spread: the hold-visibility filter also uses an `OR` key, and a spread
    // would silently drop this one and return rows regardless of owner.
    const pooledOwnerFilter = pool
      ? {
          OR: [
            { userId: targetUserId },
            { userId: pool.ownerUserId, assignedToMemberId: null },
            { userId: pool.ownerUserId, assignedToMemberId: pool.memberId },
          ],
        }
      : { userId: targetUserId }
    const ownerFilter = { userId: targetUserId }
    const sourceOf = (rowUserId: string) =>
      pool && rowUserId === pool.ownerUserId
        ? { source: 'brokerage' as const, source_label: pool.name }
        : { source: 'own' as const, source_label: null }

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
    // Every filter goes through AND. Several are OR clauses (pool, member,
    // hold visibility); spread into one object they overwrite each other's
    // `OR` key and silently widen the result — e.g. returning rows of any owner.
    const scoped = (...clauses: Array<object | undefined>) => ({
      AND: clauses.filter((c): c is object => c !== undefined),
      inStorage: true,
    })
    const [rawSigns, rawRiders, rawLockboxes, rawBrochureBoxes] = await Promise.all([
      prisma.customerSign.findMany({
        where: scoped(pooledOwnerFilter, memberFilter, holdVisibilityFilter),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customerRider.findMany({
        where: scoped(pooledOwnerFilter, memberFilter, holdVisibilityFilter),
        include: { rider: true },
      }),
      prisma.customerLockbox.findMany({
        where: scoped(pooledOwnerFilter, memberFilter, holdVisibilityFilter),
        include: { lockboxType: true },
      }),
      prisma.customerBrochureBox.findMany({
        where: scoped(ownerFilter, memberFilter),
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
    const signs = rawSigns
      .map(sign => ({
        id: sign.id,
        description: sign.description,
        size: null, // Not tracked in current schema
        ...sourceOf(sign.userId),
        ...holdFlagsFor(sign),
      }))
      // Own inventory first so an agent's default pick stays their own.
      .sort((a, b) => (a.source === b.source ? 0 : a.source === 'own' ? -1 : 1))

    // Aggregate riders by type with quantity counts. Hold flags are reported
    // per-type as "any row in this group held by me" / earliest foreign expiry
    // so the cart UI can label the aggregated chip.
    //
    // GROUPED BY TYPE **AND SOURCE**. Each group reports one representative
    // `id`, and that id is what the wizard attaches to the order
    // (`rider-step.tsx:45`) and therefore which PHYSICAL rider gets consumed.
    // Merging an agent's own "For Sale" rider with the brokerage's into a
    // single group would hand back one id for both and silently consume
    // whichever happened to sort first -- taking a brokerage rider when the
    // agent picked their own, or the reverse. Keeping the groups separate is
    // what makes Ryan's "brokerage sign + their own rider" land on the right
    // physical items.
    const riderCounts: Record<
      string,
      {
        id: string
        rider_type: string
        quantity: number
        source: 'own' | 'brokerage'
        source_label: string | null
        held_by_me: boolean
        held_until_other: string | null
      }
    > = {}
    for (const rider of rawRiders) {
      const riderType = rider.rider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '')
      const origin = sourceOf(rider.userId)
      const key = `${riderType}::${origin.source}`
      const flags = holdFlagsFor(rider)
      if (riderCounts[key]) {
        riderCounts[key].quantity += 1
        if (flags.held_by_me) riderCounts[key].held_by_me = true
        if (flags.held_until_other) {
          const existing = riderCounts[key].held_until_other
          if (!existing || flags.held_until_other < existing) {
            riderCounts[key].held_until_other = flags.held_until_other
          }
        }
      } else {
        riderCounts[key] = {
          id: rider.id,
          rider_type: riderType,
          quantity: 1,
          ...origin,
          ...flags,
        }
      }
    }
    // Own groups first. The wizard resolves a rider by the first entry matching
    // the type, so this keeps "my own rider" the default when both exist --
    // exactly the split Ryan described.
    // A brokerage rider type the agent ALSO owns is dropped (see the pooling
    // note above): one group per type keeps the by-type lookup unambiguous, so
    // the physical rider consumed is always the one the agent meant.
    const ownRiderTypes = new Set(
      Object.values(riderCounts).filter((g) => g.source === 'own').map((g) => g.rider_type)
    )
    const riders = Object.values(riderCounts)
      .filter((g) => g.source === 'own' || !ownRiderTypes.has(g.rider_type))
      .sort((a, b) => (a.source === b.source ? 0 : a.source === 'own' ? -1 : 1))

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
        ...sourceOf(lockbox.userId),
        ...holdFlagsFor(lockbox),
      }
    })
    lockboxes.sort((a, b) => (a.source === b.source ? 0 : a.source === 'own' ? -1 : 1))

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
      // Null for everyone not linked to a brokerage, which is the vast
      // majority -- the UI shows no source labelling at all in that case.
      // `pooled` names what is actually drawn from the pool today, so the UI
      // cannot imply riders or lockboxes are shared when they are not.
      brokeragePool: pool ? { name: pool.name, pooled: ['signs', 'lockboxes', 'riders'] } : null,
    })
  } catch (error) {
    console.error('Error fetching inventory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
