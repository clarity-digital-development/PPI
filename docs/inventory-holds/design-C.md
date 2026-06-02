# Approach C — Hybrid: InventoryHold Table + DB-Level Uniqueness Backstop

This design treats the `InventoryHold` table as the **coordination layer** (it gives the UI something to read and the cart something to refresh) and a **Postgres partial unique index on each Customer\* table** as the **correctness layer** (the database, not the application, decides who loses the race). Atomic claim is "try to insert/update; if the index throws `P2002`, you lost — surface 409 and let the user re-pick."

This means the app never needs `SELECT … FOR UPDATE`, never needs `Serializable`, never needs application-level mutexes. The constraint is the lock.

---

## 1. Schema changes

All changes are **additive, nullable, and safe for `prisma db push`**. No existing rows need backfill. No required columns. No drops.

### 1a. New `InventoryHold` model

```prisma
// prisma/schema.prisma  (append after AuditLog block, ~line 680)

enum HoldItemType {
  sign
  rider
  lockbox
  brochure_box
}

model InventoryHold {
  id              String        @id @default(cuid())
  itemType        HoldItemType  @map("item_type")
  itemId          String        @map("item_id")          // FK target varies by itemType; not a hard FK (polymorphic)
  ownerUserId     String        @map("owner_user_id")    // who is building the cart (team_admin / customer / admin)
  actorUserId     String        @map("actor_user_id")    // who clicked (same as owner except admin/on-behalf-of)
  cartSessionId   String?       @map("cart_session_id")  // forward-compat: server-cart row id once track #4 lands
  cartItemId      String?       @map("cart_item_id")     // localStorage CartItem.id today; server CartItem.id tomorrow
  expiresAt       DateTime      @map("expires_at")
  releasedAt      DateTime?     @map("released_at")      // soft-release marker; row is hard-deleted by sweeper
  consumedByOrderId String?     @map("consumed_by_order_id") // set when claim succeeds; nulled if released
  createdAt       DateTime      @default(now()) @map("created_at")

  owner User @relation("InventoryHoldOwner", fields: [ownerUserId], references: [id], onDelete: Cascade)
  actor User @relation("InventoryHoldActor", fields: [actorUserId], references: [id], onDelete: Cascade)

  @@index([itemType, itemId])
  @@index([ownerUserId])
  @@index([cartItemId])
  @@index([expiresAt])               // sweeper scan
  @@map("inventory_holds")
}
```

Add corresponding reverse relations on `User`:

```prisma
heldInventoryAsOwner InventoryHold[] @relation("InventoryHoldOwner")
heldInventoryAsActor InventoryHold[] @relation("InventoryHoldActor")
```

**No `@@unique([itemType, itemId])` on the Prisma model.** Why: an item can have many *expired* or *released* hold rows over its lifetime (we keep them briefly for audit and forensics before the sweeper deletes). Uniqueness for "actively held" is enforced by a partial unique index added via raw SQL — see 1c.

### 1b. New nullable `heldByHoldId` columns on the four Customer\* tables

This is the column the **partial unique index** targets. It is the single source of truth for "is this physical item currently spoken for, by which hold."

```prisma
// CustomerSign
heldByHoldId  String? @map("held_by_hold_id")
heldUntil     DateTime? @map("held_until")

// repeat the two columns on CustomerRider, CustomerLockbox, CustomerBrochureBox
```

Both are nullable. `heldUntil` is denormalized off the hold row so `GET /api/inventory` can filter without joining four ways. The hold record remains the source of truth; these two columns are written transactionally with the hold.

### 1c. Raw-SQL migration for the partial unique indexes (the backstop)

`prisma db push` will not generate these — they must be applied via a `prisma migrate` SQL file OR via `prisma db execute` as a one-shot. Add a new file:

**`prisma/migrations/manual/2026-06-02-inventory-hold-unique.sql`** (apply manually with `prisma db execute --file …`):

