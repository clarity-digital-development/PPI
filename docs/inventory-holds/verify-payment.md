Good — UI disables button while checkingOut, but that does NOT prevent same-tab double-click before the first click flips state, and certainly doesn't prevent two-tab/two-device clicks. Idempotency is not enforced server-side.

I have enough. Producing the audit.

---

# Payment Safety Audit — `app/api/orders/batch/route.ts`

File audited: `c:\Users\tanne\PPI\app\api\orders\batch\route.ts` (HEAD a58b07f, branch `ryan-feedback-2026-06-02`)
Supporting: `c:\Users\tanne\PPI\lib\stripe\server.ts`, `c:\Users\tanne\PPI\app\api\webhooks\stripe\route.ts`, `c:\Users\tanne\PPI\lib\inventory-holds.ts`

## Verification of the three pre-flagged criticals

### (A) Pre-validate runs BEFORE Stripe PI creation — CONFIRMED
- Pre-validate query: `route.ts:157-165`
- Conflict check + 409 return: `route.ts:168-196`
- Stripe customer ensure: `route.ts:200-213` (runs only if prevalidate passed — but note: `createCustomer` is a Stripe API call, not a charge)
- `createPaymentIntent`: `route.ts:218`
Ordering is correct. No PI is created if prevalidate fails.

### (B) `bumpHolds` updates BOTH `expiresAt` and `heldUntil` — CONFIRMED
- `lib/inventory-holds.ts:258-263` updates `inventory_holds.expires_at`
- `lib/inventory-holds.ts:275-285` writes `heldUntil` on each Customer* row in the same tx via `updateHoldUntilForIds`
Both columns are updated in the same `prisma.$transaction`. Race closed.

### (C) `restoreOrderInventory` NOT-EXISTS guard — CONFIRMED
- `lib/inventory-holds.ts:821-880` `restoreIfSafe` checks for `otherLive` order pointing at same item AND any live `inventoryHold` before flipping `inStorage = true`. Clobber race closed.

---

## NEW findings against the headline guarantee

### FINDING 1 — CRITICAL — `confirm: true` + automatic_payment_methods means the card is CHARGED at PI creation, before the tx runs
**Where:** `lib/stripe/server.ts:96-114` (`createPaymentIntent`), called from `route.ts:218`.

`createPaymentIntent` passes `confirm: true` when `paymentMethodId` is present (line 110). With `automatic_payment_methods.enabled = true` and a saved card payment method, Stripe **synchronously authorizes and captures** the charge in `paymentIntents.create()`. By line 229 we already have `paymentIntent.status === 'succeeded'` for non-3DS cards — the customer's bank has been hit.

This means the headline guarantee "customer is never charged for an order that doesn't exist" reduces to: **the tx between line 237 and line 324 must NEVER fail in a way that the post-tx cancel cannot reach.** Any of the following voids the guarantee:

1. **Node process dies mid-tx** (OOM, deploy SIGTERM, Lambda timeout). The `await prisma.$transaction(...)` never returns, the `try { ... } catch { stripe().paymentIntents.cancel(...) }` never executes. Customer is charged. No orders exist. **No reconciliation job exists** — grep for an orphan-PI sweeper turned up nothing.
2. **DB connection dies AFTER tx commit but BEFORE control returns to JS** (Postgres `pg_terminate_backend`, network blip during commit ack). Server-side commit may have succeeded OR failed; from Node's perspective the awaited promise rejects, we enter the catch, and we call `stripe.paymentIntents.cancel`. Stripe accepts the cancel on a `succeeded` PI? **No** — succeeded PIs can't be cancelled. The cancel throws, we swallow it (line 331), return 500 to the user. Customer is charged, orders ARE in DB (commit succeeded), cart UI sees error and tells user to retry → duplicate orders.
3. **Tx commits, response code crashes** (audit row insert throws, see Finding 6).

**Severity:** CRITICAL. This is the literal failure-mode the guarantee is trying to prevent, and the implementation cannot deliver it because the charge happens 4 lines before the tx starts.

