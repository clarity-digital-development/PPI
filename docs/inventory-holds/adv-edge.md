I have enough to produce a high-signal edge-case audit. Let me write up the findings directly.

---

# Edge Cases That Break The Plan (Non-Race)

Listed by severity. Each item names the exact plan step it punctures and a concrete mitigation.

---

## CRITICAL

### 1. Stripe `payment_intent.succeeded` arrives BEFORE `/api/orders/batch` finishes its transaction
**Where it bites:** Plan step #13/#14. The batch route creates the PaymentIntent **before** opening the order-creation transaction (read batch route lines 100-150). For an `automatic_payment_methods` PI with a saved card, Stripe can fire `payment_intent.succeeded` in <200ms — fast enough that the webhook lookup (`prisma.order.findMany({ where: { paymentIntentId } })`) returns **zero rows** because the order tx hasn't committed yet. Today this is benign (the webhook just logs "No orders found"). After the plan ships, the hold has been `consumed` inside the tx but isn't visible to the webhook either, so the webhook's new "clear `heldByHoldId` + delete holds where `consumedByOrderId = order.id`" cleanup is a no-op. The hold sits in `inventory_holds` with `consumedByOrderId` populated, `releasedAt` null, until the sweeper hits it — but the sweeper plan only deletes rows with `expiresAt < now()`, and a consumed hold's `expiresAt` is still 15 min in the future. **Result: consumed holds leak forever until manually cleaned.**

