I have enough. Let me deliver the audit.

# Race/Idempotency Audit — Refund Flow

## Finding 1 — DB update failure after Stripe success leaves "phantom refund"
**Files:** `lib/refunds.ts:87-123`
**Sequence:** `refunds.create()` succeeds → `prisma.order.update({ refundId, ... })` throws (DB blip, FK error, etc.) → exception propagates → caller returns 500.
**Result:** Money is refunded on Stripe but `order.refundId` is still `null`. On retry the eligibility pre-check (line 73) passes again, we hit Stripe a second time. The SHA-256 idempotency key DOES protect us — Stripe returns the same Refund object. So eventually the DB row converges. **BUT**: between the Stripe success and a successful retry, the `charge.refunded` webhook will fire and enter the `dashboardInitiated = !order.refundId` branch (route.ts:209), wrongly classifying it as a Stripe-dashboard refund (`cancelReason: 'stripe_dashboard'`, sends an "admin" email instead of "customer"). It also stamps `status: 'cancelled'` itself.
**Severity:** Medium — eventually consistent but produces wrong audit metadata and wrong email content for the customer.
**Fix:** Wrap step 3 in a retry loop, OR insert the `refundId` row BEFORE calling Stripe (reserve a placeholder), OR have the webhook detect this race by checking `refundInitiatedAt`/audit log instead of just `refundId`.

---

## Finding 2 — Webhook racing refundOrder mid-flight: duplicate emails & misclassification
**Files:** `lib/refunds.ts:112-185` + `app/api/webhooks/stripe/route.ts:209,246-263`
**Sequence:** (a) refundOrder calls Stripe at line 87. (b) Stripe fires `charge.refunded` webhook within seconds. (c) refundOrder is still executing — has not yet run the line-112 update. (d) Webhook reads order: `refundId` is null → `dashboardInitiated=true` → webhook stamps `refundId`, `status='cancelled'`, `cancelReason='stripe_dashboard'`, `refundEmailSentAt`, sends "admin" email. (e) refundOrder's line-112 update now lands and overwrites `cancelReason='customer_cancel'`, `cancelledByUserId`, `refundReason` — good. (f) refundOrder's line-169 update sets `refundEmailSentAt` again — but it has ALREADY sent its OWN email because `options.skipEmail` is false. **Customer receives two emails.**
**Severity:** High — duplicate customer email is user-visible; also the webhook calls `releaseOrderHoldsAndRestoreInventory` (line 232) and refundOrder also calls it (line 137), so inventory restore runs twice (helper is documented idempotent — verify).
**Fix:** Make the webhook's "already-handled" check look at `refundInitiatedAt` OR audit log entry (`OrderRefundCreate`) — not just `refundedAt` + `paymentStatus`. The check at line 184 currently only short-circuits if `paymentStatus === 'refunded' && refundedAt`, which is exactly the state refundOrder never sets.

---

## Finding 3 — Concurrent customer-cancel + admin-refund: wrong actor wins
**Files:** `app/api/orders/[id]/cancel/route.ts:65-105` + `app/api/admin/orders/[id]/refund/route.ts:43-62`
**Sequence:** Two simultaneous requests, both see `refundId === null` and `paymentStatus === 'succeeded'`. Both call refundOrder → both hit Stripe with same idempotency key → Stripe returns same RefundId to both. Both reach line 112; Prisma update on same row is serialized but **NOT atomic with the read**. Whichever update runs second OVERWRITES: `refundReason`, `cancelledByUserId`, `cancelReason`, `refundInitiatedAt`. So if admin's request lands second, `cancelReason='admin_cancel'` clobbers `customer_cancel` (and vice versa). Audit log gets TWO `OrderRefundCreate` entries with different actors. Customer receives TWO emails (one with "customer" copy, one with "admin" copy).
**Severity:** High — produces wrong attribution data and double email.
**Fix:** Conditional update — `prisma.order.update({ where: { id, refundId: null }, ... })`. Catch the P2025 "record not found" → return `ALREADY_REFUNDED`. This makes the DB row the lock, not the read-then-write window.

---

## Finding 4 — Duplicate refund emails (webhook + refundOrder)
**Files:** `lib/refunds.ts:154-173` + `route.ts:246-263`
**Sequence:** refundOrder reaches line 154, calls `sendRefundConfirmationEmail` (line 158) — this is the network send. BEFORE line 169 commits `refundEmailSentAt`, the webhook arrives, sees `!order.refundEmailSentAt`, sends its own copy.
**Severity:** High — observable for any refund where the Stripe webhook arrives within ~500ms (common).
**Fix:** Stamp `refundEmailSentAt = new Date()` BEFORE the send call (reserve the slot), or use a conditional update `where: { id, refundEmailSentAt: null }` and only send if it returns a row.

---

