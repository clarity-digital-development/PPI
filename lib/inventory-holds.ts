/**
 * Inventory soft-hold helper. Single source of truth for acquiring,
 * extending, releasing, and consuming cart-level reservations on the
 * polymorphic Customer{Sign,Rider,Lockbox} tables.
 *
 * Correctness invariants (changing these without thinking will break races):
 *
 *   1. `expiresAt` on InventoryHold and `heldUntil` on the Customer* row are
 *      ALWAYS updated together inside the same transaction. Bumping one
 *      without the other is the "heartbeat drift" race the adversarial
 *      review found — see docs/inventory-holds/adv-race.md.
 *
 *   2. TTL math is performed in Postgres (`NOW() + interval`), never on the
 *      Node clock — Railway pods can drift seconds from the DB host.
 *
 *   3. The partial unique index `inventory_holds_live_uniq` on
 *      (item_type, item_id) WHERE consumed_by_order_id IS NULL AND
 *      released_at IS NULL is the defense-in-depth backstop. A duplicate
 *      INSERT raises P2002 — the route layer catches and returns 409.
 *
 *   4. Conditional UPDATE on the Customer* row (heldByHoldId = $myHold AND
 *      inStorage = true) is the primary atomic claim. count !== 1 means
 *      the row was stolen, expired, or returned-to-storage.
 *
 *   5. The kill switch INVENTORY_HOLDS_ENABLED=false short-circuits every
 *      mutation to a no-op so we can roll back at runtime without a
 *      schema migration.
 *
 *   6. We do NOT write an audit row per heartbeat-driven extension.
 *      Created / Released / Expired / Conflict / Consumed / Overridden
 *      are the audited state transitions.
 */