**Severity:** High — silent data accumulation, visible only in audit forensics.
**Mitigation:**
- Sweeper `WHERE` clause must be `expiresAt < now() OR consumedByOrderId IS NOT NULL OR releasedAt IS NOT NULL`. The plan only handles the first clause.
- Webhook should also be made resilient: if `existingOrders.length === 0`, schedule a retry-check (or rely on Stripe's own retry of the webhook) rather than silently dropping. Today this is logged as an error but never recovered.

---

### 2. `restoreOrderInventory` runs AFTER inventory was reassigned to a NEW order/hold
**Where it bites:** Plan step #16. Sequence: Order A pays, fails 3DS, webhook is delayed (Stripe retries can take up to 3 days). In the meantime, the customer assumes failure, re-picks the sign, places Order B successfully. Webhook for Order A finally fires and runs `restoreOrderInventory` — which **blindly** sets `inStorage: true` on the sign that is now legitimately consumed by Order B. The plan says "after the existing `inStorage: true` flips, also clear `heldByHoldId`/`heldUntil`" — but this makes it WORSE, because it would also clear the hold that Order B's checkout had just consumed (if Order B is still mid-flow). Then a third order can claim the same physical sign.

This bug **exists today** in `restoreOrderInventory` but is masked because nobody can re-pick a sign that today shows `inStorage: false` in the UI. After the plan ships, holds expose the item earlier (sweeper clears stale holds), so the timing window widens.

**Severity:** High — double-allocation across orders, exact opposite of the feature's goal.
**Mitigation:**
- `restoreOrderInventory` must be guarded: only restore `inStorage: true` if the sign's `inStorage` is still `false` AND no live order item references that sign id with a non-failed payment status, AND no live hold exists. Pseudocode: `UPDATE customer_signs SET inStorage = true WHERE id = $id AND inStorage = false AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.customer_sign_id = $id AND o.id != $failed_order_id AND o.payment_status IN ('succeeded','processing')) AND NOT EXISTS (SELECT 1 FROM inventory_holds WHERE item_id = $id AND consumed_by_order_id IS NULL AND released_at IS NULL AND expires_at > now())`.
- Add this guard regardless of whether the holds feature ships — it's a latent bug.

---

### 3. Partial batch checkout: PI succeeds, tx aborts on hold conflict for 1 of 3 orders → **money taken, no orders, holds consumed-but-not-attached**
**Where it bites:** Plan step #13. The plan says: "if `count !== 1`, throw `HoldRaceError`. Catch at route level → 409." But the PaymentIntent was already created and (for instant-confirm cards) already **charged** before the tx ran. The tx aborts, no `Order` rows are created, so `paymentIntentId` lives in Stripe with **no corresponding order in our DB**. The webhook for `payment_intent.succeeded` arrives, finds no orders (Edge Case 1), logs an error, walks away. The customer is charged, has no orders, and their cart still claims to hold items it doesn't.

This is worse than today: today the blind `inStorage: false` flip never fails inside the tx, so charge-without-order doesn't happen via this path.

**Severity:** Critical — real money, real customer complaint, no recovery path coded.
**Mitigation:**
- Order the batch as: (a) acquire/re-validate holds in a short tx **first**, (b) create PI, (c) create orders + consume holds in second tx. If (c) fails, immediately call `stripe.paymentIntents.cancel(piId)`. The plan's flow (create PI → big tx → claim → maybe-409) inverts this.
- Alternative: validate holds are still live for `ownerUserId = me` immediately before `stripe.paymentIntents.create`, fail-fast at 409 without ever touching Stripe.
- Either way, wrap the 409 path with a Stripe-side compensation: `try { await stripe.paymentIntents.cancel(piId) } catch {}` and log loudly.

---

## HIGH

### 4. Server restart between PI create and tx commit
**Where it bites:** Plan step #13. Pod restart (Railway deploy, OOM, scale event) after `stripe.paymentIntents.create` returns but before the tx commits. Today: orphan PI in Stripe, no order, inventory untouched — survivable. After plan: same orphan PI, **plus** the holds from the cart are still live for 15 min, so the customer can retry checkout. On retry, the holds will be re-claimed (correct) but the orphan PI is never cleaned up. With per-order PIs this is fine; with the batch's **shared** PI it means we keep creating PIs every retry without canceling old ones.

**Severity:** Medium-High — Stripe cost + reconciliation pain, but not customer-visible.
**Mitigation:**
- Persist `paymentIntentId` to the cart session (or to the hold rows as `pendingPaymentIntentId`) before calling `stripe.paymentIntents.create`. On retry, if a pending PI exists for this cart session, cancel it before creating a new one.
- Add a daily reconciliation cron: list Stripe PIs in `requires_payment_method`/`requires_confirmation` older than 1 hour with no matching `Order.paymentIntentId`, cancel them.

---

### 5. Cart abandonment + return next day with **expired holds the user never sees expire**
**Where it bites:** Plan step #11/#12 + §4 explicit non-goal. User builds a 5-order cart, closes laptop. Heartbeat dies. 15 min later, sweeper releases all 8 inventory holds. Next morning the user reopens the cart page — `localStorage` still has the cart with `customer_sign_id` etc. populated. Heartbeat fires `PATCH /api/inventory/holds/bump`; per-cartItemId response is `{ extended: false }` for all rows. The plan says "we just flag it red and block checkout for that row." 

But here's the real bite: in the time the user was asleep, another team_admin acquired holds on **some** of those signs. The cart's red flags say "expired"; user clicks "re-acquire" (or just retries `handleAddToCart`); for the signs another user now holds, they get 409 with `currentHolder = <other team member>`. **For a team-admin building a cart for their own team's agents, this leaks the identity of another team's holder.** PII/competitive intel leak.

**Severity:** Medium-High — privacy/competitive leak via 409 payload, and UX of "I had this in my cart" is bad.
**Mitigation:**
- 409 response must NOT include `currentHolder` user info for users outside your team scope. Return `{ error: 'item_unavailable', held: true }` only — never a name or id.
- On cart-page-mount, immediately call `bump` and gray out the entire checkout button until the user explicitly clicks "Refresh cart" — don't let the user click checkout against a stale cart.
- Consider a server-side `Cart.lastSeenAt` so the cart UI can show "this cart is 14 hours old, items may no longer be available — review before checkout."

---

### 6. Item physically returned to storage between hold and claim (admin action) → claim succeeds but the item the user holds is no longer the item they ordered
**Where it bites:** Plan §4 "Out of scope — admin force return." Sequence: user holds CustomerSign id=ABC123. Admin in the office processes a physical return for that sign and clicks "return to storage" in admin UI → `app/api/admin/customers/[id]/inventory/route.ts` action `return_to_storage` sets `inStorage: true` (which it already does, and which the plan explicitly leaves un-guarded). The hold row still exists. User clicks checkout. The plan's claim is `updateMany({ where: { id, heldByHoldId: holdId, inStorage: true } })` — the where clause is now `true AND true AND true`, so `count === 1`, claim succeeds. Order created. But the admin just put it back in storage because the previous customer returned it — meaning physically the sign is **on the warehouse shelf**, not at the property the order is for. Installer picks it up; fine. But the audit trail says "this sign was already at a property" right up until the admin marked it returned — which is now contradicted by an order created **after** the return. Operationally confusing.

The reverse is also possible: admin marks a held sign as physically lost / damaged (`inStorage: false`, status update, deletes from CustomerSign). Hold row is orphan-pointing-at-deleted-row. Claim `updateMany` matches 0 → 409. User sees "hold conflict" for a sign they had legitimately reserved. The error message is wrong (no conflict — the sign is gone).

**Severity:** Medium — operationally confusing, but not data-corrupting.
**Mitigation:**
- Admin `return_to_storage` and `DELETE` paths must check for live holds and either refuse (the plan's deferred guardrail) or cascade-release the hold + notify the holder. Plan defers this — bump to in-scope, it's a 10-min add.
- Claim helper should distinguish "item gone" (404-ish) from "hold lost" (409). Different error codes → different UI ("this item was returned to storage — please re-add to cart" vs "someone else got there first").

---

### 7. Admin reassigns held item to another agent mid-cart
**Where it bites:** Plan §4 "Out of scope — team-admin reassign." A team_admin holds a sign for agent X in their cart. Another team_admin (or main admin) reassigns the sign's `assignedToMemberId` from agent X to agent Y. The hold is unaffected — `assignedToMemberId` isn't in the hold's `where`. Checkout succeeds. The resulting `OrderItem.customerSignId` points to a sign now assigned to agent Y, but the order's `placedForAgentName` field (set at cart-time) still says "X". Billing/attribution is now wrong.

**Severity:** Medium — billing correctness for the teams feature.
**Mitigation:**
- Claim helper should ALSO match `assignedToMemberId` if the cart item carries an agent id: `updateMany({ where: { id, heldByHoldId, inStorage: true, assignedToMemberId: cartItem.expectedAgentId } })`. If null → 409 with `agent_reassigned` reason.
- Or: snapshot the assignment into the hold row at acquire time and refuse reassignment of held items via the existing `app/api/teams/inventory/route.ts` PATCH.

---

### 8. Server clock skew between web pod and DB → premature sweep
**Where it bites:** Plan step #8. The sweeper uses `expiresAt < now()` in Postgres (`NOW()`), but `expiresAt` is written from the web pod's `Date.now() + 15min`. Railway pods on different VMs can have NTP skew of seconds; with `setInterval` heartbeat running every 5min trying to extend, a 30s skew on one pod could make holds appear expired to the sweeper while the cart UI shows 14:30 remaining. Cart shows "you have 14 min left", user clicks checkout, gets 409.

**Severity:** Low-Medium — rare, but indistinguishable from a real bug when it happens.
**Mitigation:**
- Compute `expiresAt` server-side via Postgres: `expiresAt = sql\`now() + interval '15 minutes'\`` in the acquire transaction. Never use the Node-side clock. Same for the sweeper — it already uses `NOW()`. Now both sides agree.
- Or: sweeper grace period of 30s (`expiresAt < now() - interval '30 seconds'`). Cheap, hides skew.

---

### 9. Heartbeat fires from a phantom tab (BFCache, iOS background) and extends holds the user has abandoned
**Where it bites:** Plan step #11. Mobile Safari aggressively suspends JS, then resumes for ~1s when the app is swiped to. `setInterval` callbacks accumulated during suspension fire on resume. The plan's 5min heartbeat means a user who swipes away and back 14 min later will fire 1-3 bumps and reset their hold expiry, even if they never look at the cart again. Combined with iOS keeping safari pages alive for days, holds can stay live for hours past user abandonment.

**Severity:** Low — annoying for the team-race scenario the feature exists to solve.
**Mitigation:**
- Heartbeat should only fire when `document.visibilityState === 'visible'` AND the cart page is the active route. Use `visibilitychange` listener, not just `setInterval`.
- Server-side cap: hold may never be extended beyond 60 min total from `createdAt`. Force re-pick after 1 hour regardless of bump activity.

---

## MEDIUM

### 10. Brochure boxes — quantity-aggregated, but plan still creates "hold infrastructure supports brochure boxes"
**Where it bites:** §4 "Out of scope — brochure-box per-row hold." Today brochure boxes have no `customer_brochure_box_id` set anywhere. After the plan, `acquireHoldSchema` accepts `item_type: 'brochure_box'` — but nobody calls it. Risk: a future engineer reads the schema, assumes brochure boxes are held, adds wizard support, and forgets the aggregation/quantity logic in `OrderItem` (where one OrderItem with `quantity: 3` represents 3 brochure boxes). The hold model has 1 row per item id — there's no way to represent "hold 3 boxes from a pool of 12." Schema becomes a footgun.

**Severity:** Low — only bites if/when brochure boxes are made hold-able.
**Mitigation:**
- Until brochure boxes are actually per-row pickable, either omit `brochure_box` from the `HoldItemType` enum (cheaper) or add a `quantity` column to `InventoryHold` and a check constraint `quantity = 1 WHERE item_type != 'brochure_box'`. Plan punts; document the punt in the migration comment.

---

### 11. `claimHoldsInTx` `updateMany` `count !== 1` is ambiguous between "hold expired" and "item never existed"
**Where it bites:** Plan step #3/#13. If `cartItem.customerSignId` is a stale id (e.g. user is replaying an old cart from another device where the sign has since been deleted), `updateMany` returns 0 with no way to distinguish from "the hold expired" or "someone else claimed it." Single 409 message can't carry the right UI affordance.

**Severity:** Low — UX issue only.
**Mitigation:**
- Before throwing 409, do a follow-up read: `tx.customerSign.findUnique({ where: { id }, select: { id: true, inStorage: true, heldByHoldId: true } })`. If null → 404 "item no longer exists." If `inStorage: true` and `heldByHoldId: null` → "your hold expired, retry." If `heldByHoldId != myHoldId` → "another order took it."

---

### 12. `cart_session_id` migration when track #4 server `Cart` lands → orphan holds
**Where it bites:** Plan §4 "Out of scope — server `Cart` table." When `lib/cart-session.ts` switches from localStorage uuid to `Cart.id`, every active hold's `cartSessionId` becomes meaningless (points to a uuid that no longer maps to anything). The plan says "single switch point" but doesn't address the migration of in-flight holds. On the switch day, every user with an open cart will lose the link between their cart items and their holds — `removeItem` will fail to release the right hold (it queries by `cartItemId`, which is independently generated, so this part probably survives — but `clearCart`'s `?ownerUserId=me` survives too. The orphan is only the metadata used for "which cart did this come from").

**Severity:** Low — degraded forensics on switch day only.
**Mitigation:**
- On track #4 deploy, run a one-shot script that sets `cartSessionId = NULL` for all live holds. Or simpler: just accept the forensic gap and document it.

---

### 13. Hold acquired for an item that gets deleted by the customer's own admin during cart-flow
**Where it bites:** Plan step #6 (acquire endpoint). Hold targets `itemId` as a polymorphic string with no FK. If the underlying `CustomerSign` is hard-deleted by admin while the hold is live, the hold row dangles. Sweeper deletes it on expiry. But in the meantime, `GET /api/inventory` for the holder shows `held_by_me: true` for an item the DB no longer has → render crash.

**Severity:** Low — admin delete of in-use inventory is already discouraged.
**Mitigation:**
- Either add real FK relations on `InventoryHold` (one nullable column per `Customer*` table — ugly but enforced) and let cascade delete handle it, OR have inventory `GET` left-join the hold against the four tables and silently drop holds where the underlying item is gone.

---

## LOW / INFORMATIONAL

### 14. Sweeper running every 60s + 15min TTL means worst-case 16min hold for an abandoned cart
That's fine, but the plan's test checklist says "lets cart sit > 15 min without heartbeat, retries checkout — gets 409." Not necessarily — if the sweeper hasn't run yet on the still-live hold, the *holder's own* retry will succeed because their hold is still alive. The test as written is wrong; rewrite as "another user attempts to acquire — gets 409 for 15 min, succeeds after sweep."

### 15. `HoldItemType` enum cannot be extended without a migration
Postgres enums require `ALTER TYPE ... ADD VALUE` which Prisma `db push` can do, but not inside a transaction. Future "add `post` type to holds" will require manual SQL or a `prisma migrate` workflow the team isn't using. Consider `String` with a Zod check instead.

### 16. Plan's #14 ("move `Promise.all(inventoryUpdates)` into transaction with `order.create`") on the single-order route — Prisma's interactive `$transaction` callback default timeout is 5s. The single-order route does Stripe metadata updates, email sends, etc. immediately after — verify nothing email/Stripe-side is moved inside the tx, and bump `maxWait`/`timeout` if needed. Easy to get wrong on the first pass.

---

## Summary Table

| # | Edge case | Severity | Plan step affected |
|---|---|---|---|
| 1 | Webhook arrives before tx commits → leaked consumed holds | High | #8, #16 |
| 2 | `restoreOrderInventory` clobbers a re-allocated item | **Critical** (latent) | #16 |
| 3 | Partial-batch hold-conflict mid-tx → charge w/o order | **Critical** | #13 |
| 4 | Pod restart between PI create and tx commit → orphan PI | High | #13 |
| 5 | Cart abandonment leaks holder identity via 409 | High | #11, #12 |
| 6 | Admin physical-return / delete vs live hold | Medium | §4 deferral |
| 7 | Admin agent reassignment of held item | Medium | §4 deferral |
| 8 | Clock skew web pod vs DB | Medium | #8 |
| 9 | iOS BFCache phantom-tab heartbeat | Low-Medium | #11 |
| 10 | Brochure-box enum footgun | Low | schema |
| 11 | `count !== 1` ambiguity | Low | #3 |
| 12 | Cart-session migration day | Low | §4 deferral |
| 13 | Polymorphic FK + admin hard-delete dangle | Low | schema |
| 14 | Test-checklist worded wrong | Info | test plan |
| 15 | Enum extension friction | Info | schema |
| 16 | Tx timeout when single-order route is collapsed | Low | #14 |

**The three you should not ship without fixing: #2 (preexisting latent bug, made worse by the feature), #3 (charge-without-order regression), and #1 (silent leak that grows forever).** Everything else is acceptable risk for the 6.5h budget if logged as follow-up.