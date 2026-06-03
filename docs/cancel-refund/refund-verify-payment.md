I have enough context. Let me synthesize the audit findings.

---

# Payment/Refund Safety Audit — ryan-feedback-2026-06-02 @ f7fda17

## CRITICAL findings (money / state correctness)

### F1. SEV-HIGH — Stripe-dashboard partial refund permanently leaves order in `succeeded`
**Where:** `app/api/webhooks/stripe/route.ts:189-205` (charge.refunded handler).
**Sequence:** Admin issues a $50 partial refund on a $500 order via Stripe Dashboard. Webhook fires with `amount_refunded=5000`, `amount=50000` → `isFullRefund=false` → writes a partial audit, `break`. Order `paymentStatus` stays `succeeded`, `refundedAmount` stays null. Customer sees the $50 credit at their bank but the app insists they paid full price; admin UI shows no refund ever happened. Now the admin issues a *second* partial via Dashboard for another $100 — same audit-and-break. Cumulative state is invisible in our DB.

Re Q4: yes, this is what the code does, BUT there's a worse follow-on. If an admin later issues the *remaining* $450 via Dashboard, charge.refunded fires with `amount_refunded=50000 === charge.amount` so `isFullRefund=true`. Then `dashboardInitiated = !order.refundId` evaluates true, the order is flipped to refunded, and **the refund-confirmation email is sent with `refundAmount = refundedCents/100 = 500`** — telling the customer they got $500 back when only $450 hit their card on the final event (the prior $50 was already settled). The email is wrong by exactly the partial-refund delta.

**Fix:** Even when `!isFullRefund`, write `refundedAmount = refundedCents/100` and add a `partialRefundedAt` column so the UI can reflect partial state. Acceptable for v1 to NOT auto-cancel the order, but the dollar count must be persisted so the final full-refund email computes the delta correctly (or simply suppress the email when prior partials exist).

---

### F2. SEV-HIGH — Webhook race overwrites `cancelReason` and email is sent twice
**Where:** `lib/refunds.ts:86-123` vs `app/api/webhooks/stripe/route.ts:207-270`.
**Sequence (confirms Q8):** `refundOrder` calls `Stripe.refunds.create`. Stripe processes synchronously and dispatches charge.refunded. Next.js handler picks it up on another container before `refundOrder` reaches step 3. Webhook queries by `paymentIntentId`, sees `order.refundId === null`, computes `dashboardInitiated = true`, and the update at line 212-228 writes `refundId`, `refundInitiatedAt`, `status='cancelled'`, `cancelledAt`, `cancelReason='stripe_dashboard'`. THEN `refundOrder`'s update at lib/refunds.ts:112 runs and *overwrites* `cancelReason` to `'customer_cancel'` and `cancelledByUserId` to the user id — but `refundedAt` (set by webhook) survives, and `refundEmailSentAt` was set to null when the webhook started but to NOW by the webhook's update at line 260-263.

Worse: the webhook sends the email at line 249-259 (sees `!order.refundEmailSentAt` from the pre-update `order` object). Then `refundOrder` continues to step 7 (lib/refunds.ts:154), checks `options.skipEmail` (false for the route path), and **sends a second email**. Customer gets two refund emails. The webhook also runs `releaseOrderHoldsAndRestoreInventory` at line 232-243 (only on `dashboardInitiated`), and so does `refundOrder` at lib/refunds.ts:137 — both calls run, but the helper is idempotent so this is benign.

**Fix:** Acquire a per-order lock or use a conditional update at lib/refunds.ts:112 (`where: { id, refundId: null }`) and detect zero-row writes → skip the duplicate email. Alternatively, the webhook should treat `dashboardInitiated` as definitive only when `now - charge.created > N seconds` to give the application path time to stamp `refundId`.

---

### F3. SEV-MEDIUM — `releaseOrderHoldsAndRestoreInventory` race vs new order for same inventory
**Where:** `lib/inventory-holds.ts:827-885` (`restoreIfSafe`).
**Sequence (Q5):** Order A is cancelled+refunded; `refundOrder` calls `releaseOrderHoldsAndRestoreInventory(A, ...)`. Customer immediately re-orders inventory item X → Order B places, `payment_intent.succeeded` webhook fires, OrderItem links sign X to Order B and inventory flip happens. Then **charge.refunded for Order A** arrives (Stripe delivery is asynchronous, often delayed seconds-to-minutes). Webhook handler at route.ts:230-243 — gated on `dashboardInitiated`, which evaluates `!order.refundId`. By now Order A's `refundId` is set (`refundOrder` already wrote it), so `dashboardInitiated=false` and the inventory restore is correctly skipped. **Safe in this path.**

BUT: if Order A's refund was initiated FROM the Stripe Dashboard (and the customer somehow places B between dashboard-click and webhook delivery — unlikely but possible), `dashboardInitiated=true` runs `releaseOrderHoldsAndRestoreInventory(A,...)`. `restoreIfSafe` at lib/inventory-holds.ts:841-848 queries for "other live OrderItem pointing at X with paymentStatus in succeeded/processing/pending". Order B qualifies → `restoreIfSafe` returns early without clobbering. **Also safe.**

However: there's a hole. If Order B was placed but `payment_intent.succeeded` hasn't fired yet, B's `paymentStatus` is the schema default (likely `pending`) — still inside the safe set. Good. But if B is in payment retry / 3DS (`requires_action`), there's no Order row created at all in the new flow, so X is in storage and re-holdable. Fine.