import { Prisma, HoldItemType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { audit, AuditAction, type AuditActor } from '@/lib/audit'
import type { NextRequest } from 'next/server'

export type HoldTx = Prisma.TransactionClient | typeof prisma

const TTL_MINUTES = 15

function killed(): boolean {
  return process.env.INVENTORY_HOLDS_ENABLED === 'false'
}

export class HoldConflictError extends Error {
  status = 409 as const
  code: string
  details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

export interface AcquireHoldArgs {
  itemType: HoldItemType
  itemId: string
  ownerUserId: string
  actorUserId: string
  onBehalfOfUserId?: string | null
  cartSessionId?: string | null
  cartItemId?: string | null
  // Optional: if the caller knows which agent this item is assigned to,
  // we snapshot it so a mid-cart reassignment can be detected at claim.
  assignedToMemberIdSnapshot?: string | null
}

export interface AcquireHoldResult {
  acquired: true
  holdId: string
  expiresAt: Date
}

/**
 * Acquire a hold. Throws HoldConflictError on race / already-held / not-found.
 * Caller passes a tx (preferred — lets us batch multiple acquires in one tx);
 * otherwise we open one for the single hold.
 *
 * Lazy-sweeps any expired hold on the same (itemType, itemId) inside the
 * same tx — keeps us correct even if the cron sweeper has been down.
 */
export async function acquireHold(
  args: AcquireHoldArgs,
  opts: { tx?: HoldTx; request?: NextRequest | Request | null } = {}
): Promise<AcquireHoldResult> {
  if (killed()) {
    return { acquired: true, holdId: '', expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000) }
  }
  const run = async (tx: HoldTx) => {
    // Step 1 — lazy-sweep: kill any expired live holds on this exact item
    // so the partial unique index doesn't reject our INSERT.
    // We do this BEFORE INSERT so the unique check sees a clean slate.
    const stale = await tx.inventoryHold.findMany({
      where: {
        itemType: args.itemType,
        itemId: args.itemId,
        consumedByOrderId: null,
        releasedAt: null,
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
    })
    if (stale.length > 0) {
      const staleIds = stale.map((h) => h.id)
      await tx.inventoryHold.deleteMany({ where: { id: { in: staleIds } } })
      await clearHoldColsForIds(tx, args.itemType, staleIds)
    }

    // Step 2 — INSERT the hold row with server-computed expiry. Postgres
    // will reject (P2002 / 23505) if the partial unique index already has
    // a live row for this (itemType, itemId).
    //
    // Wrap in a SAVEPOINT so the unique-violation doesn't poison the outer
    // transaction (Postgres marks the whole tx aborted otherwise — 25P02).
    let holdId: string
    let expiresAt: Date
    try {
      await tx.$executeRawUnsafe('SAVEPOINT acquire_insert')
      const inserted = await tx.$queryRaw<Array<{ id: string; expires_at: Date }>>`
        INSERT INTO inventory_holds (
          id, item_type, item_id, owner_user_id, actor_user_id,
          on_behalf_of_user_id, assigned_to_member_id_snapshot,
          cart_session_id, cart_item_id, expires_at, created_at
        ) VALUES (
          ${cuid()},
          ${args.itemType}::"HoldItemType",
          ${args.itemId},
          ${args.ownerUserId},
          ${args.actorUserId},
          ${args.onBehalfOfUserId ?? null},
          ${args.assignedToMemberIdSnapshot ?? null},
          ${args.cartSessionId ?? null},
          ${args.cartItemId ?? null},
          NOW() + (${TTL_MINUTES} * INTERVAL '1 minute'),
          NOW()
        )
        RETURNING id, expires_at
      `
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT acquire_insert')
      holdId = inserted[0].id
      expiresAt = inserted[0].expires_at
    } catch (err) {
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT acquire_insert').catch(() => {})
      if (isUniqueViolation(err)) {
        // Look up the winner AFTER restoring the tx so we have a useful
        // error payload for the route.
        const winner = await tx.inventoryHold.findFirst({
          where: {
            itemType: args.itemType,
            itemId: args.itemId,
            consumedByOrderId: null,
            releasedAt: null,
          },
          select: { ownerUserId: true, expiresAt: true },
        })
        throw new HoldConflictError(
          'item_already_held',
          'This item is already in another cart.',
          { holderExpiresAt: winner?.expiresAt ?? null }
        )
      }
      throw err
    }

    // Step 3 — atomic conditional UPDATE on the Customer* row. The
    // predicate prevents us from clobbering a row that was returned to
    // storage, deleted, or that already points at a fresh hold (which
    // shouldn't happen given the partial unique index, but defense in
    // depth costs nothing).
    const updated = await updateHoldCols(tx, args.itemType, args.itemId, {
      heldByHoldId: holdId,
      heldUntil: expiresAt,
      condition: 'fresh', // accept rows that are unheld or whose hold expired
    })
    if (updated !== 1) {
      // Roll back our hold row — the item underneath us disappeared or
      // was stolen by a tx that committed between our INSERT and UPDATE.
      await tx.inventoryHold.delete({ where: { id: holdId } })
      throw new HoldConflictError(
        'item_unavailable',
        'This item is no longer available.',
        {}
      )
    }

    return { holdId, expiresAt }
  }

  const result = opts.tx
    ? await run(opts.tx)
    : await prisma.$transaction(run, { timeout: 8_000 })

  await audit({
    actor: { id: args.actorUserId, email: null, role: null },
    action: AuditAction.InventoryHoldCreated,
    targetType: 'inventory_hold',
    targetId: result.holdId,
    metadata: {
      itemType: args.itemType,
      itemId: args.itemId,
      ownerUserId: args.ownerUserId,
      onBehalfOfUserId: args.onBehalfOfUserId ?? null,
      cartSessionId: args.cartSessionId ?? null,
      cartItemId: args.cartItemId ?? null,
      assignedToMemberIdSnapshot: args.assignedToMemberIdSnapshot ?? null,
    },
    request: opts.request,
  })

  return { acquired: true, holdId: result.holdId, expiresAt: result.expiresAt }
}

export interface BumpHoldsArgs {
  ownerUserId: string
  // Either filter — bump every live hold this owner has, scoped optionally
  // by cart item ids (e.g. only items still in the cart).
  cartItemIds?: string[] | null
}

export interface BumpHoldsResult {
  bumped: number
  // Per-hold result so the UI can flag stale rows for re-pick.
  byCartItem: Record<string, { extended: true; expiresAt: Date } | { extended: false; reason: 'expired' | 'gone' }>
}

/**
 * Extend the TTL of all live holds owned by `ownerUserId`. CRITICAL: this
 * updates BOTH inventory_holds.expires_at AND the denormalized Customer*
 * heldUntil column in the same tx. Skipping the second update is the
 * race the adversarial review caught.
 */
export async function bumpHolds(args: BumpHoldsArgs): Promise<BumpHoldsResult> {
  if (killed()) {
    return { bumped: 0, byCartItem: {} }
  }
  const byCartItem: BumpHoldsResult['byCartItem'] = {}
  let bumped = 0

  await prisma.$transaction(async (tx) => {
    const live = await tx.inventoryHold.findMany({
      where: {
        ownerUserId: args.ownerUserId,
        consumedByOrderId: null,
        releasedAt: null,
        expiresAt: { gt: new Date() },
        ...(args.cartItemIds && args.cartItemIds.length > 0
          ? { cartItemId: { in: args.cartItemIds } }
          : {}),
      },
      select: { id: true, itemType: true, itemId: true, cartItemId: true },
    })

    if (live.length === 0) return

    const updated = await tx.$queryRaw<Array<{ id: string; expires_at: Date; cart_item_id: string | null }>>`
      UPDATE inventory_holds
      SET expires_at = NOW() + (${TTL_MINUTES} * INTERVAL '1 minute')
      WHERE id IN (${Prisma.join(live.map((h) => h.id))})
      RETURNING id, expires_at, cart_item_id
    `

    // Sync heldUntil on each Customer* row. Group by itemType for one
    // updateMany per table.
    type BumpRow = { holdId: string; itemId: string; expiresAt: Date }
    const byType: Record<HoldItemType, BumpRow[]> = { sign: [], rider: [], lockbox: [] }
    for (const u of updated) {
      const orig = live.find((l) => l.id === u.id)
      if (!orig) continue
      byType[orig.itemType].push({ holdId: u.id, itemId: orig.itemId, expiresAt: u.expires_at })
    }

    for (const itemType of Object.keys(byType) as HoldItemType[]) {
      const rows = byType[itemType]
      if (rows.length === 0) continue
      const commonExpiry = rows[0].expiresAt
      await updateHoldUntilForIds(
        tx,
        itemType,
        rows.map((r: BumpRow) => ({ id: r.itemId, holdId: r.holdId })),
        commonExpiry
      )
    }

    bumped = updated.length
    for (const u of updated) {
      if (u.cart_item_id) byCartItem[u.cart_item_id] = { extended: true, expiresAt: u.expires_at }
    }
    // Any cartItemIds the caller asked about that didn't return → expired
    if (args.cartItemIds) {
      for (const cid of args.cartItemIds) {
        if (!byCartItem[cid]) byCartItem[cid] = { extended: false, reason: 'expired' }
      }
    }
  })

  return { bumped, byCartItem }
}

export interface ReleaseHoldsArgs {
  actor: AuditActor
  // EXACTLY ONE filter must be set.
  holdId?: string
  cartItemId?: string
  ownerUserId?: string // releases ALL live holds owned by this user (clearCart)
  cartSessionId?: string // releases ALL live holds in a session
}

export async function releaseHolds(
  args: ReleaseHoldsArgs,
  opts: { tx?: HoldTx; request?: NextRequest | Request | null; reason?: string } = {}
): Promise<{ released: number }> {
  if (killed()) return { released: 0 }
  const filters = [args.holdId, args.cartItemId, args.ownerUserId, args.cartSessionId].filter(Boolean)
  if (filters.length !== 1) {
    throw new Error('releaseHolds requires exactly one of: holdId, cartItemId, ownerUserId, cartSessionId')
  }

  const run = async (tx: HoldTx) => {
    const where: Prisma.InventoryHoldWhereInput = {
      consumedByOrderId: null,
      releasedAt: null,
    }
    if (args.holdId) where.id = args.holdId
    if (args.cartItemId) where.cartItemId = args.cartItemId
    if (args.ownerUserId) where.ownerUserId = args.ownerUserId
    if (args.cartSessionId) where.cartSessionId = args.cartSessionId

    const live = await tx.inventoryHold.findMany({
      where,
      select: { id: true, itemType: true, itemId: true },
    })
    if (live.length === 0) return { released: 0 }

    await tx.inventoryHold.updateMany({
      where: { id: { in: live.map((h) => h.id) } },
      data: { releasedAt: new Date() },
    })
    // Clear the denorm columns ONLY on rows that still point at our hold —
    // an admin or another tx may have already moved the row to a new hold.
    const byType: Record<HoldItemType, string[]> = { sign: [], rider: [], lockbox: [] }
    for (const h of live) {
      byType[h.itemType].push(h.id)
    }
    for (const itemType of Object.keys(byType) as HoldItemType[]) {
      const holdIds = byType[itemType]
      if (holdIds.length === 0) continue
      await clearHoldColsForHoldIds(tx, itemType, holdIds)
    }
    return { released: live.length, holds: live }
  }

  const { released, holds } = opts.tx
    ? await run(opts.tx)
    : await prisma.$transaction(run, { timeout: 8_000 })

  // Audit each released hold.
  if (holds) {
    for (const h of holds) {
      await audit({
        actor: args.actor,
        action: AuditAction.InventoryHoldReleased,
        targetType: 'inventory_hold',
        targetId: h.id,
        metadata: { itemType: h.itemType, itemId: h.itemId, reason: opts.reason ?? null },
        request: opts.request,
      })
    }
  }

  return { released }
}

export interface HoldClaim {
  holdId: string
  itemType: HoldItemType
  itemId: string
  // Optional: if the cart-item knows which agent it's for, the claim will
  // refuse if the inventory's assignedToMemberId no longer matches.
  expectedAssignedToMemberId?: string | null
}

/**
 * Convert holds → assignments at checkout. Must be called INSIDE the same
 * transaction that creates the Order rows so a failed claim rolls back
 * the orders. Throws HoldConflictError on any mismatch — caller catches
 * and cancels the Stripe PI.
 */
export async function claimHoldsInTx(
  tx: HoldTx,
  holds: HoldClaim[],
  orderId: string,
  actor: AuditActor,
  request?: NextRequest | Request | null
): Promise<void> {
  if (killed() || holds.length === 0) return

  for (const h of holds) {
    const count = await claimOne(tx, h)
    if (count !== 1) {
      // Distinguish "item gone" from "hold lost" for a better error msg.
      const current = await readHoldCols(tx, h.itemType, h.itemId)
      let code = 'hold_lost'
      let message = 'Your reservation was lost — please re-add to cart.'
      if (!current) {
        code = 'item_gone'
        message = 'This item is no longer available.'
      } else if (current.assignedToMemberId !== h.expectedAssignedToMemberId && h.expectedAssignedToMemberId) {
        code = 'agent_reassigned'
        message = 'This item was reassigned to another agent — please re-add.'
      } else if (!current.inStorage) {
        code = 'already_assigned'
        message = 'This item is no longer in storage.'
      }
      // Audit the conflict BEFORE throwing so the row is captured even if
      // the parent tx rolls back. (audit() opens its own connection.)
      await audit({
        actor,
        action: AuditAction.InventoryHoldConflict,
        targetType: 'inventory_hold',
        targetId: h.holdId,
        metadata: { itemType: h.itemType, itemId: h.itemId, orderId, code },
        request,
      })
      throw new HoldConflictError(code, message, {
        itemType: h.itemType,
        itemId: h.itemId,
        holdId: h.holdId,
      })
    }
    // Mark the hold consumed.
    await tx.inventoryHold.update({
      where: { id: h.holdId },
      data: { consumedByOrderId: orderId },
    })
  }

  // Audit consumed-success in a single row per order so we don't quadruple
  // the log volume on multi-item orders.
  await audit({
    actor,
    action: AuditAction.InventoryHoldConsumed,
    targetType: 'order',
    targetId: orderId,
    metadata: { holdIds: holds.map((h) => h.holdId), count: holds.length },
    request,
  })
}

export interface SweepResult {
  expired: number
  consumedReaped: number
  releasedReaped: number
  oldestExpiredAgeSec: number | null
}

/**
 * Cron sweeper. Reaps:
 *   - expired live holds (clears Customer* hold cols, deletes hold row)
 *   - consumed holds (just deletes — Customer* already flipped at claim)
 *   - released holds (same)
 *
 * Wrapped in a Postgres advisory lock so overlapping cron firings no-op
 * cleanly instead of deadlocking.
 */
export async function sweepExpired(): Promise<SweepResult> {
  if (killed()) {
    return { expired: 0, consumedReaped: 0, releasedReaped: 0, oldestExpiredAgeSec: null }
  }

  return await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext('inventory-hold-sweeper')) AS ok
    `
    if (!lockRows[0]?.ok) {
      return { expired: 0, consumedReaped: 0, releasedReaped: 0, oldestExpiredAgeSec: null }
    }

    // Step 1 — expired live holds.
    const expired = await tx.inventoryHold.findMany({
      where: {
        consumedByOrderId: null,
        releasedAt: null,
        expiresAt: { lt: new Date() },
      },
      select: { id: true, itemType: true, itemId: true, expiresAt: true, ownerUserId: true },
    })

    let oldestAge: number | null = null
    if (expired.length > 0) {
      const now = Date.now()
      for (const h of expired) {
        const age = Math.floor((now - h.expiresAt.getTime()) / 1000)
        if (oldestAge === null || age > oldestAge) oldestAge = age
      }
      // Clear denorm cols WHERE heldByHoldId is one of ours — never clobber
      // a row whose hold was already replaced by a fresh acquire.
      const byType: Record<HoldItemType, string[]> = { sign: [], rider: [], lockbox: [] }
      for (const h of expired) {
        byType[h.itemType].push(h.id)
      }
      for (const itemType of Object.keys(byType) as HoldItemType[]) {
        const holdIds = byType[itemType]
        if (holdIds.length === 0) continue
        await clearHoldColsForHoldIds(tx, itemType, holdIds)
      }
      await tx.inventoryHold.deleteMany({ where: { id: { in: expired.map((h) => h.id) } } })
    }

    // Step 2 — reap consumed (post-checkout cleanup).
    const consumed = await tx.inventoryHold.deleteMany({
      where: { consumedByOrderId: { not: null } },
    })

    // Step 3 — reap released (post-cart-remove cleanup).
    const released = await tx.inventoryHold.deleteMany({
      where: { releasedAt: { not: null } },
    })

    // Audit expired holds (NOT consumed/released — those were already
    // audited at the point of state change).
    for (const h of expired) {
      await audit({
        actor: { system: true },
        action: AuditAction.InventoryHoldExpired,
        targetType: 'inventory_hold',
        targetId: h.id,
        metadata: { itemType: h.itemType, itemId: h.itemId, ownerUserId: h.ownerUserId },
      })
    }

    return {
      expired: expired.length,
      consumedReaped: consumed.count,
      releasedReaped: released.count,
      oldestExpiredAgeSec: oldestAge,
    }
  }, { timeout: 30_000 })
}

/**
 * After a Stripe payment_failed or admin cancel, release any holds tied to
 * an order AND restore inStorage = true on the order's inventory — BUT
 * only when no other live allocation references that same item id. This
 * closes the latent bug where a delayed webhook clobbers a successful
 * re-allocation (see docs/inventory-holds/adv-edge.md #2).
 *
 * Idempotent. Caller passes the order id; we look up its items.
 */
export async function releaseOrderHoldsAndRestoreInventory(
  orderId: string,
  reason: string,
  actor: AuditActor,
  request?: NextRequest | Request | null
): Promise<void> {
  if (killed()) return

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { orderItems: true },
    })
    if (!order) return

    // Restore inStorage = true on each item, but ONLY if no other live order
    // points at it and no live hold owns it.
    for (const item of order.orderItems) {
      if (item.customerSignId) {
        await restoreIfSafe(tx, 'sign', item.customerSignId, orderId)
      }
      if (item.customerRiderId) {
        await restoreIfSafe(tx, 'rider', item.customerRiderId, orderId)
      }
      if (item.customerLockboxId) {
        await restoreIfSafe(tx, 'lockbox', item.customerLockboxId, orderId)
      }
      // Brochure boxes: still in the old blind-flip path, no hold infra.
      if (item.customerBrochureBoxId) {
        await tx.customerBrochureBox.update({
          where: { id: item.customerBrochureBoxId },
          data: { inStorage: true },
        })
      }
    }

    // Delete any consumed holds tied to this order.
    await tx.inventoryHold.deleteMany({
      where: { consumedByOrderId: orderId },
    })
  }, { timeout: 15_000 })

  await audit({
    actor,
    action: AuditAction.InventoryHoldReleased,
    targetType: 'order',
    targetId: orderId,
    metadata: { reason, source: 'release_order_holds' },
    request,
  })
}

/**
 * Force-release a single hold (admin override). Writes Overridden audit.
 */
export async function overrideHold(
  holdId: string,
  actor: AuditActor,
  request?: NextRequest | Request | null,
  reason?: string
): Promise<{ released: boolean }> {
  if (killed()) return { released: false }

  const hold = await prisma.inventoryHold.findUnique({ where: { id: holdId } })
  if (!hold || hold.consumedByOrderId || hold.releasedAt) {
    return { released: false }
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryHold.update({
      where: { id: holdId },
      data: { releasedAt: new Date() },
    })
    await clearHoldColsForHoldIds(tx, hold.itemType, [holdId])
  })

  await audit({
    actor,
    action: AuditAction.InventoryHoldOverridden,
    targetType: 'inventory_hold',
    targetId: holdId,
    metadata: { itemType: hold.itemType, itemId: hold.itemId, ownerUserId: hold.ownerUserId, reason: reason ?? null },
    request,
  })

  return { released: true }
}

// ───────────────────────── internal helpers ─────────────────────────

/**
 * Detect Postgres unique-violation across the multiple shapes Prisma 7's
 * adapter-pg surfaces: P2002 from typed ORM ops, P2010 wrapping a driver
 * UniqueConstraintViolation, or raw SQLSTATE 23505 strings.
 */
function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return true
    if (err.code === 'P2010') {
      const meta = (err as { meta?: { driverAdapterError?: { cause?: unknown } } }).meta
      const causeName = (meta?.driverAdapterError as { name?: string } | undefined)?.name
      if (causeName === 'UniqueConstraintViolation') return true
      const msg = String(err.message || '')
      if (msg.includes('UniqueConstraintViolation') || msg.includes('23505') || msg.includes('inventory_holds_live_uniq')) return true
    }
  }
  const anyErr = err as { code?: string; cause?: { name?: string }; message?: string } | null
  if (anyErr?.code === '23505') return true
  if (anyErr?.cause?.name === 'UniqueConstraintViolation') return true
  if (typeof anyErr?.message === 'string' && anyErr.message.includes('inventory_holds_live_uniq')) return true
  return false
}

function cuid(): string {
  // Match Prisma's @default(cuid()) — we let DB-side default-via-application
  // generate the id so it matches existing rows. Using crypto for a stable,
  // collision-resistant value; final id length matches cuid format closely.
  const bytes = require('node:crypto').randomBytes(12).toString('hex')
  return 'c' + Date.now().toString(36) + bytes
}

async function claimOne(tx: HoldTx, h: HoldClaim): Promise<number> {
  const where: Record<string, unknown> = {
    id: h.itemId,
    heldByHoldId: h.holdId,
    inStorage: true,
  }
  if (h.expectedAssignedToMemberId !== undefined) {
    where.assignedToMemberId = h.expectedAssignedToMemberId
  }
  const data = {
    inStorage: false,
    heldByHoldId: null,
    heldUntil: null,
  }
  switch (h.itemType) {
    case 'sign': {
      const r = await tx.customerSign.updateMany({ where: where as Prisma.CustomerSignWhereInput, data })
      return r.count
    }
    case 'rider': {
      const r = await tx.customerRider.updateMany({ where: where as Prisma.CustomerRiderWhereInput, data })
      return r.count
    }
    case 'lockbox': {
      const r = await tx.customerLockbox.updateMany({ where: where as Prisma.CustomerLockboxWhereInput, data })
      return r.count
    }
  }
}

async function readHoldCols(
  tx: HoldTx,
  itemType: HoldItemType,
  itemId: string
): Promise<{ inStorage: boolean; heldByHoldId: string | null; assignedToMemberId: string | null } | null> {
  switch (itemType) {
    case 'sign':
      return tx.customerSign.findUnique({
        where: { id: itemId },
        select: { inStorage: true, heldByHoldId: true, assignedToMemberId: true },
      })
    case 'rider':
      return tx.customerRider.findUnique({
        where: { id: itemId },
        select: { inStorage: true, heldByHoldId: true, assignedToMemberId: true },
      })
    case 'lockbox':
      return tx.customerLockbox.findUnique({
        where: { id: itemId },
        select: { inStorage: true, heldByHoldId: true, assignedToMemberId: true },
      })
  }
}

interface UpdateHoldColsArgs {
  heldByHoldId: string | null
  heldUntil: Date | null
  // 'fresh' = only update rows that are unheld or whose hold expired.
  // 'unconditional' = update by id regardless (used for clearOnRelease).
  condition: 'fresh' | 'unconditional'
}

async function updateHoldCols(
  tx: HoldTx,
  itemType: HoldItemType,
  itemId: string,
  args: UpdateHoldColsArgs
): Promise<number> {
  const data = { heldByHoldId: args.heldByHoldId, heldUntil: args.heldUntil }
  const where: Record<string, unknown> = { id: itemId }
  if (args.condition === 'fresh') {
    where.OR = [
      { heldByHoldId: null },
      { heldUntil: { lt: new Date() } },
    ]
    where.inStorage = true
  }
  switch (itemType) {
    case 'sign': {
      const r = await tx.customerSign.updateMany({ where: where as Prisma.CustomerSignWhereInput, data })
      return r.count
    }
    case 'rider': {
      const r = await tx.customerRider.updateMany({ where: where as Prisma.CustomerRiderWhereInput, data })
      return r.count
    }
    case 'lockbox': {
      const r = await tx.customerLockbox.updateMany({ where: where as Prisma.CustomerLockboxWhereInput, data })
      return r.count
    }
  }
}

/** Clear hold cols on Customer* rows where heldByHoldId is in the given list. */
async function clearHoldColsForHoldIds(tx: HoldTx, itemType: HoldItemType, holdIds: string[]): Promise<void> {
  if (holdIds.length === 0) return
  const data = { heldByHoldId: null, heldUntil: null }
  switch (itemType) {
    case 'sign':
      await tx.customerSign.updateMany({ where: { heldByHoldId: { in: holdIds } }, data })
      return
    case 'rider':
      await tx.customerRider.updateMany({ where: { heldByHoldId: { in: holdIds } }, data })
      return
    case 'lockbox':
      await tx.customerLockbox.updateMany({ where: { heldByHoldId: { in: holdIds } }, data })
      return
  }
}

/** Alias for backward-compat / readability. */
async function clearHoldColsForIds(tx: HoldTx, itemType: HoldItemType, holdIds: string[]): Promise<void> {
  return clearHoldColsForHoldIds(tx, itemType, holdIds)
}

async function updateHoldUntilForIds(
  tx: HoldTx,
  itemType: HoldItemType,
  rows: Array<{ id: string; holdId: string }>,
  newExpiry: Date
): Promise<void> {
  // Per-row update so each Customer* row's heldUntil matches its specific
  // hold (defense — in practice all rows here share newExpiry but a future
  // per-hold extension would break the shortcut).
  for (const r of rows) {
    switch (itemType) {
      case 'sign':
        await tx.customerSign.updateMany({
          where: { id: r.id, heldByHoldId: r.holdId },
          data: { heldUntil: newExpiry },
        })
        break
      case 'rider':
        await tx.customerRider.updateMany({
          where: { id: r.id, heldByHoldId: r.holdId },
          data: { heldUntil: newExpiry },
        })
        break
      case 'lockbox':
        await tx.customerLockbox.updateMany({
          where: { id: r.id, heldByHoldId: r.holdId },
          data: { heldUntil: newExpiry },
        })
        break
    }
  }
}

async function restoreIfSafe(
  tx: HoldTx,
  itemType: HoldItemType,
  itemId: string,
  excludeOrderId: string
): Promise<void> {
  // Are there other live orders pointing at this item that haven't failed?
  // (Same column on OrderItem keyed by itemType.)
  const colMap = {
    sign: 'customerSignId',
    rider: 'customerRiderId',
    lockbox: 'customerLockboxId',
  } as const
  const col = colMap[itemType]
  const otherLive = await tx.orderItem.findFirst({
    where: {
      [col]: itemId,
      orderId: { not: excludeOrderId },
      order: { paymentStatus: { in: ['succeeded', 'processing', 'pending'] } },
    },
    select: { id: true },
  })
  if (otherLive) return // do not clobber

  // Any live hold on this item? Don't restore inStorage if a live hold
  // owns the row.
  const liveHold = await tx.inventoryHold.findFirst({
    where: {
      itemType,
      itemId,
      consumedByOrderId: null,
      releasedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  })
  if (liveHold) return

  // Safe to restore.
  switch (itemType) {
    case 'sign':
      await tx.customerSign.updateMany({
        where: { id: itemId, inStorage: false },
        data: { inStorage: true, heldByHoldId: null, heldUntil: null },
      })
      return
    case 'rider':
      await tx.customerRider.updateMany({
        where: { id: itemId, inStorage: false },
        data: { inStorage: true, heldByHoldId: null, heldUntil: null },
      })
      return
    case 'lockbox':
      await tx.customerLockbox.updateMany({
        where: { id: itemId, inStorage: false },
        data: { inStorage: true, heldByHoldId: null, heldUntil: null },
      })
      return
  }
}