**Fix:** Restructure to a capture-after-commit flow:
- Create PI with `confirm: true, capture_method: 'manual'` → authorization only (hold on card, NOT charged).
- Run tx.
- On tx success, `stripe.paymentIntents.capture(piId)` and update orders' paymentStatus.
- On tx failure, `stripe.paymentIntents.cancel(piId)` — manual-capture PIs in `requires_capture` state cancel cleanly.
- If capture fails after tx commit, page an admin (orders exist but uncaptured authorization will void in 7 days).

Alternative narrower fix: keep current flow but add a reconciliation cron that finds Stripe PIs with `succeeded` status whose `metadata.app_order_batch=true` AND have zero matching `Order.paymentIntentId` rows in DB, and refunds them.

---

### FINDING 2 — HIGH — Double-click / parallel checkout produces one paid + one orphan PI (and possibly two paid)
**Where:** `route.ts:152-225` interaction with `lib/inventory-holds.ts` partial unique index.

The partial unique index `inventory_holds_live_uniq` protects against double-claim of the same inventory item, but the batch route has **no idempotency**:
- No `Idempotency-Key` header on `paymentIntents.create` (line 218 → `createPaymentIntent` does not set one).
- No `cartSessionId`-keyed lock or "in-flight" marker.
- The UI's `disabled={checkingOut}` (cart/page.tsx:402) is per-tab state — useless across two tabs/devices.

**Sequence:**
1. User clicks Checkout in tab A and tab B simultaneously.
2. Both pass prevalidate (same live holds, both queries see them).
3. Both call `createPaymentIntent` → **two separate PIs, both charged synchronously** (per Finding 1).
4. Both enter tx. The partial unique index protects holds from double-consume, so:
   - Tx A wins, claims holds, commits. Customer is charged via PI_A.
   - Tx B's `claimHoldsInTx` throws `HoldConflictError` ("hold_lost" — heldByHoldId no longer matches because A nulled it at line 684). Tx B rolls back, B's catch calls `paymentIntents.cancel(PI_B)`. PI_B is `succeeded` → cancel throws → swallowed (line 331). **Customer is double-charged.**
5. Worst case: if both txs interleave such that A claims hold X and B claims hold Y from the same cart (impossible here because holds are item-level and both txs send the SAME hold ids → one will fail), OK. But if the user did two separate "Checkout"s on overlapping but non-identical batches, both could partially succeed.

**Severity:** HIGH. Realistic — Stripe.js can be sluggish, users click twice. No headers, no dedupe.

**Fix:**
- Add Stripe `idempotencyKey` derived from `(actor.id, cartSessionId, grandTotal)` to `paymentIntents.create`. Stripe will dedupe within 24h and return the same PI for both requests.
- Server-side: gate the route with a short Redis lock keyed by `(actor.id, cartSessionId)` for 30s, returning 429 on conflict.
- Cart UI: disable button on click and persist a "checkout-in-flight" flag in `sessionStorage` so other tabs of the same window also gray out.

---

### FINDING 3 — HIGH — Webhook race: `payment_intent.succeeded` arrives while tx still running
**Where:** `app/api/webhooks/stripe/route.ts:59-71`, `route.ts:218-324`.

Because the PI is confirmed and charged synchronously at line 218, Stripe will fire `payment_intent.succeeded` **immediately** (sub-200ms for instant cards). Stripe's webhook delivery latency is unrelated to our tx duration.

If the webhook arrives before line 324 returns:
1. Webhook handler runs `prisma.order.findMany({ where: { paymentIntentId } })` (line 64). Tx not committed → **zero rows**.
2. Logs "No orders found for payment intent" (line 69) and `break`s.
3. Tx commits at line 324. Orders now exist with `paymentStatus: 'succeeded'` (already set inline because `piSucceeded = true` at creation — see line 270). **No email sent to customer**, no admin notification, ever.

