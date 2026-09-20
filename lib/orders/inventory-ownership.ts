/**
 * Who is allowed to order with a given piece of customer inventory.
 *
 * Until now no ordering path verified this. `app/api/orders/route.ts` flipped
 * `customer_*_id` rows to `inStorage: false` **by id alone** — no owner check,
 * no "is it actually in storage" precondition — and the edit and hold paths did
 * the same. It never mattered in practice because nobody could see anyone
 * else's item ids: the pickers only ever render your own.
 *
 * Linked brokerage inventory (Ryan, 2026-09-08) removes that cover. Agents are
 * about to see a shared pool of broker-owned ids, which makes those ids
 * discoverable, so the check has to become real before the pool ships — the
 * design doc calls this out as a build requirement, not a nice-to-have.
 *
 * Two distinct failures are prevented:
 *   1. Ordering with someone else's inventory (the IDOR).
 *   2. Re-consuming an item that is already out at a property. The old blind
 *      `update` had no `inStorage: true` precondition, so the same sign could
 *      be attached to two live orders.
 */
import { prisma } from '@/lib/prisma'
import { resolveBrokeragePool } from '@/lib/inventory/brokerage-pool'

/** The inventory-bearing columns an order item can reference. */
export const INVENTORY_FIELDS = [
  'customer_sign_id',
  'customer_rider_id',
  'customer_lockbox_id',
  'customer_brochure_box_id',
] as const

export type InventoryField = (typeof INVENTORY_FIELDS)[number]

const MODEL_FOR_FIELD = {
  customer_sign_id: 'customerSign',
  customer_rider_id: 'customerRider',
  customer_lockbox_id: 'customerLockbox',
  customer_brochure_box_id: 'customerBrochureBox',
} as const

const LABEL_FOR_FIELD: Record<InventoryField, string> = {
  customer_sign_id: 'sign',
  customer_rider_id: 'rider',
  customer_lockbox_id: 'lockbox',
  customer_brochure_box_id: 'brochure box',
}

/**
 * Every user whose inventory this order may legitimately draw from:
 *   - the order's owner (the agent the order is recorded under)
 *   - the actor placing it, so a team_admin can order out of their own pool on
 *     an agent's behalf (the existing `?member_id=` flow)
 *   - the brokerage pool either of them is linked to (Ryan, 2026-09-08)
 *
 * This is the ONLY place the allow-list is built, so every consuming path
 * (create, cart, edit and the hold endpoint) inherits the brokerage pool from
 * one change.
 *
 * The pool widens what an order may consume, so it is resolved from the
 * SERVER's own view of the link -- never from anything the client sent.
 */
export async function allowedInventoryOwnerIds(opts: {
  orderUserId: string
  actorId: string
}): Promise<Set<string>> {
  const ids = new Set([opts.orderUserId, opts.actorId])

  // Distinct ids only: ordering for yourself makes these the same person.
  const principals = Array.from(new Set([opts.orderUserId, opts.actorId])).filter(Boolean)
  const pools = await Promise.all(principals.map((id) => resolveBrokeragePool(id)))
  for (const pool of pools) {
    if (pool) ids.add(pool.ownerUserId)
  }

  return ids
}

export interface InventoryCheckFailure {
  field: InventoryField
  id: string
  /** 'not_found' | 'not_owned' | 'not_in_storage' — never surfaced verbatim. */
  reason: 'not_found' | 'not_owned' | 'not_in_storage'
  /** Customer-safe sentence. Deliberately identical for not_found and
   *  not_owned so a probe can't distinguish "no such id" from "someone
   *  else's id". */
  message: string
}

type ItemLike = Partial<Record<InventoryField, string | null | undefined>>

/**
 * Verify every inventory id referenced by `items` is owned by an allowed user
 * AND still in storage. Returns [] when everything checks out.
 *
 * Call BEFORE creating the order (and before charging): a failure here should
 * be a 400, not a half-built order.
 */