```sql
-- Prevent two LIVE holds on the same physical item. A hold is "live" iff
-- held_by_hold_id IS NOT NULL. The sweeper sets it back to NULL on release/expiry.
CREATE UNIQUE INDEX IF NOT EXISTS customer_signs_held_by_hold_id_unique
  ON customer_signs (id)
  WHERE held_by_hold_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_riders_held_by_hold_id_unique
  ON customer_riders (id)
  WHERE held_by_hold_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_lockboxes_held_by_hold_id_unique
  ON customer_lockboxes (id)
  WHERE held_by_hold_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_brochure_boxes_held_by_hold_id_unique
  ON customer_brochure_boxes (id)
  WHERE held_by_hold_id IS NOT NULL;
```

Wait — `id` is already PK-unique. The partial index above is a no-op for race protection. We need the index on the *fact that something is held*, but uniqueness on `id WHERE held_by_hold_id IS NOT NULL` only protects against duplicate `id` rows (impossible). **The real backstop is a conditional UPDATE in the claim step** (see §3), not a partial unique index. The hold table itself is what needs the partial unique:

**Corrected backstop — partial unique on `inventory_holds`:**

```sql
-- The real correctness backstop: at most one LIVE hold per (itemType, itemId).
-- A hold is "live" iff consumed_by_order_id IS NULL AND released_at IS NULL.
-- Combined with expires_at > now() filtering in queries, this gives us the
-- "at most one active hold" guarantee at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_holds_live_unique
  ON inventory_holds (item_type, item_id)
  WHERE consumed_by_order_id IS NULL AND released_at IS NULL;
```

This is the index `P2002` will fire on when two carts race to hold the same item. Expired-but-not-swept holds still occupy the slot until the sweeper deletes them OR until acquisition logic does opportunistic cleanup (see §3). That's fine — the worst case is a 15-minute false-negative on a stolen item, which the user can re-attempt by picking a different physical row.

For the **claim step's** race protection, we rely on a conditional `UPDATE … WHERE held_by_hold_id = $holdId` on the Customer\* row: only the transaction holding the right hold id can flip `inStorage:false`. If two transactions race, one finds `held_by_hold_id` already wiped by the other and `updateMany` returns `count: 0` → throw 409.

### 1d. Migration commands

```bash
# additive prisma changes
npx prisma db push

# manual SQL for the partial unique index
npx prisma db execute --file prisma/migrations/manual/2026-06-02-inventory-hold-unique.sql
```

Both are safe to re-run.

---

## 2. Hold lifecycle

### When a hold is **created**

Holds are created at **the moment a wizard step picks a specific inventory id** — not at "add to cart," not at checkout. Rationale: the race window opens the instant the user sees the picker, and a team_admin can keep two wizard tabs open. Holding at pick-time also fixes the existing bug where `review-step.tsx handleAddToCart` strips inventory ids — the hold row carries the (itemType, itemId, cartItemId) tuple so checkout can reconstitute the assignment even if the cart payload doesn't.

Specifically a hold is created/extended by `POST /api/inventory/holds` from each picker:
- `sign-step.tsx` and `second-post-step.tsx` on sign select
- `rider-step.tsx` and `second-post-step.tsx` on rider slug match (one hold per matched CustomerRider id; brochure-box / aggregated items get one hold per quantity unit, popping the next available row)
- `lockbox-step.tsx` on lockbox select

The TTL is **15 minutes from creation; bumped to 15 minutes on every cart-page heartbeat** (see §2c).

### When a hold is **released**

