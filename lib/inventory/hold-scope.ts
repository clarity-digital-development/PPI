/**
 * Scope checks for inventory holds against SHARED inventory.
 *
 * A hold hides its row from `/api/inventory` for everyone except the holder.
 * That was harmless while every holdable row belonged to the person holding
 * it. Linked brokerage inventory (Ryan, 2026-09-08) breaks that assumption:
 * one agent can now hold rows out of a pool the whole brokerage draws from.
 *
 * An ownership check alone does NOT solve this. A linked agent is legitimately
 * inside the allow-list for the pool, so "may you hold this?" is yes for all
 * 317 of Semonin's signs. What has to be bounded is HOW MANY someone may hold
 * at once out of inventory that is not theirs -- otherwise one agent (or one
 * buggy client looping the picker) can make the brokerage's whole pool
 * unorderable for the brokerage itself and every other agent, renewing it
 * indefinitely through the bump endpoint.
 */
import { prisma } from '@/lib/prisma'
import type { HoldTx } from '@/lib/inventory-holds'

/**
 * Concurrent holds one user may have on inventory they do not personally own.
 *
 * Sized off real use, not the attack: an agent takes roughly one pooled sign
 * per order, and the largest carts seen are a couple of dozen orders. 40 leaves
 * that comfortably clear while capping any one account's reach into a
 * 317-sign pool at about a tenth of it.
 */
export const FOREIGN_HOLD_CAP = 40

const MODEL_FOR_ITEM = {
  sign: 'customerSign',
  rider: 'customerRider',
  lockbox: 'customerLockbox',
} as const

export type HoldableItemType = keyof typeof MODEL_FOR_ITEM

/** The owning userId of one holdable row, or null when it does not exist. */
export async function itemOwnerId(
  itemType: HoldableItemType,
  itemId: string
): Promise<string | null> {
  const model = (prisma as unknown as Record<string, {
    findUnique(args: unknown): Promise<{ userId: string } | null>
  }>)[MODEL_FOR_ITEM[itemType]]
  const row = await model.findUnique({ where: { id: itemId }, select: { userId: true } })
  return row?.userId ?? null
}

/**
 * How many live holds `ownerUserId` currently has on rows owned by somebody
 * else, and which hold ids they are.
 *
 * Counted by resolving each live hold's row owner: `InventoryHold` stores only
 * (itemType, itemId), so there is no join to lean on.
 */
export async function foreignHolds(
  ownerUserId: string,
  // Pass the transaction client when the count must be serialised with the
  // insert that follows it (see the hold route's advisory lock).
  client: HoldTx = prisma
): Promise<{
  count: number
  byItem: Array<{ holdId: string; itemType: HoldableItemType; itemId: string; ownerId: string; cartItemId: string | null }>
}> {
  const live = await client.inventoryHold.findMany({
    where: {
      ownerUserId,
      consumedByOrderId: null,
      releasedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, itemType: true, itemId: true, cartItemId: true },
  })
  if (live.length === 0) return { count: 0, byItem: [] }

  const byType = new Map<HoldableItemType, string[]>()
  for (const h of live) {
    const t = h.itemType as HoldableItemType
    if (!MODEL_FOR_ITEM[t]) continue
    byType.set(t, [...(byType.get(t) ?? []), h.itemId])
  }

  const owners = new Map<string, string>()
  for (const t of Array.from(byType.keys())) {
    const model = (client as unknown as Record<string, {
      findMany(args: unknown): Promise<Array<{ id: string; userId: string }>>
    }>)[MODEL_FOR_ITEM[t]]
    const rows = await model.findMany({
      where: { id: { in: byType.get(t) as string[] } },
      select: { id: true, userId: true },
    })
    for (const r of rows) owners.set(`${t}:${r.id}`, r.userId)
  }

  const byItem = live
    .map((h) => {
      const t = h.itemType as HoldableItemType
      const ownerId = owners.get(`${t}:${h.itemId}`)
      return ownerId && ownerId !== ownerUserId
        ? { holdId: h.id, itemType: t, itemId: h.itemId, ownerId, cartItemId: h.cartItemId ?? null }
        : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return { count: byItem.length, byItem }
}

/**
 * How many rows owned by SOMEBODY ELSE this account currently has out of
 * circulation through LIVE ORDERS (not just cart holds). The hold cap alone
 * only guards the cart endpoint, which a linked agent placing single orders
 * never touches -- so without this, one account could consume the whole
 * brokerage pool one order at a time.
 */
export async function foreignConsumption(holderUserId: string, client: HoldTx = prisma): Promise<number> {
  const items = await client.orderItem.findMany({
    where: {
      order: {
        OR: [{ userId: holderUserId }, { placedByUserId: holderUserId }],
        status: { not: 'cancelled' },
        paymentStatus: { in: ['succeeded', 'processing', 'pending', 'pending_invoice'] as any },
      },
      OR: [
        { customerSignId: { not: null } },
        { customerRiderId: { not: null } },
        { customerLockboxId: { not: null } },
        { customerBrochureBoxId: { not: null } },
      ],
    },
    select: { customerSignId: true, customerRiderId: true, customerLockboxId: true, customerBrochureBoxId: true },
  })
  if (items.length === 0) return 0
  const ids = (k: 'customerSignId' | 'customerRiderId' | 'customerLockboxId' | 'customerBrochureBoxId') =>
    Array.from(new Set(items.map((i) => i[k]).filter((x): x is string => !!x)))
  const [signs, riders, lockboxes, boxes] = await Promise.all([
    client.customerSign.count({ where: { id: { in: ids('customerSignId') }, userId: { not: holderUserId } } }),
    client.customerRider.count({ where: { id: { in: ids('customerRiderId') }, userId: { not: holderUserId } } }),
    client.customerLockbox.count({ where: { id: { in: ids('customerLockboxId') }, userId: { not: holderUserId } } }),
    client.customerBrochureBox.count({ where: { id: { in: ids('customerBrochureBoxId') }, userId: { not: holderUserId } } }),
  ])
  return signs + riders + lockboxes + boxes
}
