# Approach B: Embedded Hold Metadata on Customer* Rows

## 1. Schema Changes

### Prisma model additions (additive, nullable only)

Add three nullable columns to **each** of `CustomerSign`, `CustomerRider`, `CustomerLockbox`, `CustomerBrochureBox`:

```prisma
model CustomerSign {
  // ... existing fields ...
  inStorage         Boolean   @default(true)
  assignedToMemberId String?

  // NEW — soft-hold metadata (Approach B)
  heldUntil         DateTime?  @map("held_until")
  heldBySessionId   String?    @map("held_by_session_id")
  heldByUserId      String?    @map("held_by_user_id")

  @@index([heldUntil])
  @@index([heldBySessionId])
}
```

Repeat identically on `CustomerRider`, `CustomerLockbox`, `CustomerBrochureBox`.

**Why three columns, not two:**
- `heldUntil` — TTL anchor; `NULL` or past = not held.
- `heldBySessionId` — the cart's hold-key (browser session UUID today; server `Cart.id` tomorrow). Lets the *same* cart re-acquire/extend its own hold without conflict.
- `heldByUserId` — denormalized for audit + admin "who's holding this?" UI without joining a session table that doesn't exist yet.

### Migration approach

```bash
# Single additive db push — no destructive ops, all nullable
npx prisma db push
```

All new columns are nullable with no default, so existing rows remain valid. Indexes are non-unique, so `db push` will not fail on existing duplicate states. **No raw SQL migration needed** — that's a key advantage of Approach B over a separate-table design with partial-unique-index requirements.

### No new tables

Critically, **no `InventoryHold` table**. The hold *is* the row; the row already has a unique `id` which gives us the per-item uniqueness for free. The race we need to defeat is "two writers want this id" — and Postgres already serializes writes on the same row.

### Why not a `@@unique` on `(id, heldBySessionId)` etc.

Uniqueness is unnecessary in Approach B because:
- A row has exactly one `id` (PK).
- Conditional `UPDATE ... WHERE` returns affected-row-count = 0 when the precondition fails. That's our conflict signal — no DB constraint needed.

---

## 2. Hold Lifecycle

### When held

**Lazy hold at item-pick time inside the wizard**, NOT at cart-add. Rationale: the cart-add path strips inventory ids (see the bug found in Exploration 2 — `review-step.tsx` `handleAddToCart` writes `item_type:'misc'`). We need the hold the moment the user *commits to that physical id*, which is when the dropdown in `sign-step.tsx` / `lockbox-step.tsx` / `rider-step.tsx` fires onChange and the id lands in `formData`.

Concretely:
- **Wizard step picker change → POST `/api/inventory/holds`** with `{ itemType, itemId, sessionId }`.
- Server sets `heldUntil = now() + 15min`, `heldBySessionId`, `heldByUserId`. Conditional update; if conflict, return 409 with the holder info and the picker reverts the selection + shows a toast.
- **Hold extension on each subsequent pick** in the same wizard session: every new POST refreshes `heldUntil` for all items already held by this `sessionId` (one extra `updateMany` per call — cheap).
- **Cart-add re-uses the existing holds.** No new server call; the items the wizard already held are still held.
- **Cart-view ping (`/api/cart/heartbeat`)** every 60s while the user is on `/dashboard/cart` extends `heldUntil` for all items where `heldBySessionId = $session AND heldUntil > now()`. One `updateMany` per Customer* table, four total — cheap.

### When released