**Verdict for Q5:** No data loss, but only by accident — the safety relies on `paymentStatus` defaulting to a "live" value AND on the order/items row existing at the moment the restore-check runs. Add an explicit comment + test in `restoreIfSafe` so a future schema change doesn't silently break it.

---

### F4. SEV-MEDIUM — Cutoff bypass via scheduledDate timezone parsing
**Where:** `app/api/orders/[id]/cancel/route.ts:72-88`.
**Issue:** `Date.UTC(scheduled.getUTCFullYear(), scheduled.getUTCMonth(), scheduled.getUTCDate())` then `cutoff = utcMidnight - 24h`. The cutoff is fixed by `scheduledDate`'s stored value; a customer cannot manipulate the request payload to bypass it because we only read `order.scheduledDate`. **Q2: not bypassable from POST body.** Confirmed safe.

However, the UTC-midnight choice is generous to customers in negative-UTC zones. Install scheduled 2026-06-05 (interpreted as UTC midnight) → cutoff is 2026-06-04 00:00 UTC = 2026-06-03 20:00 EDT. A Lexington customer cancelling at 7pm local on June 4 is canceling 4 hours BEFORE local midnight, ~28h before a typical 9am install. Fine. But the OPPOSITE direction matters: install scheduled in Pacific timezone for 9am 2026-06-05 (PDT) = 2026-06-05 16:00 UTC. UTC midnight is 16h *before* the actual install → cutoff is 24h before that = 40h before actual install. Customer can't cancel within ~40h. This is more restrictive than advertised "24h before install" — friction, not a money bug.

**Fix:** Document the policy choice explicitly, or change to `scheduledDate - 24h` if scheduledDate is stored as a timestamp at the local install hour.

---

### F5. SEV-LOW — Threshold bypass via crafted POST is impossible
**Where:** `app/api/orders/[id]/cancel/route.ts:90-103`.
**Q3:** The check is `if (isHighValue && !confirmed)` → 409. A malicious POST CAN set `{confirmed: true}` on the first attempt. The "modal" is purely UX; server-side the only enforcement is that the user clicked through OR sent `confirmed:true` themselves. This is fine — `confirmed:true` for one's own order just executes the refund the customer is already entitled to. **Not a bug, just confirm intent matches design.** Audit metadata records `auto: !isHighValue` so analytics can see "this was a high-value confirm" regardless.

---

### F6. SEV-LOW — Q6 confirmed: NOT_REFUNDABLE catches `paymentIntentId=null`
**Where:** `lib/refunds.ts:79-81`. Explicit guard `if (!order.paymentIntentId) return NOT_REFUNDABLE`. Confirmed safe.

---

### F7. SEV-PRODUCT — Q7: placedByUserId can cancel
**Where:** `app/api/orders/[id]/cancel/route.ts:46-48` accepts `order.userId === user.id || order.placedByUserId === user.id`.
**Issue:** A team_admin who placed on behalf of an agent CAN cancel that order. But the email recipient via `resolveRefundRecipient` rule (1) ALSO emails the team_admin — so the agent whose inventory just got released and whose install got cancelled never receives notification. The agent only finds out by looking at the app. Product question, not a money bug.

**Fix:** Either CC the agent on the refund email when `placedByUserId !== userId`, or restrict cancel to placer only when order is recent. Confirm with Ryan.

---

### F8. SEV-LOW — Double-refund attempt window
**Where:** `lib/refunds.ts:73-75` checks `order.refundId || order.paymentStatus === 'refunded'`.
**Sequence:** Customer double-clicks Cancel rapidly. Request A loads order (refundId=null). Request B loads order (refundId=null). Both pass eligibility, both call `refundPaymentIntent`. Both use the same idempotency key (`SHA-256(orderId:refund_v1)`) — Stripe returns the SAME Refund object to both. Both update Order to the same `refundId`. Both audit. Both attempt to send email. Customer gets TWO refund emails for one refund. Inventory restore is idempotent. **No financial harm but the customer is confused.**

**Fix:** Make the order update at lib/refunds.ts:112-123 conditional (`updateMany where refundId: null`) and bail (return ALREADY_REFUNDED) when count===0. This narrows the email-duplication window to near-zero.

---

## Summary

- **Customer money safety (Q1): SAFE.** Stripe idempotency key prevents double refunds; the eligibility checks prevent unrefunded charges from being orphaned in the happy path.
- **Q2 cutoff bypass: SAFE** (server reads scheduledDate from DB).
- **Q3 threshold bypass: NOT A BUG by design.**
- **Q4 partial refunds: BROKEN — F1.** UI lies to customer; second partial cascading into a "full" event sends a wrong-amount email.
- **Q5 inventory race: SAFE by accident — F3.** Document and pin with a test.
- **Q6 PI=null: SAFE.**
- **Q7 placer cancel: PRODUCT CALL — F7.**
- **Q8 audit-trail race: REAL — F2.** Plus the duplicate-email side effect that makes it customer-visible.

**Priority order to fix:** F2 (duplicate emails + wrong audit reason) → F1 (partial-refund silent failure) → F8 (double-click duplicate emails) → F3 (test pin) → F7 (product) → F4 (policy clarity).