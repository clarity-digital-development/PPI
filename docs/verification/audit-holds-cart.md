I have enough to write the walkthrough. The partial unique index name `inventory_holds_live_uniq` is referenced by `lib/inventory-holds.ts` line 661 and `docs/inventory-holds/verify-payment.md` (the design doc spells it `_unique` but the code+verify-doc agree on `_uniq`). I cannot live-verify in DB (local Prisma proxy not running), but the code has explicit error-matcher logic that proves the index name is the contract.

Here's the walkthrough.

---

## Inventory Holds + Cart Edit

**Code state vs. changelog claims — all green:**
- 15-min TTL: `lib/inventory-holds.ts:41` (`TTL_MINUTES = 15`) computed in Postgres (`NOW() + interval`) so Railway-pod clock drift can't poison expiry.
- Partial unique index `inventory_holds_live_uniq` referenced in the unique-violation matcher at `lib/inventory-holds.ts:661`. The acquire INSERT is wrapped in a `SAVEPOINT acquire_insert` (line 121) so a P2002 doesn't poison the outer tx — caught and rethrown as `HoldConflictError('item_already_held', …)`.
- Heartbeat: `lib/cart.ts:152-237`, default `4 * 60_000` ms, visibility-aware, also fires on `visibilitychange` for BFCache/iOS resume.
- Remove releases: `lib/cart.ts:118-126` fires `DELETE /api/inventory/holds?cart_item_id=`; clearCart hits `?owner_user_id=me`.
- Tx-first checkout: `app/api/orders/batch/route.ts` Step 3 creates orders + claims holds inside one tx (`prisma.$transaction`, line 247) BEFORE the PaymentIntent (Step 4, line 406). On tx failure, every just-acquired hold is released (line 339-348) and the response is 409. The PI uses a deterministic SHA-256 idempotency key (line 398) so a network retry can't double-charge.
- Cart Edit per row: `app/dashboard/cart/page.tsx:302-308` — the row's "Edit" link is `/dashboard/place-order?cart_item_id={row.id}`. `app/dashboard/place-order/page.tsx:57-62` reads `cart_item_id`, finds the matching row, passes `initialFormData={editingItem.formData}` and `editingCartItemId={editingItem.id}` to the wizard.
- Hold-diff on edit: `components/order-flow/steps/review-step.tsx:472-535`. Computes `toAcquire` (new keys not in `oldHoldIds`) and `toReleaseHoldIds` (old keys not in new). **Acquire first** (line 489-516) — on any conflict only the just-minted holds are unwound (line 521-526), the user's existing holds are kept. **Then release stale** (line 531-535) with `.catch(() => undefined)` so dead-hold 404s are swallowed.
- Cart row updated in place: `review-step.tsx:554-565` calls `cart.updateItem(editingCartItemId, …)` rather than `addItem` — no duplicate row.

**One small spec note (not a bug):** the design doc spells the index `inventory_holds_live_unique` while the code consistently uses `inventory_holds_live_uniq`. The code wins (it's what the runtime matcher looks for) — but the DB index must be created with the `_uniq` name to match the `err.message.includes(...)` fallback at `lib/inventory-holds.ts:661`. If a fresh Postgres ever gets the `_unique` name from the design doc, the SAVEPOINT/error catch still works via SQLSTATE 23505, so this is cosmetic.

**Ryan walkthrough — 6 scenarios.**

### Scenario 1 — Reserve, walk away 10 min, come back
1. Log in as `admin@pinkposts.com / admin123` (or `test@pinkposts.com / PinkPosts2026`).
2. Top nav → **Place Order**. If you're admin, pick a team and an agent (e.g. Ashley on Ryan's Test Team). If you're test@, you'll land on the wizard directly.
3. Fill the wizard with a real address; on the **Sign / Rider / Lockbox** step pick **From storage** and select a specific sign by description.
4. Continue to **Review & Pay** → click **Add to Cart**.
5. You land on `/dashboard/cart`. The row shows the property + agent + a `Reserved for 14:59` countdown badge.
6. Switch tabs / lock the laptop for 10 minutes. Come back.
7. **Expected:** badge now reads `~10:00` (4-min heartbeat fired on tab focus and re-bumped to 15:00, then ticked down). No red "expired" pill.
8. **If you see** a red `Reservation expired — remove & re-pick` instead, that's a bug — heartbeat or `visibilitychange` listener regressed.

### Scenario 2 — Same sign, two tabs (race)
1. Same admin login. Use **Place Order** to add one specific sign for Ashley to cart. Land on `/dashboard/cart`.
2. **Open a new tab** (Cmd/Ctrl-click) → **Place Order** again → repeat the wizard for the **same agent**, picking the **same** sign.
3. Click **Add to Cart** in tab 2.
4. **Expected:** the wizard shows an inline error: `"One of these items is already in another cart. Please refresh the inventory list and re-pick."` (text from `review-step.tsx:505`). The row is NOT added; cart still has only the tab-1 entry. No phantom hold created in tab 2 (the `acquired[]` unwind on `acqErr` releases anything we minted before the conflict).
5. **If you see** both tabs land on `/dashboard/cart` with the same sign reserved twice, the partial unique index is missing or the SAVEPOINT path is broken — the only thing standing between us and double-allocation.