| Trigger | Mechanism |
|---|---|
| User removes cart row | Client calls `DELETE /api/inventory/holds` with the ids from `cartItem.formData`. Server `updateMany` sets all three hold columns to `NULL` *where* `heldBySessionId = $session`. |
| User clears cart | Same DELETE with the union of ids across all `cartItem.formData` blobs. |
| Checkout success (item consumed) | The atomic-claim UPDATE in `/api/orders/batch` (§3) sets `inStorage:false` AND clears all three hold columns in the same statement. |
| Checkout fails (Stripe webhook) | `restoreOrderInventory()` in `app/api/webhooks/stripe/route.ts` is already idempotent for `inStorage:true`. We add: same call clears `heldUntil/heldBySessionId/heldByUserId` (also idempotent). |
| TTL expiry | See sweeper below. |
| User signs out / session ends | NextAuth signout callback fires `DELETE /api/inventory/holds?all_for_session=1` — best-effort. If it fails, TTL covers it. |
| Wizard "back" button removes an item | Same DELETE for that specific id. |

### TTL sweep — three layers

1. **Read-side lazy expiry (primary).** Every query that cares about availability treats `heldUntil < now()` as "not held". The atomic-claim UPDATE in §3 explicitly includes `OR heldUntil < NOW()` in its precondition, so an expired hold is automatically claimable by the next writer. **No sweeper needed for correctness.**

2. **Display-side sweep (cosmetic).** `GET /api/inventory` runs an opportunistic cleanup inside the same request: `UPDATE customer_signs SET held_until=NULL, held_by_session_id=NULL, held_by_user_id=NULL WHERE held_until < NOW() AND held_until IS NOT NULL`. One statement per table per inventory-list call. This keeps the columns tidy and lets the UI show "available" cleanly without filtering at read time on every consumer.

3. **Background sweeper (audit hygiene).** A `scripts/sweep-expired-holds.ts` script invoked by a Railway cron every 5 minutes that does the same UPDATE across all four tables AND writes one `AuditLog` row per expired-and-cleared hold with `action: HoldExpired`. No new infrastructure beyond a cron entry; the script reuses `lib/audit.ts`. **This is the only place audit rows are written for expiry** — the lazy/display sweeps skip audit because writing 1 row per swept item per page-view is too noisy.

### Hold audit events (using existing `lib/audit.ts`)

Add to `AuditAction` enum:
- `HoldCreated`
- `HoldExtended` (only logged on cart heartbeat, not wizard picks — avoid spam)
- `HoldReleased` (explicit user release)
- `HoldExpired` (sweeper only)
- `HoldConflict` (409 returned to a would-be holder)
- `HoldClaimed` (hold → inStorage:false transition at checkout)

---

## 3. Atomic Claim Algorithm

### The moment of truth: `/api/orders/batch` checkout

Inside the existing `prisma.$transaction` at `app/api/orders/batch/route.ts:147`, **replace** the current blind `tx.customerSign.update({ where:{id}, data:{inStorage:false} })` pattern with a conditional update that atomically consumes the hold.

### SQL (run via `tx.$executeRaw`)

For each Customer* item id referenced in the batch:

```sql
UPDATE customer_signs
SET in_storage = false,
    held_until = NULL,
    held_by_session_id = NULL,
    held_by_user_id = NULL
WHERE id = $1
  AND in_storage = true
  AND (
    held_by_session_id = $2
    OR held_until IS NULL
    OR held_until < NOW()
  )
RETURNING id;
```

Bound params: `$1 = customerSignId`, `$2 = checkoutSessionId` (the same session the wizard used to acquire the hold).

### Why this is race-safe under N concurrent requests

Postgres takes an implicit row-level write lock on the `WHERE id = $1` match. Two concurrent transactions targeting the same id serialize on that lock. The loser's WHERE-clause precondition (`in_storage = true AND (heldBySessionId = me OR expired OR null)`) evaluates AFTER the winner committed, so the loser sees `in_storage = false` and returns 0 affected rows.

### Pseudo-code for batch checkout consumption

