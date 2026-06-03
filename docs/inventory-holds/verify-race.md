The TodoWrite reminder isn't applicable — this is a single audit task. I have enough now to deliver the audit. Let me also verify one concern about Postgres tx isolation default (READ COMMITTED).

# Race Audit — `lib/inventory-holds.ts` + consumers

## Verified-safe areas

- **Heartbeat-drift core invariant (`bumpHolds`, lines 242-297):** Both `inventory_holds.expires_at` and `Customer*.heldUntil` are updated inside the same `prisma.$transaction`, so a partial visibility is impossible to outside readers — either both new values are visible or neither.
- **Pre-validate before Stripe (`orders/batch/route.ts` 152-197):** Holds are checked before `createPaymentIntent`; on failure, no PI exists → customer cannot be charged.
- **Cancel-PI on tx failure (`orders/batch/route.ts` 325-336):** `stripe.paymentIntents.cancel(piId)` is unconditional in the catch and its error is swallowed.
- **`restoreIfSafe` (lib/inventory-holds.ts 821-880):** Skips restore if any other live order or any unexpired live hold exists, and the final `updateMany` filters `inStorage: false` so it cannot clobber a freshly held row.

## Findings

### 1. `bumpHolds` heartbeat: stale `heldUntil` when a hold is re-targeted mid-bump — MEDIUM
**File:** `lib/inventory-holds.ts:278-285`, `updateHoldUntilForIds` 788-819.
The bump uses `rows[0].expiresAt` as `commonExpiry` for every row of a given `itemType`, then writes that one value back to every Customer* row via `updateHoldUntilForIds`. That works today because the raw UPDATE on line 258-263 gives every row the same `NOW() + 15m`, but the inner per-row clause `where: { id: r.id, heldByHoldId: r.holdId }` is the only guard against clobbering. **If a concurrent admin `overrideHold` released `r.holdId` and `acquireHold` rebound the same Customer* row to a new hold between line 258 and line 800, the `heldByHoldId: r.holdId` guard correctly skips** — so the *row* is safe. **However, the bumped `InventoryHold.expires_at` (already committed-to-be-written at line 258) belongs to a hold whose Customer* link was severed by the override**, leaving an orphaned live hold row with extended TTL. The partial unique index then blocks the *next* acquire on that item for 15 more minutes until the sweeper reaps it.
**Attack sequence:**
1. User A holds sign X (hold H1).
2. Admin calls `overrideHold(H1)` → marks H1 released. `clearHoldColsForHoldIds` sets sign X heldByHoldId=null.
3. User B acquires hold H2 on sign X.
4. User A's heartbeat fires `bumpHolds`; the `live` findMany at line 243 returns H1 only if its `releasedAt` is null — and step 2 set it, so H1 *is* filtered out. **Wait — step 2 does set `releasedAt`, so H1 is correctly excluded from `live`.** Re-examine: the race needs `releasedAt` to be set *after* line 243 but *before* line 800. The `overrideHold` runs in its own `prisma.$transaction` (line 620), so under READ COMMITTED, the bump tx will see the released_at update once `override`'s tx commits, but only on *re-reads* — the `live` snapshot at line 243 is fixed. The raw UPDATE on line 258 has no `releasedAt IS NULL` guard. **So a hold released between the findMany and the UPDATE will have its `expires_at` bumped despite being released.** This re-extends a released hold to the future. The Customer* row update is harmlessly skipped by `heldByHoldId: r.holdId`, but on the holds table we now have `releasedAt != null AND expires_at > NOW()` — sweeper still reaps via the `releasedAt: { not: null }` branch, so this is bounded by the sweep interval.
**Severity:** medium — sweeper bounds blast radius; user-visible only if sweeper is down.
**Fix:** Add `AND released_at IS NULL AND consumed_by_order_id IS NULL` to the raw UPDATE WHERE clause (line 261).

### 2. `bumpHolds` `commonExpiry` lies about per-row TTL — LOW
**File:** `lib/inventory-holds.ts:278`. The code picks `rows[0].expiresAt` and writes it to every row's `heldUntil`. The raw UPDATE returns the *actual* per-row `expires_at` in `updated`. Today every row gets the same `NOW() + 15m` so they match, but the contract comment on line 794-796 explicitly anticipates per-hold extensions; whoever adds that feature will not notice that `commonExpiry` silently desynchronizes `heldUntil` from `expires_at`.
**Severity:** low (latent).
**Fix:** Pass per-row `expiresAt` into `updateHoldUntilForIds` instead of a shared scalar.