The `'succeeded'` status was already written at line 270, so the orders look paid in the DB — but the customer never receives an order confirmation email because the webhook is the only place that fires emails (lines 86-119), and it bailed out on `existingOrders.length === 0`.

**Severity:** HIGH. Silent UX failure for the most common (non-3DS) checkout path. Order is real, paid, customer hears nothing.

**Fix:**
- Webhook: if `existingOrders.length === 0` AND the PI is recent (< 60s old), respond `200` but defer with a 5s retry, OR enqueue a delayed job. Stripe will redeliver on non-2xx; respond with non-2xx for this case so Stripe retries with backoff (the comment "no orders found" returns 200 implicitly).
- Even better: do email sending inline at the end of the batch route on `piSucceeded === true`, and make the webhook idempotent (only sends emails if `Order.emailSentAt IS NULL`).

---

### FINDING 4 — MEDIUM — Swallowed cancel error never surfaces to operators
**Where:** `route.ts:328-332`.

```ts
try {
  await stripe().paymentIntents.cancel(piId, { cancellation_reason: 'abandoned' })
} catch (cancelErr) {
  console.error('Batch: failed to cancel PI after tx rollback:', piId, cancelErr)
}
```

`console.error` on Vercel/Railway goes to logs that no one tails. No audit row written for "cancel failed". No Sentry/alerting integration visible in this file. When cancel fails (and it WILL fail every time the PI already succeeded — see Finding 1), the only artifact is a log line.

**Severity:** MEDIUM (becomes CRITICAL when paired with Finding 1).

**Fix:** When cancel throws, write a `CartCheckoutFail`-style audit row with `metadata: { stage: 'pi_cancel_failed', paymentIntentId, errorCode, errorMessage }` so operators have a queryable list of orphan PIs to manually refund.

---

### FINDING 5 — HIGH — `releaseHolds` is NEVER called on tx failure, but `restoreOrderInventory` IS — except no orders exist on tx failure
**Where:** `route.ts:325-369` (tx failure path) vs `lib/inventory-holds.ts:552-602`.

On `HoldConflictError` (line 334) or any other tx failure, the catch:
1. Cancels the PI (line 329).
2. Returns 409 or rethrows.
3. **Does NOT release the customer's still-live holds** (the ones that didn't conflict but were going to be claimed).

Sequence: 3-item batch, items A/B/C. A and B claim successfully inside the tx, C throws HoldConflictError. Tx rolls back → A/B's hold claims are rolled back (good). But the holds for A/B/C still exist in DB with `consumedByOrderId IS NULL` (the consumed-mark UPDATE was rolled back). The user gets a 409, the cart UI does nothing automatic, and the user's other inventory rows remain locked for 15 min of TTL.

This isn't a payment-safety bug per se (no charge sticks if cancel succeeds), but combined with Finding 1 it means: customer was charged + their inventory is locked + their cart UI shows "item_unavailable".

**Severity:** HIGH for UX, MEDIUM for safety.

**Fix:** In the tx failure catch (line 325-369), call `releaseHolds({ holdId: ... }, { reason: 'tx_rollback' })` for every claim in `allClaims` BEFORE returning. Loop tolerant of double-release (helper already handles).

---

### FINDING 6 — MEDIUM — Post-tx audit failure → orphan paid order with no audit trail
**Where:** `route.ts:375-388`.

After `createdOrders = await prisma.$transaction(...)` returns, line 375 calls `audit(...)`. If `audit()` throws (DB connection failure, audit table column drift, etc.), control jumps to the outer catch at line 396. The outer catch returns 500 to the user.

State at that point: orders exist with `paymentStatus: 'succeeded'`, customer was charged, inventory was claimed, **but** the user gets a 500 and their cart is not cleared (see cart/page.tsx:181 — `clearCart()` only runs on success branch). User retries → duplicate orders against the same inventory? No, because the holds are now consumed, so the retry will 409 at prevalidate. But the user thinks the checkout failed and may call support.

**Severity:** MEDIUM.

