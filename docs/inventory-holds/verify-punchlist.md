# Soft-Hold Implementation — Prioritized Punch List

## P0 — Must fix before merge (true blockers)

### B1. `confirm:true` charges card BEFORE the tx runs — headline guarantee broken
- **Source:** Payment audit, Finding 1
- **File:** `lib/stripe/server.ts:110`, `app/api/orders/batch/route.ts:218`
- **Description:** `paymentIntents.create({ confirm: true })` synchronously captures the charge before the inventory tx; if the tx then fails (or the process dies), the PI is already `succeeded` and uncancellable — customer is charged for an order that doesn't exist.
- **Fix:** Switch to `capture_method: 'manual'`, run the tx, then `capture` on commit / `cancel` on rollback.

### B2. No idempotency on checkout — double-click double-charges
- **Source:** Payment audit, Finding 2
- **File:** `app/api/orders/batch/route.ts:218`, `lib/stripe/server.ts:91-115`
- **Description:** No Stripe `idempotencyKey` and no server-side dedupe; two parallel checkouts each create+charge their own PI, one wins the hold race, the loser's PI is already succeeded and can't be cancelled.
- **Fix:** Pass `idempotencyKey` derived from `(actor.id, cartSessionId, grandTotal)` AND add a short server-side lock keyed by cart session.

---

## P1 — Fix in same PR

### B3. Webhook race: `payment_intent.succeeded` arrives mid-tx, no confirmation email ever sent
- **Source:** Payment audit, Finding 3
- **File:** `app/api/webhooks/stripe/route.ts:64-71`
- **Description:** Webhook fires sub-200ms after PI create; orders aren't committed yet, handler finds zero rows, returns 200, and never re-runs — order is real and paid but customer gets no email.
- **Fix:** Return non-2xx so Stripe retries, OR send emails inline from the batch route on `piSucceeded` and make webhook idempotent on `emailSentAt`.

### B4. Tx-failure path doesn't release the user's still-live holds
- **Source:** Payment audit, Finding 5
- **File:** `app/api/orders/batch/route.ts:325-369`
- **Description:** On any tx failure (including HoldConflictError on item C of a 3-item batch), holds for items A and B are rolled back but never released, locking the user's inventory for 15 min.
- **Fix:** In the catch, loop `allClaims` and call `releaseHolds({ holdId }, { reason: 'tx_rollback' })`.

### B5. Client treats missing `byCartItem` entry as "still alive" → silent zombie rows
- **Source:** UI audit, Finding 9
- **File:** `lib/cart.ts:187-194`
- **Description:** If `bumpHolds` omits a reaped hold from `byCartItem`, the row stays out of `expiredRows`, countdown shows 0:00, and checkout proceeds — server then 409s.
- **Fix:** Change `else if (r && !r.extended)` to `else` so missing entries also trigger `onConflict`.

### B6. Holds `POST` 409 leaks `code: 'item_already_held'` to foreign-team requesters
- **Source:** Privacy audit, C1/C8
- **File:** `app/api/inventory/holds/route.ts:117`
- **Description:** Redacted branch returns `err.code` verbatim, giving cross-tenant attackers a real-time oracle distinguishing "held by competitor" from "vanished."
- **Fix:** Hard-code `code: 'item_unavailable'` in the redacted branch.

### B7. `bumpHolds` raw UPDATE re-extends already-released holds (race vs `overrideHold`)
- **Source:** Race audit, Finding 1
- **File:** `lib/inventory-holds.ts:258-263`
- **Description:** The bump UPDATE has no `released_at IS NULL` guard, so a hold released by admin override between the `live` findMany and the UPDATE has its `expires_at` extended, blocking re-acquire until the sweeper reaps it.
- **Fix:** Add `AND released_at IS NULL AND consumed_by_order_id IS NULL` to the raw UPDATE WHERE clause.

### B8. Post-tx audit failure orphans paid order with 500 response
- **Source:** Payment audit, Finding 6
- **File:** `app/api/orders/batch/route.ts:375-388`
- **Description:** If `audit()` throws after tx commit, control jumps to outer catch returning 500; orders exist and are paid but user sees error and retries (now blocked by 409).
- **Fix:** Wrap post-tx `audit()` in try/catch; never let it bubble.

### B9. Swallowed cancel error has no audit trail
- **Source:** Payment audit, Finding 4
- **File:** `app/api/orders/batch/route.ts:328-332`
- **Description:** When `paymentIntents.cancel` fails (which will be every time under B1's bug), only `console.error` records it — no queryable list for operators to refund.
- **Fix:** On cancel failure, write a `CartCheckoutFail` audit row with `stage: 'pi_cancel_failed'`, PI id, and error details.

---

## P2 — Follow-up

- **B10.** `handleAddToCart` orphans holds if tab closes mid-loop (sweeper bounds blast radius). UI, review-step.tsx:456-492 — add `AbortController` cleanup.
- **B11.** `removeItem` fire-and-forget DELETE causes 409 on rapid re-add. `lib/cart.ts:118-126` — await DELETE before localStorage update.
- **B12.** Cart-mount on stale tab flashes "expired" for every row without context. `app/dashboard/cart/page.tsx:361-367` — tweak banner copy for "since last visit."
- **B13.** Holder-visibility timing oracle on holds POST. `app/api/inventory/holds/route.ts:96-109` — constant-time lookup.
- **B14.** `claimHoldsInTx` post-failure `readHoldCols` is brittle to future unique-constraint adds. `lib/inventory-holds.ts:401-432` — wrap in SAVEPOINT.
- **B15.** `bumpHolds` `commonExpiry` desyncs `heldUntil` from `expires_at` if per-row TTLs are ever added. `lib/inventory-holds.ts:278` — pass per-row expiresAt.

---

## P3 — Nice to have

- **B16.** Wrong `cancellation_reason: 'abandoned'` semantics. `app/api/orders/batch/route.ts:329` — use `'duplicate'`.
- **B17.** `audit()` from `acquireHold` fires before parent tx commits when `opts.tx` is passed. `lib/inventory-holds.ts:196-211` — document or return commit-hook.
- **B18.** Same-team team_admin sees other agent's `holderExpiresAt`. `app/api/inventory/holds/route.ts:111-114` — product decision.
- **B19.** `restoreIfSafe` lacks `status: not cancelled` filter (idempotent today). `lib/inventory-holds.ts:835-842`.

---

## CONCLUSION

**Count: 2 P0, 7 P1.**

**Recommendation: BLOCK merge until B1 and B2 land.** The soft-hold feature itself works — the race-critic, restore-clobber, and charge-without-order defenses are real and verified. But B1 invalidates the entire headline guarantee: the "cancel PI on tx failure" defense is dead code because the PI is already in uncancellable `succeeded` state by the time the tx starts. B2 turns any double-click into a real double-charge. Both produce actual customer money loss and have no application-layer mitigation — these are not papercuts.

**Once B1 + B2 land, ship.** Before the broader Ryan-feedback PR opens, the same PR must also include the P1 batch (B3–B9): they are tightly coupled to the payment/hold flow, each has a concrete code-level fix (1–10 lines), and shipping holds without them produces silent email failures (B3), stuck inventory (B4), zombie cart rows (B5), cross-tenant data leak (B6), an admin-override race (B7), retry-loop UX (B8), and unobservable orphan PIs (B9). The P2/P3 items are safe to defer to follow-up PRs.