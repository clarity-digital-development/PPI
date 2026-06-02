# Soft-Hold Implementation Recommendation — Inventory Race Protection

## 1. Recommendation: **Hybrid (Design C with simplifications from Design B)**

**Pick:** `InventoryHold` table as the coordination layer + denormalized `heldByHoldId` column on each `Customer*` table as the per-row claim token, **without** raising isolation level. Atomic claim is a conditional `updateMany({ where: { id, heldByHoldId: $myHold, inStorage: true } })` — if `count !== 1`, throw 409 and roll back the whole transaction.

**Why this beats the pure alternatives:**

- **vs. Design A (pure hold table):** A's partial unique index `WHERE expires_at > now()` is rejected by Postgres (`now()` is not IMMUTABLE) — A's revised plan acknowledges this and falls back to `WHERE consumed_at IS NULL` plus a sweeper to keep the live-set honest. That works, but the *Customer\* row* is still updated blindly inside the claim tx, so A also needs `SELECT … FOR UPDATE` + `Serializable` + `P2034` retry logic. That's three concurrency primitives the codebase has never used, on top of a new table. High risk for a 6h budget.
- **vs. Design B (embedded columns only):** B is genuinely simple and the conditional-UPDATE-as-lock argument is sound, but it has no separate hold record for the UI to display ("held by Alice, expires in 12:34") without scanning four tables, no clean place to write per-hold audit metadata, and forward-compat with the server `Cart` is awkward (cascade delete relies on three columns on four tables instead of one FK). B also pushes hold acquisition into every wizard step, which doubles the API surface to test.
- **The hybrid** keeps B's atomic-claim-is-a-conditional-UPDATE (no `FOR UPDATE`, no `Serializable`, no retry logic) but uses C's hold table for coordination, audit, UI display, and forward-compat. The `heldByHoldId` column is the *only* thing the claim transaction touches on `Customer*` — uniqueness/race protection comes from "I'm the only tx whose `heldByHoldId = $myHold` matches" because no two holds share an id. **No partial unique index is required for correctness** (it'd be a defense-in-depth nice-to-have on `inventory_holds`, deferred to a follow-up).

Fits the 6h budget because: one new table, one new enum, two new columns × four tables, one new helper module, one new endpoint family, one cron route, and surgical edits to three existing routes. No raw SQL migration, no isolation level changes, no Prisma version bumps.

---

## 2. Final Schema

### `prisma/schema.prisma` — additions

```prisma
enum HoldItemType {
  sign
  rider
  lockbox
  brochure_box
}

model InventoryHold {
  id                String        @id @default(cuid())
  itemType          HoldItemType  @map("item_type")
  itemId            String        @map("item_id")           // polymorphic FK target; not modeled as Prisma relation
  ownerUserId       String        @map("owner_user_id")     // cart owner (customer or team_admin building the cart)
  actorUserId       String        @map("actor_user_id")     // who clicked (= ownerUserId except admin/on-behalf-of)
  onBehalfOfUserId  String?       @map("on_behalf_of_user_id") // customer the hold is FOR when admin/team_admin is acting
  cartSessionId     String?       @map("cart_session_id")   // localStorage uuid today; server Cart.id tomorrow (track #4)
  cartItemId        String?       @map("cart_item_id")      // CartItem.id so removeItem() can release precisely
  expiresAt         DateTime      @map("expires_at")
  consumedByOrderId String?       @map("consumed_by_order_id") // set when claimed at checkout
  releasedAt        DateTime?     @map("released_at")       // set by explicit release; sweeper hard-deletes both
  createdAt         DateTime      @default(now()) @map("created_at")

  owner      User   @relation("InventoryHoldOwner", fields: [ownerUserId], references: [id], onDelete: Cascade)
  actor      User   @relation("InventoryHoldActor", fields: [actorUserId], references: [id], onDelete: Cascade)
  onBehalfOf User?  @relation("InventoryHoldOnBehalfOf", fields: [onBehalfOfUserId], references: [id], onDelete: Cascade)
  consumedByOrder Order? @relation("InventoryHoldConsumer", fields: [consumedByOrderId], references: [id], onDelete: SetNull)

  @@index([itemType, itemId])
  @@index([ownerUserId, expiresAt])
  @@index([cartItemId])
  @@index([expiresAt])         // sweeper scan
  @@index([cartSessionId])
  @@map("inventory_holds")
}
```

### `CustomerSign` / `CustomerRider` / `CustomerLockbox` / `CustomerBrochureBox` — add to each:

```prisma
  heldByHoldId  String?   @map("held_by_hold_id")
  heldUntil     DateTime? @map("held_until")

  @@index([heldByHoldId])
  @@index([heldUntil])
```

Both columns nullable. `heldUntil` is denormalized from `InventoryHold.expiresAt` so `GET /api/inventory` can filter in one query without a four-way join.

### `User` model — append reverse relations:

```prisma
  heldInventoryAsOwner       InventoryHold[] @relation("InventoryHoldOwner")
  heldInventoryAsActor       InventoryHold[] @relation("InventoryHoldActor")
  heldInventoryOnBehalfOfMe  InventoryHold[] @relation("InventoryHoldOnBehalfOf")
```

### `Order` model — append reverse relation:

```prisma
  consumedHolds InventoryHold[] @relation("InventoryHoldConsumer")
```

### `lib/audit.ts` — add `AuditAction` values:

```ts
InventoryHoldCreated   = 'inventory_hold_created',
InventoryHoldExtended  = 'inventory_hold_extended',
InventoryHoldReleased  = 'inventory_hold_released',
InventoryHoldExpired   = 'inventory_hold_expired',
InventoryHoldConflict  = 'inventory_hold_conflict',
InventoryHoldConsumed  = 'inventory_hold_consumed',
InventoryHoldOverridden = 'inventory_hold_overridden',
```

**Migration command:** `npx prisma db push` — purely additive, all new columns nullable, no destructive ops. No raw SQL file required.

---

## 3. Implementation Plan (file-by-file, ordered)

Total estimate: **~6.5h**. Order is deliberate — each step is independently revertable until step 6 wires the claim into checkout.

| # | File | Purpose | Est |
|---|---|---|---|
| 1 | `prisma/schema.prisma` | Add `HoldItemType` enum, `InventoryHold` model, hold columns on four `Customer*` tables, reverse relations on `User`/`Order`. Run `npx prisma db push`. | **20m** |
| 2 | `lib/audit.ts` | Add 7 new `AuditAction` constants. | **5m** |
| 3 | `lib/inventory-holds.ts` (new) | Single source of truth. Exports: `acquireHold(tx, args)`, `releaseHolds(tx, args)`, `bumpHolds(tx, args)`, `claimHoldsInTx(tx, holds, orderId)`, `sweepExpired(tx)`, `pickModel(tx, itemType)`, `HoldRaceError`, `HoldConflictError`. Every state change writes an audit row. **`acquireHold` opportunistically deletes any expired hold on the same (itemType, itemId) inside the same tx** — this is the lazy-sweep correctness guarantee that makes us robust to cron outages. | **60m** |
| 4 | `lib/cart-session.ts` (new) | `getOrCreateCartSessionId()` — reads/writes `pp_cart_session_v1` uuid in `localStorage`. Forward-compat: swap localStorage for server `Cart.id` here only when track #4 lands. | **10m** |
| 5 | `lib/validations.ts` | Add `acquireHoldSchema`, `releaseHoldSchema`, `bumpHoldSchema`. Add optional `cart_session_id` to `batchOrderSchema`. | **10m** |
| 6 | `app/api/inventory/holds/route.ts` (new) | `POST` acquire, `DELETE` release (by `id`/`cartItemId`/`ownerUserId`). Wraps every change in `prisma.$transaction`. On `P2002` from the partial-unique-or-lazy-sweep race, return **409** with current holder info. | **45m** |
| 7 | `app/api/inventory/holds/bump/route.ts` (new) | `PATCH` extends TTL by 15 min for all live holds matching `ownerUserId = me AND cartItemId IN body.cartItemIds`. Returns per-cartItemId `{ extended: boolean }` so the UI can flag expired holds for re-pick. | **15m** |
| 8 | `app/api/cron/inventory-hold-sweeper/route.ts` (new) | Auth via `CRON_SECRET` header. Inside one `$transaction`: find expired live holds → `updateMany` clear `heldByHoldId`/`heldUntil` on `Customer*` rows (with `where: { heldByHoldId: { in: expiredHoldIds } }` so we never clobber a fresh hold) → delete hold rows → write `InventoryHoldExpired` audit rows. | **30m** |
| 9 | `app/api/inventory/route.ts` (edit) | `GET` filter: include items where `heldByHoldId IS NULL OR heldUntil < now() OR heldByHoldId IN <my live hold ids>`. Add `held_by_me: boolean` + `held_until_other: Date|null` per item so UI can render "(in your cart, 12:34 left)" vs "(held by someone else until 12:34)". | **25m** |
| 10 | `components/order-flow/steps/review-step.tsx` (edit) | **Fix the cart-strips-ids bug from Exploration 2.** Keep `customer_sign_id`/`customer_rider_id`/`customer_lockbox_id`/`customer_brochure_box_id` on each item in `handleAddToCart`. Before writing to localStorage, `POST /api/inventory/holds` for every id in the items array; on 409, surface a clear error and refuse to add to cart. | **45m** |
| 11 | `lib/cart.ts` (edit) | Add `cartItemHoldIds: string[]` to `CartItem` shape. `removeItem` → `DELETE /api/inventory/holds?cartItemId=…`. `clearCart` → `DELETE /api/inventory/holds?ownerUserId=me`. Mount a 5-minute `setInterval` to `PATCH /api/inventory/holds/bump` while cart is non-empty. | **30m** |
| 12 | `app/dashboard/cart/page.tsx` (edit) | (a) Heartbeat loop wired to `bumpHolds`. (b) `handleCheckoutAll` rebuilds `batchPayload.orders[i].items` via `buildItems(cartItem.formData)` so inventory ids reach the API (paired with #10). (c) Pass `cart_session_id` in batch payload. (d) On 409 from batch, show conflict toast and link the user to the affected wizard step. | **40m** |
| 13 | `app/api/orders/batch/route.ts` (edit) | Inside existing `$transaction`, replace blind `tx.customerSign.update({ where: {id}, data: {inStorage: false} })` loop (lines 205–216) with `claimHoldsInTx(tx, holds, order.id)` from helper. The helper uses conditional `updateMany({ where: { id, heldByHoldId: holdId, inStorage: true }, data: { inStorage: false, heldByHoldId: null, heldUntil: null } })` — if `count !== 1`, throw `HoldRaceError`. Catch at route level → 409 with per-item conflict list. Write `CartCheckoutBegin`/`Succeed`/`Fail` audit rows (already in `AuditAction`). | **40m** |
| 14 | `app/api/orders/route.ts` (edit) | **Critical bonus fix:** move the bare `Promise.all(inventoryUpdates)` block at lines 362–400 INTO a `prisma.$transaction` with `order.create` — this closes the existing non-racy bug where a process crash between order create and inventory flip leaks. Same `claimHoldsInTx` call as #13. | **30m** |
| 15 | `app/api/orders/[id]/edit/route.ts` (edit) | Within existing `$transaction`: for newly-added inventory ids that came from the wizard re-pick (carrying their hold ids), use `claimHoldsInTx`. For removed ids, the existing `inStorage: true` restore is fine (no hold to release because checkout consumed it). | **30m** |
| 16 | `app/api/webhooks/stripe/route.ts` (edit) | `restoreOrderInventory()`: after the existing `inStorage: true` flips, also clear `heldByHoldId`/`heldUntil` and delete any `InventoryHold` rows where `consumedByOrderId = thisOrder.id`. Idempotent. | **15m** |
| 17 | `app/api/admin/orders/[id]/cancel/route.ts` (edit) | Mirror #16 in the admin cancel path. | **10m** |
| 18 | `vercel.json` (or Railway cron config) | Wire `GET /api/cron/inventory-hold-sweeper` to fire every 60 seconds with `Authorization: Bearer $CRON_SECRET`. | **10m** |
| 19 | Wizard step pickers (`sign-step.tsx`, `second-post-step.tsx`, `rider-step.tsx`, `lockbox-step.tsx`) | **Deferred to follow-up — see "Out of scope" §4.** The wizard does NOT acquire holds on each pick in this PR; holds are acquired at `handleAddToCart`. This is a deliberate scope cut: fewer round-trips, no useEffect cleanup races, no "user changes mind 8 times" hold churn, and the cart-add still happens before any payment so the team-race window we need to close is fully covered. | 0m (this PR) |

**Total: ~6h 40m.**

### Rollback plan

The whole feature can be cleanly disabled at runtime without a schema rollback:

1. **Kill switch via env var.** `lib/inventory-holds.ts` reads `process.env.INVENTORY_HOLDS_ENABLED ?? 'true'`. If `'false'`:
   - `acquireHold` returns `{ acquired: true, holdId: null }` without writing
   - `claimHoldsInTx` becomes a no-op (and `/api/orders/batch` falls back to today's blind `inStorage: false` flips)
   - `GET /api/inventory` skips the held-filter
   - `/api/cron/inventory-hold-sweeper` short-circuits
2. **If a corrupt hold state ever blocks legitimate checkouts in prod** (e.g. sweeper crashed for hours and lazy-sweep isn't clearing fast enough), the operator can run `DELETE FROM inventory_holds; UPDATE customer_signs SET held_by_hold_id = NULL, held_until = NULL; …` (one statement per Customer* table). The schema is additive — `inStorage` is still the inventory truth, so deleting all holds restores the pre-feature behavior immediately.
3. **No schema rollback ever needed.** All four new columns are nullable; the new table is independent. If the feature is permanently abandoned, the columns can stay forever at zero cost, or be dropped in a future migration window.
4. **Per-route partial rollback.** Each of #13/#14/#15 can be reverted to the prior blind-flip behavior independently if only one path is misbehaving — the helper accepts a `mode: 'strict' | 'permissive'` flag if needed in a hotfix.

---

## 4. Out of Scope for This PR

- **Per-wizard-step hold acquisition.** Holds happen only at `handleAddToCart`. The "user races themselves across two wizard tabs" failure mode is *not* closed in this PR — they can pick the same sign in two tabs and the second tab's add-to-cart will 409. Closing this mid-wizard requires re-architecting each picker; deferred.
- **"Your hold expired" mid-cart UI.** Cart shows a static expiry badge per row, but there is no real-time countdown, no toast when a hold expires while the cart page is open, and no auto-redirect to re-pick. If the heartbeat returns `extended: false` for a row, we just flag it red and block checkout for that row.
- **Server-side `Cart` table integration (track #4).** This PR uses a localStorage-minted `cartSessionId` uuid. When track #4 lands, `lib/cart-session.ts` is the single switch point.
- **Partial unique index on `inventory_holds(item_type, item_id) WHERE consumed_by_order_id IS NULL AND released_at IS NULL`.** Defense-in-depth nice-to-have; correctness comes from the conditional `updateMany` on the `Customer*` row. Add later if audit shows duplicate live holds appearing.
- **Admin "force return to storage" override flow.** Admin paths (`app/api/admin/customers/[id]/inventory/route.ts` action `return_to_storage`, hard `DELETE`) will currently succeed without checking holds — a held cart that races admin deletion will get a clean 409 at checkout from the conditional UPDATE. The "refuse without `?force=true`" UX guardrail is deferred.
- **Team-admin reassign-agent check.** `app/api/teams/inventory/route.ts` PATCH still allows reassigning `assignedToMemberId` on a held item without warning. Held items in someone's cart still belong to the original agent for billing purposes; reassign mid-cart is a future correctness question.
- **Brochure-box per-row hold.** Today brochure boxes are aggregated by quantity (`Exploration 2` confirms `customer_brochure_box_id` is never set by any step). The hold infrastructure supports brochure boxes, but the wizard rewrite to pick specific brochure-box rows is out of scope. Brochure boxes remain quantity-aggregated and un-held in this PR.
- **Audit dashboard for hold events.** The audit rows write fine; surfacing them in admin UI is deferred.
- **Per-tab presence/heartbeat (zero-TTL fast release).** Accepted-failure-mode #1 from Design B — laptop closed mid-cart leaves items held 15 min. Acceptable, no work scheduled.

---

## 5. Test Checklist (manual, pre-merge)

### Single-user happy paths

- [ ] Customer adds a sign + rider + lockbox to cart, checks out, order succeeds, inventory rows show `inStorage: false`, hold rows show `consumedByOrderId = <order.id>`.
- [ ] Customer adds items to cart, removes one row, the holds for that row are released (verify via `SELECT * FROM inventory_holds WHERE cart_item_id = ?` → empty).
- [ ] Customer adds items, clears cart, all holds released.
- [ ] Customer adds items, lets cart sit > 15 min without heartbeat, retries checkout — gets 409 with "hold expired" message, can re-add to cart.

### Race scenarios

- [ ] **Two team_admin browser sessions race for same `CustomerSign`.** Both `POST /api/inventory/holds` near-simultaneously. Exactly one succeeds with `acquired: true`; the other receives 409 with `currentHolder` info. Verify via `SELECT * FROM inventory_holds WHERE item_id = ?` → exactly one live row.
- [ ] **Same team_admin, two tabs, same sign.** Tab 1 adds to cart. Tab 2 attempts `handleAddToCart` for the same sign — gets 409, sign stays in tab 1.
- [ ] **Two carts race at checkout, both think they hold same lockbox.** Manually corrupt the DB so two `InventoryHold` rows exist for the same `(itemType, itemId)` (simulating the partial-unique-not-installed-yet state). Both `POST /api/orders/batch` near-simultaneously. Exactly one succeeds; the other gets 409 with `inventory_hold_conflict` and *no order is created* (verify `SELECT COUNT(*) FROM orders` before/after). Both Stripe PaymentIntents either get created on the winner only, or the loser's is canceled.
- [ ] **Checkout retry after network blip.** Submit `/api/orders/batch` twice in quick succession via curl (same payload). First creates orders + consumes holds. Second returns 409 because holds are now `consumedByOrderId IS NOT NULL`. No double orders.

### Restore paths

- [ ] **Stripe payment fails.** Create an order with a card that 3DS-declines. Webhook `payment_intent.payment_failed` fires. Verify `inStorage: true` restored AND no orphan `InventoryHold` rows remain for that order.
- [ ] **Admin cancels order.** Same as above via the admin cancel button.

### Sweeper

- [ ] **TTL expiry via cron.** Insert a hold with `expiresAt = now() - interval '1 minute'`. Manually hit `/api/cron/inventory-hold-sweeper` with `CRON_SECRET`. Verify hold row deleted, `Customer*.heldByHoldId` cleared, audit row written with `InventoryHoldExpired`.
- [ ] **TTL expiry via lazy sweep.** Insert an expired hold. Without invoking cron, `POST /api/inventory/holds` for the same `(itemType, itemId)` from a different session. Verify the new hold succeeds, the stale one is gone, audit row written.

### Forward-compat / data integrity

- [ ] **Existing orders are unaffected.** Pre-feature orders (no hold rows) still display correctly and can still be canceled.
- [ ] **Inventory `GET` includes correct visibility flags.** Two users hit `/api/inventory` while one has items held — the holder sees `held_by_me: true`, the other sees the item filtered out (or marked with `held_until_other`).
- [ ] **`prisma db push` is idempotent.** Re-run on a freshly migrated DB → "no changes."

### Kill switch

- [ ] Set `INVENTORY_HOLDS_ENABLED=false` in env, restart, perform a checkout — verify it behaves exactly like pre-feature `main` (blind `inStorage: false` flip, no hold rows written).

### Audit coverage

- [ ] After running all scenarios above, `SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'inventory_hold_%' GROUP BY action` shows nonzero rows for `InventoryHoldCreated`, `InventoryHoldReleased`, `InventoryHoldExpired`, `InventoryHoldConflict`, `InventoryHoldConsumed`.