```typescript
// inside prisma.$transaction(async (tx) => { ... }) in app/api/orders/batch/route.ts

const sessionId = body.checkout_session_id; // sent up from the cart page
const claimResults: Array<{ table: string; id: string; claimed: boolean }> = [];

for (const order of computed) {
  // 1. create the order + nested OrderItems (unchanged from today, EXCEPT
  //    items now carry customer_*_id again — see file change #4 below)
  const created = await tx.order.create({ data: { ..., orderItems: { create: items.map(...) } } });

  // 2. atomic claim — one statement per item, fail-loud on conflict
  for (const item of items) {
    if (item.customer_sign_id) {
      const rows = await tx.$executeRaw`
        UPDATE customer_signs
        SET in_storage = false,
            held_until = NULL,
            held_by_session_id = NULL,
            held_by_user_id = NULL
        WHERE id = ${item.customer_sign_id}
          AND in_storage = true
          AND (held_by_session_id = ${sessionId}
               OR held_until IS NULL
               OR held_until < NOW())
        RETURNING id`;

      if (rows === 0) {
        // Throwing aborts the entire $transaction — every order in the batch
        // is rolled back, no partial state, no leaked inStorage flips.
        throw new HoldConflictError({
          itemType: 'sign',
          itemId: item.customer_sign_id,
          orderIndex: /* index */,
        });
      }
      claimResults.push({ table: 'sign', id: item.customer_sign_id, claimed: true });
    }
    // repeat for customer_rider_id, customer_lockbox_id, customer_brochure_box_id
  }
}

// 3. write one audit row per claim (still inside the tx, so atomic with the order)
for (const c of claimResults) {
  await audit(tx, { action: 'HoldClaimed', actorId: userId, targetType: c.table, targetId: c.id });
}
```

### Caller behavior on `HoldConflictError`

The route catches the thrown error, returns **HTTP 409** with a body like:

```json
{
  "error": "inventory_conflict",
  "conflicts": [
    { "order_index": 2, "item_type": "sign", "item_id": "abc123" }
  ],
  "message": "One or more items in your cart were just claimed by another order. Please re-pick them."
}
```