| Trigger | File / handler | Action |
|---|---|---|
| User navigates away from wizard step / changes pick | `*-step.tsx` `useEffect` cleanup + onChange | `DELETE /api/inventory/holds/:id` (best-effort; sweeper cleans up if missed) |
| User removes cart row | `lib/cart.ts` `removeItem` | `DELETE /api/inventory/holds?cartItemId=…` |
| User clears cart | `lib/cart.ts` `clearCart` | `DELETE /api/inventory/holds?ownerUserId=me` |
| Checkout succeeds (claim) | `app/api/orders/batch/route.ts` inside `$transaction` | `UPDATE inventory_holds SET consumed_by_order_id = $orderId` |
| Stripe `payment_intent.payment_failed` / `canceled` | `app/api/webhooks/stripe/route.ts` | Existing `restoreOrderInventory` extended to nuke any holds that pointed at the same items (defensive; holds at this stage should already be consumed) |
| TTL expiry | Sweeper (see §2c) | Hard `DELETE` from `inventory_holds` + `UPDATE customer_X SET held_by_hold_id = NULL, held_until = NULL WHERE held_by_hold_id = …` |
| Tab close / browser kill | (no signal) | Sweeper handles it after 15 min |

### TTL sweeper

A single cron route, called by Vercel Cron / Railway scheduler / a /loop, every 60 seconds:

**`app/api/cron/inventory-hold-sweeper/route.ts`** (new):

```ts
// auth: require CRON_SECRET header
const now = new Date();

await prisma.$transaction(async (tx) => {
  // 1. Find expired live holds
  const expired = await tx.inventoryHold.findMany({
    where: {
      expiresAt: { lt: now },
      consumedByOrderId: null,
      releasedAt: null,
    },
    select: { id: true, itemType: true, itemId: true, ownerUserId: true },
  });

  if (expired.length === 0) return;

  // 2. Per-itemType batch UPDATE: clear held_by_hold_id only if it still
  //    points at one of our expired hold ids (avoid clobbering a hold that
  //    raced in between our SELECT and UPDATE).
  const byType = groupBy(expired, 'itemType');
  for (const [itemType, rows] of Object.entries(byType)) {
    const model = pickModel(tx, itemType); // customerSign | customerRider | ...
    const holdIds = rows.map((r) => r.id);
    await model.updateMany({
      where: { heldByHoldId: { in: holdIds } },
      data: { heldByHoldId: null, heldUntil: null },
    });
  }

  // 3. Delete the hold rows (or set releasedAt = now() and let a separate
  //    daily GC drop them — either works)
  await tx.inventoryHold.deleteMany({
    where: { id: { in: expired.map((e) => e.id) } },
  });

  // 4. Audit
  await Promise.all(
    expired.map((e) =>
      audit({
        action: AuditAction.InventoryHoldExpired,
        actorUserId: e.ownerUserId,
        targetType: e.itemType,
        targetId: e.itemId,
        metadata: { holdId: e.id },
      }, tx),
    ),
  );
});
```

Also wired as a **lazy-on-read sweeper inside `POST /api/inventory/holds`** — before attempting to insert a new hold, opportunistically delete any expired live holds on the same `(itemType, itemId)`. This guarantees that even if cron is down, the next attempt to pick a stolen item succeeds.

### Heartbeat (TTL bump)

`app/dashboard/cart/page.tsx` already polls promo codes; add a 5-minute interval calling `PATCH /api/inventory/holds/bump` with the list of `cartItemId`s in the active cart. Handler does:

```ts
await prisma.inventoryHold.updateMany({
  where: {
    ownerUserId: session.user.id,
    cartItemId: { in: body.cartItemIds },
    consumedByOrderId: null,
    releasedAt: null,
  },
  data: { expiresAt: addMinutes(new Date(), 15) },
});
```

If the bump touches zero rows for a cartItemId, the UI surfaces "Your hold on X expired — please re-select."

---

## 3. Atomic claim algorithm

The claim happens inside the existing `$transaction` in `app/api/orders/batch/route.ts` (and the to-be-fixed `app/api/orders/route.ts`). The algorithm relies on two guards, in this order:

1. **Hold ownership**: only the caller's live holds count.
2. **Conditional UPDATE on Customer\* rows**: `WHERE held_by_hold_id = $holdId AND inStorage = true` — if `updateMany.count !== 1`, someone else got there first.