### Scenario 3 — Edit a cart row, swap one sign for another
1. Add Sign-A for Ashley to cart, go to `/dashboard/cart`.
2. On that row, click the small **Edit** (pencil) link next to **Remove**.
3. You land back in the wizard. Header reads `Edit Cart Order — Ashley`. Wizard is pre-filled with everything from step 1.
4. Navigate back to the inventory step, deselect Sign-A, select **Sign-B** instead.
5. Continue to **Review & Pay** → button now reads **Update cart item — $XXX.XX** (not "Add to Cart"). Click it.
6. **Expected:** you return to `/dashboard/cart`. The original row is updated in place (same `addedAt`, same agent), now showing Sign-B's description in the items bullet list. The row count is still 1 — no duplicate.
7. Verify the hold swap server-side: visit `/admin/customers` → find Ashley → open her inventory. Sign-A should be back to `In Storage`; Sign-B should be `Reserved` (heldUntil set, inStorage true). Or hit `GET /api/admin/holds` as admin@ to see only Sign-B's hold live.
8. **If you see** Sign-A still appears reserved after the edit, the release-stale step silently failed — check browser console for 4xx/5xx on the `DELETE /api/inventory/holds?id=…` call.

### Scenario 4 — Remove a row releases the hold
1. With one row in cart, open `/api/admin/holds` in another tab as admin@ — note the hold id for that sign.
2. On `/dashboard/cart` click **Remove** on the row.
3. Refresh `/api/admin/holds`.
4. **Expected:** the hold no longer appears in the live list (it's been soft-released via `released_at`; the cron sweeper hard-deletes it within a minute or two). The sign on Ashley's inventory shows **In Storage** again, no `heldUntil`.
5. **If you see** the hold still listed 5+ minutes later, the `DELETE` route's owner-scope guard at `app/api/inventory/holds/route.ts:171-183` may be rejecting your request as Forbidden — check Network tab for a 403.

### Scenario 5 — Wait 16+ min, refresh cart
1. Add a sign to cart, go to `/dashboard/cart`. Note the countdown.
2. **Disable JavaScript** in DevTools (or open `chrome://settings/content/javascript`) to kill the heartbeat without removing the row, OR pause execution in the cart page's `bump()` for 16+ min.
3. Wait 16 minutes (TTL is 15, plus a slop minute for the sweeper).
4. Re-enable JS, refresh `/dashboard/cart`.
5. **Expected:** the row stays visible but its badge flips to red `Reservation expired — remove & re-pick`. The amber banner appears at the bottom: `"Some reservations expired while your cart was open."` The **Place N orders** button is **disabled** (the `expiredRows.size > 0` check on `app/dashboard/cart/page.tsx:412`).
6. Click **Remove** on the expired row → re-add from the wizard. Checkout button re-enables.
7. **If you see** the checkout button stays enabled with a red row, the `disabled={…expiredRows.size > 0}` guard regressed — and we'd 409 at the server's prevalidate step anyway (`app/api/orders/batch/route.ts:172-211`), which is still safe but a worse UX.

### Scenario 6 — Checkout 2 cart items totaling $300 → single charge
1. Use the wizard twice: add two orders to cart for two different agents (or the same agent, two properties). Make sure the **estimated totals** in the cart header read ~$300 combined.
2. On `/dashboard/cart`: pick your saved card from the **Charge to** select.
3. Click **Place 2 orders — $300.00+**.
4. **Expected:**
   - Both row footers turn pink with `Placing order 1 of 2…` spinners, then both flip green to `Placed — PP-XXXXXX`.
   - The cart empties (`clearCart()` fires after success — `app/dashboard/cart/page.tsx:182`).
   - In Stripe Dashboard → Payments, you see **one** PaymentIntent for $300 (plus tax), NOT two.
   - In `/admin/orders` you see two distinct order rows, each carrying the same `paymentIntentId`.
5. **If you see** two separate Stripe charges, the batch route was bypassed (single-order POST `/api/orders` was hit instead of `/api/orders/batch`) — likely the cart fell back to per-row checkout, which is a regression.
6. **If you see** the spinner finishes but the cart still has both items, the success path's `clearCart()` was skipped — the row results will still show "Placed" so the work isn't lost, just refresh once and re-clear manually.

**Acceptance for the whole area:** all six pass + `/api/admin/holds` shows zero zombie rows (no `released_at IS NULL AND expires_at < now()` survivors). The cron sweeper at `/api/cron/inventory-hold-sweeper` is guarded by `CRON_SECRET` — Railway/Vercel cron config must hit it once a minute or the lazy-sweep in `acquireHold` (line 96-110) carries the load alone, which is fine but means dead rows linger until the next acquire on the same item.

Files inspected (all confirmed): `lib/inventory-holds.ts`, `lib/cart.ts`, `lib/cart-session.ts`, `app/api/inventory/holds/route.ts`, `app/api/inventory/holds/bump/route.ts`, `app/api/cron/inventory-hold-sweeper/route.ts`, `app/api/orders/batch/route.ts`, `app/dashboard/cart/page.tsx`, `app/dashboard/place-order/page.tsx`, `components/order-flow/steps/review-step.tsx`, `app/api/admin/holds/route.ts`, `prisma/schema.prisma` (InventoryHold + denormalized `heldByHoldId/heldUntil` cols on Customer{Sign,Rider,Lockbox}).