### 3. `acquireHold` lazy-sweep is a real TOCTOU but harmless — LOW (verified-safe)
**File:** `lib/inventory-holds.ts:96-110`. Between the `findMany` and `deleteMany`, a concurrent acquire on a different worker may have *also* swept the same expired row and inserted a new live row reusing the (itemType, itemId). Our `deleteMany({ where: { id: { in: staleIds } } })` is keyed by hold *id*, not by (itemType,itemId), so we can only delete the actual stale ids we saw — we cannot accidentally delete the winner's fresh row. The subsequent INSERT then trips the partial unique index against the winner and we 409 cleanly. **No issue.**

### 4. `acquireHold` SAVEPOINT does not leak a half-row — VERIFIED-SAFE
**File:** `lib/inventory-holds.ts:120-166`. On unique violation, Postgres aborts to the savepoint and the partial INSERT is undone atomically. The `ROLLBACK TO SAVEPOINT` swallows its own error only to defend against a doubly-aborted tx; if rollback truly fails, the next operation (`findFirst` on line 150) will surface the error and we propagate. No leak.

### 5. `claimHoldsInTx` post-failure `readHoldCols` inside aborted tx — MEDIUM
**File:** `lib/inventory-holds.ts:401-432`. When `updateMany` returns count 0 (race, expired hold, returned-to-storage), the next read is `readHoldCols(tx, ...)`. The preceding `updateMany` is a normal Prisma op, not a constraint violation, so the tx is **not** aborted — the read succeeds. **However**, if a future change adds a `tx.inventoryHold.update` before the read (or if the conditional `claimOne` ever emits a unique violation, e.g. someone adds a uniqueness constraint to `heldByHoldId`), the read would happen inside an aborted tx and Postgres returns `25P02 current transaction is aborted`, which surfaces as a generic 500 instead of the intended `hold_lost`/`agent_reassigned` code. **Today the path is safe**, but the brittleness is real.
**Severity:** medium (fragility, not active bug).
**Fix:** Either (a) run `readHoldCols` via a fresh `prisma.` client outside the tx, or (b) wrap the diagnostic read in its own SAVEPOINT.

### 6. Sweeper vs `releaseOrderHoldsAndRestoreInventory` double-delete on consumed rows — LOW
**File:** `lib/inventory-holds.ts:513-515` and `589-591`. Both unconditionally `deleteMany` rows where `consumedByOrderId` matches. Each runs in its own tx. Under READ COMMITTED, both can take row locks: the second tx blocks until the first commits, then sees zero rows matching and the `deleteMany` simply returns `count: 0`. Prisma's `deleteMany` does not error on zero deletes. **No deadlock, no exception.** The sweeper does hold an advisory xact lock (line 474) so two sweepers cannot race each other, but it does NOT serialize against `releaseOrderHoldsAndRestoreInventory`. Verified safe by Postgres semantics.

### 7. `acquireHold` audit fires for a hold that may be released by a sibling tx — LOW
**File:** `lib/inventory-holds.ts:196-211`. `audit()` is awaited after the run-tx commits, but `audit` opens its own connection (per comment on line 418). If the outer caller passed in `opts.tx`, the audit fires *before* the parent tx commits — so on parent rollback, we emit a `Created` audit for a hold row that never existed. The current callers (`acquireHold` is only called without `opts.tx` from the route handler) are safe today, but the `opts.tx` parameter is exposed and the docstring at line 80-83 invites batched callers to use it.
**Severity:** low (latent).
**Fix:** Defer the audit until the caller's tx commits (e.g., return a `commit-hook` callback) or document loudly that `audit()` must be called by the parent after commit when `opts.tx` is passed.

### 8. `bumpHolds` race window vs cron sweeper — LOW
**File:** `lib/inventory-holds.ts:243-263` vs sweeper `482-510`. The bump's `live` findMany filters `expiresAt: { gt: new Date() }` — so it only bumps not-yet-expired holds. But the sweeper, running concurrently, could expire+delete a row in the 1-2ms gap before our UPDATE. Under READ COMMITTED, our `UPDATE inventory_holds SET expires_at=... WHERE id IN (...)` will simply update 0 rows (the row is gone) and the `updated` array shrinks. The per-itemType loop on line 275-285 then iterates `byType` against an empty `updated` for that hold id and the inner `updateHoldUntilForIds` is skipped because its `where: { id: r.id, heldByHoldId: r.holdId }` no longer matches (Customer* heldByHoldId was cleared by the sweeper). **Safe**, but the user-facing `byCartItem` response will mis-report this as `extended: true` for any holds the sweeper killed before the UPDATE returned — because the `for (const u of updated)` loop on line 269 uses the `updated` rows, which by then are empty for the missing ids — actually re-reading: missing ids simply do not appear in `updated`, so `byCartItem` correctly omits them, and the fallback loop at line 292-296 marks them `expired`. **Verified-safe.**