### Pseudo-code (single transaction, no isolation upgrade)

```ts
// Given: incoming batch body. Reconstitute customer_*_id refs from holds
// by joining cart items → InventoryHold (ownerUserId = me, consumed = null).

await prisma.$transaction(async (tx) => {
  // PHASE 1: lock in the holds we plan to consume. We pre-stamp them with
  // a placeholder consumedByOrderId so a parallel sweeper won't delete them.
  const holds = await tx.inventoryHold.findMany({
    where: {
      ownerUserId: me,
      cartItemId: { in: cartItemIds },
      consumedByOrderId: null,
      releasedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  // Build a (cartItemId, itemType, itemId) → holdId map.
  // If any expected hold is missing, abort 409 "hold expired, re-pick".

  // PHASE 2: create orders + order items as today, attaching customer_*_id
  // from the holds map (this is also what fixes the cart-strips-ids bug).
  const createdOrders = [];
  for (const orderPayload of orders) {
    const order = await tx.order.create({
      data: {
        ...orderPayload,
        orderItems: { create: rebuildItemsWithHoldIds(orderPayload, holds) },
      },
    });
    createdOrders.push(order);
  }

  // PHASE 3: atomic claim. For each (itemType, itemId, holdId) we expect to win:
  for (const h of holds) {
    const model = pickModel(tx, h.itemType);
    const { count } = await model.updateMany({
      where: {
        id: h.itemId,
        heldByHoldId: h.id,       // ← key guard: only the rightful holder
        inStorage: true,          // ← belt-and-suspenders: not already taken
      },
      data: {
        inStorage: false,
        heldByHoldId: null,
        heldUntil: null,
      },
    });

    if (count !== 1) {
      // The hold's row no longer matches: either another tx already claimed
      // it via a different hold, the sweeper nuked the hold, or admin
      // returned it to storage mid-flight. Throw to abort the whole tx.
      throw new HoldRaceError(h.itemType, h.itemId);
    }
  }

  // PHASE 4: mark holds consumed. The partial unique index on
  // (item_type, item_id) WHERE consumed_by_order_id IS NULL allows this
  // because we're moving them OUT of the live set.
  await tx.inventoryHold.updateMany({
    where: { id: { in: holds.map((h) => h.id) } },
    data: { consumedByOrderId: /* per-hold, via separate updates if needed */ },
  });

  // PHASE 5: audit
  await Promise.all(holds.map((h) =>
    audit({
      action: AuditAction.InventoryHoldConsumed,
      actorUserId: me,
      targetType: h.itemType,
      targetId: h.itemId,
      metadata: { holdId: h.id, orderId: /* ... */ },
    }, tx),
  ));
});
```

### Why this is safe under N concurrent requests

- The first transaction to commit phase 3 sets `heldByHoldId = NULL` on the Customer\* row. Any second transaction whose `where: { heldByHoldId: <its own hold id> }` filter ran *before* commit but updated *after* will get `count: 0` (the row no longer matches) and throw. The classic Read-Committed write-write race resolves cleanly because **conditional UPDATEs in Postgres re-evaluate the WHERE against the latest committed row version**.
- The partial unique index on `inventory_holds(item_type, item_id) WHERE consumed_by_order_id IS NULL AND released_at IS NULL` guarantees only one tx ever sees a live hold for a given (type, id) in phase 1 — the second concurrent tx would have failed `P2002` at hold *creation* time, long before checkout.
- Even if the partial unique index were missing (e.g. someone forgets to run the raw SQL), the conditional `updateMany` in phase 3 alone is sufficient. The index is the backstop; the conditional update is the primary mechanism.
- No `SELECT … FOR UPDATE`, no isolation upgrade, no deadlock risk (updates run in a deterministic order: per-order, per-item-type — and we sort by `(itemType, itemId)` before phase 3 to eliminate AB/BA deadlocks if two carts share two items).

### Error handling

Catch `HoldRaceError` and Prisma `P2002` / `P2034` at the route level, map to **HTTP 409** with body:

```json
{
  "error": "inventory_hold_conflict",
  "conflicts": [
    { "itemType": "sign", "itemId": "cuid_x", "reason": "claimed_by_another_cart" }
  ]
}
```

Cart UI shows a toast "[Item] is no longer available — please re-select" and refetches `/api/inventory` (which now correctly filters out items where `heldByHoldId IS NOT NULL AND heldUntil > now()` for *other* owners).

---

## 4. File-by-file change list

### New files

| File | Purpose |
|---|---|
| `prisma/migrations/manual/2026-06-02-inventory-hold-unique.sql` | Partial unique index on `inventory_holds` |
| `lib/inventory-holds.ts` | Helpers: `acquireHold`, `releaseHold`, `bumpHold`, `claimHoldsInTx`, `HoldRaceError`, `pickModel(tx, itemType)` |
| `app/api/inventory/holds/route.ts` | `POST` (acquire), `DELETE` (release by id / cartItemId / ownerUserId), `PATCH /bump` |
| `app/api/cron/inventory-hold-sweeper/route.ts` | Cron-protected TTL sweeper |
| `scripts/sweep-inventory-holds.ts` | CLI fallback if cron isn't wired |
| `__tests__/inventory-holds.test.ts` | Concurrency tests using `Promise.all` of two transactions racing for the same item |

### Edited files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `InventoryHold` model + `HoldItemType` enum; add `heldByHoldId` + `heldUntil` to `CustomerSign`/`CustomerRider`/`CustomerLockbox`/`CustomerBrochureBox`; add reverse relations on `User`; add `AuditAction.InventoryHoldCreated / InventoryHoldReleased / InventoryHoldExpired / InventoryHoldConsumed / InventoryHoldConflict` |
| `lib/audit.ts` | Add the 5 new `AuditAction` constants |
| `lib/validations.ts` | Add `acquireHoldSchema`, `releaseHoldSchema`, `bumpHoldSchema` |
| `app/api/inventory/route.ts` | `GET` filter: exclude items where `heldByHoldId IS NOT NULL AND heldUntil > now() AND <not owned by caller>`; include `held_by_me` flag on items the caller currently holds so the UI can show "still yours, 12:34 left" |
| `components/order-flow/steps/sign-step.tsx` | On select: `acquireHold('sign', id, cartItemId)`; on un-select: `releaseHold(id)`; useEffect cleanup releases on unmount if order not yet placed |
| `components/order-flow/steps/second-post-step.tsx` | Same as above for both sign and rider sub-pickers |
| `components/order-flow/steps/rider-step.tsx` | Same; one hold per matched `CustomerRider` id |
| `components/order-flow/steps/lockbox-step.tsx` | Same |
| `components/order-flow/steps/brochure-box-step.tsx` | New: actually pop `CustomerBrochureBox` rows by quantity and hold each. This also fixes the existing aggregated-quantity gap. |
| `components/order-flow/steps/review-step.tsx` | `handleAddToCart` STOPS stripping inventory ids; preserves `customer_*_id` on cart items so checkout doesn't need to reconstruct via formData. Also tags cart row with the holdIds it owns. |
| `lib/cart.ts` | `removeItem` and `clearCart` issue `DELETE /api/inventory/holds`; new `cartItemHoldIds` field on `CartItem` |
| `app/dashboard/cart/page.tsx` | 5-minute heartbeat calling `PATCH /api/inventory/holds/bump`; banner "Hold expires in 12:34" per row; refetch + reconcile on 409 |
| `app/api/orders/route.ts` | Move `inventoryUpdates` INTO a `$transaction` block; consume holds via `claimHoldsInTx` instead of blind `inStorage:false`; return 409 on `HoldRaceError` |
| `app/api/orders/batch/route.ts` | Same: replace blind `tx.customerX.update({ inStorage:false })` loop with `claimHoldsInTx(tx, holds)`; return 409 with per-item conflict list on race |
| `app/api/orders/[id]/edit/route.ts` | Order edit must acquire holds for newly-added items (and release for removed). Same atomic claim helper. |
| `app/api/admin/customers/[id]/inventory/route.ts` | `return_to_storage` action: refuse if `heldByHoldId IS NOT NULL` unless `?force=true` is passed (with audit); same for hard `DELETE` |
| `app/api/webhooks/stripe/route.ts` | `restoreOrderInventory` already nukes `inStorage` — extend to also delete any stale `InventoryHold` rows that pointed at the same items (defensive) |
| `app/api/teams/inventory/route.ts` | `assignedToMemberId` reassign should refuse if the item is currently held by someone other than the assigning admin |
| `vercel.json` (or Railway scheduler config) | Wire `/api/cron/inventory-hold-sweeper` to run every 60s with `CRON_SECRET` header |