export interface OwnershipCheckOptions {
  /**
   * Ids already attached to the order being edited. Ownership is still
   * enforced for these; only the `inStorage: true` precondition is waived.
   *
   * An order's own inventory is inStorage:false BY DESIGN — placement flipped
   * it — and the wizard round-trips those same ids on every save. Without this
   * waiver the storage check rejects an order's own sign and the order can
   * never be edited again. Scoped to ids on THIS order, so a sign out at a
   * DIFFERENT property is still refused.
   */
  alreadyAttached?: Partial<Record<InventoryField, Set<string>>>
}

export async function checkInventoryOwnership(
  items: ItemLike[],
  allowedOwnerIds: Set<string>,
  opts?: OwnershipCheckOptions
): Promise<InventoryCheckFailure[]> {
  // Collect unique ids per field so N items referencing the same row cost one
  // query, not N.
  const byField = new Map<InventoryField, Set<string>>()
  for (const item of items) {
    for (const field of INVENTORY_FIELDS) {
      const id = item[field]
      if (typeof id === 'string' && id) {
        const set = byField.get(field) ?? new Set<string>()
        set.add(id)
        byField.set(field, set)
      }
    }
  }
  if (byField.size === 0) return []

  const failures: InventoryCheckFailure[] = []

  // Array.from rather than iterating the Map directly — the build targets a
  // pre-ES2015 lib where Map iteration needs downlevelIteration.
  for (const field of Array.from(byField.keys())) {
    const ids = byField.get(field) as Set<string>
    const model = (prisma as unknown as Record<string, {
      findMany(args: unknown): Promise<Array<{ id: string; userId: string; inStorage: boolean }>>
    }>)[MODEL_FOR_FIELD[field]]

    const rows = await model.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, userId: true, inStorage: true },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))
    const label = LABEL_FOR_FIELD[field]

    for (const id of Array.from(ids)) {
      const row = byId.get(id)
      const wasAttached = !!opts?.alreadyAttached?.[field]?.has(id)

      if (!row) {
        // Dangling reference: the inventory row was deleted after this order
        // was placed. 40 of 296 live orders are in this state (measured
        // 2026-09-20). If the id is ALREADY on this order it is history, not
        // an attempt to consume anything -- and refusing it would strand the
        // order permanently, because a deleted sign can't be re-picked from a
        // picker that no longer lists it. New ids still fail closed.
        if (wasAttached) continue
        failures.push({
          field,
          id,
          reason: 'not_found',
          message: `That ${label} isn't available on this account. Please re-pick it and try again.`,
        })
        continue
      }

      // Ownership is enforced for EVERY id, attached or not.
      //
      // This was briefly waived for already-attached ids on the theory that
      // ownership can legitimately move after attachment. It cannot, in any way
      // that matters: bulk-reassign only writes assignedToMemberId within one
      // account, so the ONLY case the waiver covered was a revoked brokerage
      // link -- which is precisely the case where enforcement is the point.
      // Waiving it meant a brokerage could remove an agent from their roster and
      // that agent could still edit orders holding the brokerage's signs,
      // re-flipping them out of storage and changing the property address they
      // were sent to. Roster removal IS the revocation mechanism; this is what
      // makes it bite.
      //
      // The not_found and not_in_storage waivers above stay: those are about an
      // order's own history, and removing them stranded 240 of 296 live orders.
      if (!allowedOwnerIds.has(row.userId)) {
        // Same message as not_found so the response can't be used to probe
        // which ids exist on other accounts.
        failures.push({
          field,
          id,
          reason: 'not_owned',
          message: `That ${label} isn't available on this account. Please re-pick it and try again.`,
        })
        continue
      }

      if (!row.inStorage && !wasAttached) {
        failures.push({
          field,
          id,
          reason: 'not_in_storage',
          message: `That ${label} is already out at a property. Please re-pick it and try again.`,
        })
      }
    }
  }

  return failures
}

/** One sentence summarising a set of failures, for the API error body. */
export function describeInventoryFailures(failures: InventoryCheckFailure[]): string {
  if (failures.length === 0) return ''
  const unique = Array.from(new Set(failures.map((f) => f.message)))
  return unique.length === 1 ? unique[0] : unique.join(' ')
}