The Stripe PaymentIntent should be created **only after** the transaction commits successfully (see file change #3). On 409, no PI exists, so there's nothing to refund.

### Concurrent-requests proof

| Time | Tx A (session s1) | Tx B (session s2) |
|---|---|---|
| T0 | `BEGIN` | `BEGIN` |
| T1 | `UPDATE ... WHERE id=X AND in_storage=true AND (heldBy=s1 OR expired)` — acquires row lock | `UPDATE ... WHERE id=X AND in_storage=true AND (heldBy=s2 OR expired)` — **blocks on row lock held by A** |
| T2 | `COMMIT` (row now in_storage=false, lock released) | (still blocked) |
| T3 | done — 1 row affected | unblocks; re-evaluates WHERE; sees `in_storage=false`; **0 rows affected** |
| T4 | order created | throws `HoldConflictError`, rolls back, returns 409 |

The lock is implicit in Postgres' default Read Committed — no `FOR UPDATE`, no `Serializable`, no advisory lock needed. The conditional WHERE does all the work.

---

## 4. File-by-File Change List

### Schema + migration

- **`prisma/schema.prisma`** — add `heldUntil`, `heldBySessionId`, `heldByUserId` + 2 indexes to each of `CustomerSign`, `CustomerRider`, `CustomerLockbox`, `CustomerBrochureBox`. Run `prisma db push`.

### New files

- **`lib/inventory-holds.ts`** — hold helpers:
  - `acquireHold(tx, { itemType, itemId, sessionId, userId, ttlMinutes=15 })` → conditional `UPDATE` with the same WHERE pattern as §3 but targeting the hold columns instead of `in_storage`. Returns `{ acquired: boolean, currentHolder?: {sessionId, userId, expiresAt} }`.
  - `extendHolds(tx, { sessionId, ttlMinutes=15 })` → `updateMany` per table where `heldBySessionId = sessionId AND heldUntil > now()`.
  - `releaseHolds(tx, { sessionId, itemIds?: string[] })` → `updateMany` per table clearing the three hold columns.
  - `sweepExpired(tx)` → bulk clear of `heldUntil < now()`, returns count per table.
- **`app/api/inventory/holds/route.ts`** — `POST` acquires (or extends) holds, `DELETE` releases. Body: `{ items: [{type, id}], sessionId }`. Returns per-item `{acquired, conflictHolder?}`. Wraps every change in `prisma.$transaction` and `audit()`.
- **`app/api/cart/heartbeat/route.ts`** — `POST` extends all live holds for the session. Called every 60s by the cart page.
- **`scripts/sweep-expired-holds.ts`** — cron entry-point: calls `sweepExpired`, writes `HoldExpired` audit rows, logs counts. Wired to Railway cron at `*/5 * * * *`.
- **`lib/cart-session.ts`** — tiny helper to mint/persist a stable `checkout_session_id` UUID in `localStorage` (key `pp_cart_session_v1`). Survives reloads. Used by the wizard + cart + checkout call. Forward-compatible: when server `Cart` lands, swap `localStorage` for `Cart.id` here only.

### Edits to existing files

- **`lib/audit.ts`** — add 6 new `AuditAction` values: `HoldCreated`, `HoldExtended`, `HoldReleased`, `HoldExpired`, `HoldConflict`, `HoldClaimed`.
- **`lib/cart.ts`** — `addItem` and `removeItem` no longer need to call the hold API (holds are wizard-time). On `removeItem` / `clearCart`, walk the removed `cartItem.formData` for ids and `DELETE /api/inventory/holds`.
- **`components/order-flow/steps/sign-step.tsx`** — on dropdown change for `stored_sign_id`, `await POST /api/inventory/holds`. On 409, revert select + toast `"Just claimed by {holder}"`.
- **`components/order-flow/steps/second-post-step.tsx`** — same for `second_post_stored_sign_id` + per-rider picks.
- **`components/order-flow/steps/rider-step.tsx`** (and `RiderSelector/hooks/useRiderSelection.ts`) — same for owned-rider auto-match. **Also fix the "first matching row" bug from Exploration 2** — request a server-side "next available not-held" pick instead of always grabbing `[0]`. New endpoint `POST /api/inventory/next-available` that picks-and-holds in one call.
- **`components/order-flow/steps/lockbox-step.tsx`** — same for `customer_lockbox_id`.
- **`components/order-flow/steps/brochure-box-step.tsx`** + **`app/api/inventory/route.ts`** — wire brochure boxes into the same picker pattern using `/api/inventory/next-available` since brochures are quantity-aggregated today.
- **`components/order-flow/steps/review-step.tsx`** — **fix the cart-strip bug**: `handleAddToCart` must preserve `customer_*_id` references on each item (or stash the full `buildItems()` output alongside `formData` on the cart row). Otherwise holds are acquired in the wizard but the batch checkout has no ids to consume against.
- **`app/dashboard/cart/page.tsx`** — (a) call `/api/cart/heartbeat` on a 60s interval while mounted, (b) include `checkout_session_id` in the `batchPayload`, (c) rebuild `batchPayload.orders[i].items` by replaying `buildItems()` against `cartItem.formData` so inventory ids are present, (d) handle 409 from batch by routing the user back to the affected wizard step with the specific item flagged.
- **`app/api/orders/batch/route.ts`** — replace `tx.customerSign.update({where:{id}, data:{inStorage:false}})` etc. with the conditional `$executeRaw` block from §3. Read `checkout_session_id` from body. Throw `HoldConflictError` on 0 affected rows; outer handler converts to 409. Write `HoldClaimed` audit row per successful claim.
- **`app/api/orders/route.ts`** — same conditional-update treatment for the single-order path. **Also move the inventory flip INTO the order-create transaction** (it currently runs outside — see Exploration 4). This was a latent bug; fixing it is a prerequisite for hold consumption to be atomic with order creation.
- **`app/api/orders/[id]/edit/route.ts`** — when an edit adds a new inventory id, use the same conditional UPDATE. The edit caller must acquire holds for the new ids via the wizard (the edit UI already routes through the wizard). On the restore side (removing items from an edited order), just clear `inStorage` back to `true` — no hold needed.
- **`app/api/inventory/route.ts`** — `GET` filter changes from `{ inStorage: true }` to `{ inStorage: true, OR: [{ heldUntil: null }, { heldUntil: { lt: new Date() } }, { heldBySessionId: callerSessionId }] }`. Also run the opportunistic display sweep (§2). Return `held: boolean` + `heldByMe: boolean` per item so the UI can show "held by your other cart row" hints.
- **`app/api/webhooks/stripe/route.ts`** — `restoreOrderInventory()` clears hold columns alongside `inStorage:true` (idempotent).
- **`app/api/admin/orders/[id]/cancel/route.ts`** — same: clear hold columns on cancel.
- **`scripts/seed-admin-test-inventory.js`** + **`scripts/seed-test-account.ts`** — no change needed; new columns are nullable and seed default = unheld.
- **`app/auth/[...nextauth]/route.ts`** (or wherever the signout callback is) — best-effort `releaseHolds({sessionId})` on signout.

---

## 5. Failure Modes Defeated

1. **Two team_admins racing on the same physical sign.** Admin A picks sign X in the wizard → server `UPDATE customer_signs SET held_until = now()+15min, held_by_session_id = sA WHERE id=X AND (held_until IS NULL OR held_until < now() OR held_by_session_id = sA)` succeeds. Admin B picks the same X seconds later → same UPDATE returns 0 rows; B's UI gets a 409 with "Held by another agent until 10:42 AM" and reverts the dropdown. Neither admin proceeds to checkout with item X.

2. **One team_admin races themselves across two browser tabs.** Both tabs share `localStorage.pp_cart_session_v1`, so the `heldBySessionId = sA` precondition matches in both. Tab 1's pick acquires the hold; Tab 2's pick sees `heldBySessionId = sA` and is allowed to re-acquire (or extend). At checkout, the batch transaction's conditional UPDATE consumes the row exactly once — whichever cart row checks out first wins, the second batch's UPDATE returns 0 rows and 409s with no partial inventory state leaked, because the entire `$transaction` rolls back.

3. **Concurrent checkout-batch + edit-existing-order both adding the same id.** Both go through the conditional UPDATE in `$transaction`. Postgres' implicit row lock serializes them on the row's PK; the loser sees `in_storage = false` (winner already committed) and returns 0 rows, throws `HoldConflictError`, and rolls back its entire transaction. No silent overwrite, no doubled `OrderItem` FKs — even though there's still no DB-level uniqueness constraint on `OrderItem.customerSignId`. The conditional UPDATE is the enforcement.

---

## 6. Failure Modes Accepted

1. **Cross-device session-id divergence.** If the same user starts a cart on their laptop and then opens `/dashboard/cart` on their phone, the phone mints a fresh `pp_cart_session_v1` UUID and the holds acquired by the laptop look "held by someone else" to the phone. The phone session will see those items as unavailable in the wizard and get 409s if it tries to pick them. **Acceptable because:** (a) the localStorage cart is already device-local today (Exploration 2), so cross-device cart-sharing isn't a feature regression; (b) the laptop's holds expire in 15min and the phone can re-pick after that; (c) when the server-side `Cart` table ships in the parallel track, `Cart.id` replaces the localStorage UUID and this disappears automatically.

2. **Wizard "back" + browser-close without explicit release.** If the user picks 5 items, hits browser-close without clearing the cart, those 5 items stay held for up to 15min before the read-side lazy expiry / sweeper frees them. Other users see them as "unavailable" during that window. **Acceptable because:** (a) the TTL is exactly the mechanism designed to bound this — 15min is short enough that the next pick by anyone else just retries; (b) the alternative (presence pings + zero-TTL release) adds infrastructure complexity disproportionate to the actual harm (worst case: a customer waits 15min to re-pick a specific sign in a low-inventory situation); (c) the `HoldExpired` audit rows from the sweeper give us observability — if we see this happening often in prod, we can shorten TTL or add a `beforeunload` best-effort release without changing the design.