---

## 5. Failure modes designed AROUND

1. **Two team_admins on two devices both pick CustomerSign id `X` from the same shared customer's inventory at roughly the same moment.** The first `POST /api/inventory/holds` succeeds. The second hits `P2002` on the partial unique index on `inventory_holds (item_type, item_id) WHERE consumed_by_order_id IS NULL AND released_at IS NULL`, receives 409, and the picker UI immediately greys out the row and reloads `/api/inventory` to show "Held by Alice for 14:52." Neither user ever reaches checkout with a conflicting cart.

2. **One team_admin opens two browser tabs of `/place-order`, picks the same physical sign in both (the existing self-race the "duplicates collapsed for UX" bug enables).** Same protection as above — the hold table is keyed on `(itemType, itemId)`, not on cart session. Tab 2's `POST /api/inventory/holds` returns 409 referencing tab 1's hold; the picker tells the user "You've already reserved this sign in another tab" and refuses the pick.

3. **Cart sits open while sweeper runs.** Two carts race past the sweeper: cart A's hold expires at T+15:00, sweeper runs at T+15:30 and deletes A's hold, cart B opens at T+15:31 and acquires a new hold on the same item, cart A's user clicks "Checkout" at T+15:35. In phase 3 of A's claim transaction, `updateMany({ where: { id, heldByHoldId: <A's expired holdId>, inStorage: true } })` returns `count: 0` (A's holdId is no longer on the row — B's is). A's transaction throws `HoldRaceError`, the batch rolls back fully, no orders are created, no inventory is flipped, A's user sees "Item X was reserved by another cart while you were checking out — please re-pick."

---

## 6. Failure modes ACCEPTED

1. **15-minute false-negative window after a hold expires but before the sweeper deletes the row.** If the cron is delayed (Vercel cold start, Railway scheduler hiccup) and the lazy-on-read cleanup hasn't been triggered, an item whose hold expired at T+15:00 may appear "held" to a new picker until the sweeper runs. Worst case: a user sees "Currently held by someone else" for an item that is actually free, retries in 60 seconds, succeeds. This is strictly conservative — we under-allocate, never over-allocate — and the lazy cleanup inside `POST /api/inventory/holds` means any actual pick attempt clears the stale row in the same request. Not worth the complexity of pushing TTL enforcement into a Postgres `EXCLUDE USING gist` constraint with `tstzrange`.

2. **Admin "force return to storage" or hard `DELETE` of a Customer\* row while it's held by a live cart.** The check we add (`refuse if heldByHoldId IS NOT NULL unless ?force=true`) protects the common case but admins with the force flag can still yank an item out from under a cart. If they do, the cart's eventual checkout fails in phase 3 (`updateMany` returns 0 because `heldByHoldId` is now NULL) and the user gets a 409. We accept this because admins overriding a hold is by definition an out-of-band correction — they're saying "I know better, this item is physically gone / damaged / mis-cataloged" — and forcing them through a 15-minute wait would harm operational reality more than it helps. The audit log captures the override with `AuditAction.InventoryHoldOverridden` so post-hoc forensics are intact.