**Fix:** Wrap the post-tx `audit()` in try/catch and never let it bubble. Always return success to the user once `createdOrders` is populated.

---

### FINDING 7 — LOW — `payment_intent.canceled` webhook restores inventory for an order that may have a parallel re-checkout
**Where:** `app/api/webhooks/stripe/route.ts:138-150`.

Sequence:
1. User checks out batch (PI_1). Orders created with status `processing`.
2. PI_1 stuck on 3DS, user gives up, places same batch under PI_2 (different PM). Hits Finding 2's lack of idempotency, but say prevalidate passes (the original holds were consumed by PI_1's orders, but user re-picked items).
3. Eventually PI_1's 3DS times out → `payment_intent.canceled` webhook fires.
4. `restoreOrderInventory` runs → walks PI_1's orders → for each item, `restoreIfSafe` checks for other live orders pointing at the same item.

`restoreIfSafe` filter (lib/inventory-holds.ts:835-842): `orderId: { not: excludeOrderId }, order: { paymentStatus: { in: ['succeeded', 'processing', 'pending'] } }`. Good — PI_2's order is in `processing`, so the restore is correctly skipped.

BUT: when PI_2's order targets a **different** sign than PI_1's order (because the user re-picked), restore happens on PI_1's signs → which is the correct behavior. So this case is actually fine.

The real concern: `restoreIfSafe` does NOT filter by `status: { not: 'cancelled' }`. If PI_1's order was admin-cancelled before the canceled-webhook fires, the order's `paymentStatus` was set to `failed`/`cancelled` in `cancel/route.ts`, and `restoreOrderInventory` may double-clear. Idempotent so not data-corrupting, just wasted work.

**Severity:** LOW.

**Fix:** Add `status: { not: 'cancelled' }` to the `restoreIfSafe` `otherLive` filter for tighter semantics, but functionally benign.

---

### FINDING 8 — INFO — `cancellation_reason: 'abandoned'` is wrong for tx failures
**Where:** `route.ts:329`.

`'abandoned'` is Stripe's reason for PI auto-expiry from the customer's side. A tx-failure cancel should be `'failed_invoice'` (closest) or `'requested_by_customer'`. Stripe enums for `cancellation_reason` are: `'duplicate' | 'fraudulent' | 'requested_by_customer' | 'abandoned'`. Use `'duplicate'` if the cause is hold race (the inventory was already claimed) — semantically the most accurate of the four.

**Severity:** INFO (reporting hygiene).

---

## Summary

| # | Severity | What | Where |
|---|---|---|---|
| 1 | CRITICAL | `confirm:true` charges the card BEFORE the tx; any post-PI failure leaves an uncancellable succeeded PI | `lib/stripe/server.ts:110`, `route.ts:218` |
| 2 | HIGH | No Stripe `idempotencyKey` and no server-side dedupe → double-click double-charges | `route.ts:218`, `lib/stripe/server.ts:91-115` |
| 3 | HIGH | Webhook arrives mid-tx, finds no orders, never sends confirmation emails | `app/api/webhooks/stripe/route.ts:68-71` |
| 4 | MEDIUM | Cancel error is `console.error`'d only; no audit row, no alert | `route.ts:328-332` |
| 5 | HIGH | Tx-failure path does not call `releaseHolds` → holds linger for 15min after failed checkout | `route.ts:325-369` |
| 6 | MEDIUM | Post-tx audit throw → orphan paid order with 500 response, user retries | `route.ts:375-396` |
| 7 | LOW | Minor `restoreIfSafe` filter gap (no `status: not cancelled`) | `lib/inventory-holds.ts:835-842` |
| 8 | INFO | Wrong `cancellation_reason` on tx-failure cancel | `route.ts:329` |

**Headline guarantee verdict:** NOT met. Finding 1 is the dispositive blocker — the implementation's "cancel PI on tx failure" defense cannot work because the PI is already in `succeeded` (uncancellable) state by the time the tx starts. The headline guarantee can only be restored by switching to `capture_method: 'manual'` and capturing after the tx commits.