## Finding 5 — Webhook replay: 10× retry behaviour
**Files:** `route.ts:184-285`
**Sequence:** First delivery for a refundOrder-initiated refund: `paymentStatus='succeeded'`, `refundedAt=null`, `refundId='re_xxx'` → falls through guard → enters main block → `dashboardInitiated=false` → stamps `paymentStatus='refunded'` + `refundedAt=now`. Replay #2: `paymentStatus='refunded' && refundedAt` truthy → short-circuit at line 184. **Replays 2-10 are safe.**
However, replay BETWEEN refundOrder finishing the Stripe call and the line-112 update (Finding 2 scenario) is NOT idempotent — it would re-execute "dashboard_initiated" branch each time. Also: the `refundEmailSentAt` check at line 246 means a replay after a transient email failure WILL re-send the email (because the stamp never landed). No de-dup on the email side.
**Severity:** Medium — base case is safe, edge cases not.
**Fix:** Use Stripe `event.id` for de-dup (table of processed events) — protects all branches uniformly. Move the `paymentStatus='refunded'` stamp into a conditional update for safety.

---

## Finding 6 — 24h cutoff timezone bug
**Files:** `app/api/orders/[id]/cancel/route.ts:72-88`
**Trace:** Customer in PT, scheduled tomorrow 9am ET. Stored value: depends on how `scheduledDate` is persisted. If stored at UTC midnight of the local installer date (common convention), say the install date = 2026-06-04. Code does `Date.UTC(2026, 5, 4)` → `2026-06-04T00:00:00Z`. Cutoff = `2026-06-03T00:00:00Z` = **2026-06-02 8pm ET / 5pm PT** the prior day.
A 9am ET install is at **2026-06-04T13:00Z**, which is 37 hours after the cutoff fires — customer LOSES 13 hours of their window. Worse: if `scheduledDate` is stored with a time component (e.g. `2026-06-04T13:00:00Z`), `getUTCDate()` still returns 4, so behaviour is the same, but for installs scheduled near UTC midnight the day can shift by one (`2026-06-04T23:30Z` → `getUTCDate()=4`; but a PT-stored value of `2026-06-05T01:00Z` for a 6/4 PT install would give cutoff = 6/4 00:00Z, blocking same-day cancels).
**Severity:** Medium — produces "cancellation window closed" errors hours earlier than the 24h promise.
**Fix:** Compute cutoff as `scheduledDate - 24h` directly (whatever the scheduledDate's timezone semantics), OR document scheduledDate's timezone clearly and convert to install-local midnight instead of UTC midnight.

---

## Finding 7 — Concurrent refundOrder writes: cross-actor clobber confirmed
**Files:** `lib/refunds.ts:112-123`
Stripe idempotency does protect against double-refund, and the unique constraint on `refundId` accepts the same value twice (no error). **But the OTHER fields are unguarded**: `refundReason` (customer's free text), `cancelledByUserId` (which user actually cancelled), `cancelReason` ('customer_cancel' vs 'admin_cancel'), and `refundInitiatedAt`. Whichever Prisma update commits last wins all four. Two audit entries also get written.
**Severity:** Medium-High — corrupts attribution; if admin races a customer, support can't tell who cancelled.
**Fix:** Same as Finding 3 — `where: { id, refundId: null }` conditional update, treat P2025 as "lost the race, no-op."

---

## Finding 8 — Stripe idempotency key + differing params
**Files:** `lib/refunds.ts:86-97` + `lib/stripe/server.ts:168-187`
**Trace:** Both customer (`auto:true`) and admin (`auto:false`) paths go through `refundPaymentIntent`. The `auto` flag is NOT passed into `refundPaymentIntent`'s params — it's only used downstream for email copy + audit metadata. The actual Stripe metadata sent is `{ order_id, cancel_reason, actor_user_id }`. Different paths DO send different `cancel_reason` (`'customer_cancel'` vs `'admin_cancel'`) and different `actor_user_id`. **Stripe's idempotency rule rejects requests with the same key + different body** (HTTP 400 `Keys for idempotent requests can only be used with the same parameters they were first used with`).
So in the Finding 3 race scenario: whichever call hits Stripe first wins; the second receives an idempotency error and refundOrder returns `STRIPE_ERROR` even though the refund DID happen. The user-facing message says "Refund failed" — misleading, support ticket inbound.
**Severity:** High — wrong user-facing error during admin/customer race; misleading audit (`OrderRefundFail`) without any actual failure.
**Fix:** Make the metadata identical on retry — strip per-actor fields from the Stripe call (move them to audit only), OR catch the idempotency error specifically and treat it as success after re-fetching the Refund.

---

## Summary of recommended fixes (ranked)
1. **Conditional update on `refundId: null`** (fixes Findings 3, 7 — single line change).
2. **Reserve `refundEmailSentAt` before sending** (fixes Findings 2, 4 — sequencing change).
3. **Webhook event_id de-dup table** (fixes Finding 5 edge cases).
4. **Strip per-actor metadata from Stripe call** (fixes Finding 8).
5. **Rewrite 24h cutoff against `scheduledDate - 24h`** (fixes Finding 6).
6. **Retry the DB update post-Stripe** (mitigates Finding 1).