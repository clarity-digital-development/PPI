# Plan v2: Ryan's 2026-06-02 feedback (post-PM critique)

**Status:** ✅ DECISIONS LOCKED 2026-06-02 — in implementation on branch `ryan-feedback-2026-06-02`
**Target ship:** 6/10 · **Total dev:** ~33h dev + ~5h QA

## DECISIONS LOCKED (Ryan + Tanner, 2026-06-02)

| # | Decision | Source |
|---|---|---|
| 1 | Cart: **server-side per-session** (Path 2) | Ryan |
| 2 | Refund email: **broker / team_admin only** | Ryan |
| 3 | Removal on pending order: **prevent + redirect to edit/cancel** | Ryan |
| 4 | Promote to admin: **supportstaff@semonin.com** | Ryan |
| 5 | $18 rental terms-page disclaimer: **"effective 6/10/2026"** | Ryan |
| 6 | Cancellation cutoff: **24h before scheduled install** | Tanner |
| 7 | Refund v1: **full refund only** | Tanner |
| 8 | Refund auto-execute: **< $250 auto, ≥ $250 click-through** | Tanner |
| 9 | Admin role-change UI: **ship alongside script (Track A+B)** | Tanner |
| 10 | Audit log: **foundation first** | Tanner |

"Sub-accounts where users can log in" interpreted as the existing Teams architecture (team_admin logins; future agent upgrades via the hybrid model already supports it).

## Changes from v1 (driven by PM critique)
- **Issue 5 (cart):** flipped default — **Path 2 (server-side session-keyed cart)** instead of pushing Ryan toward sub-accounts. Reason: Ryan's email explicitly said *"one login w simultaneous adding would be easiest"*; v1 was optimizing for engineering effort, not for the customer ask.
- **Issue 5B (inventory race):** added a **soft-hold/reservation layer** (15-min TTL claim at add-to-cart, release on abandon). The bare "this item was just claimed" error is unacceptable UX mid-batch.
- **Issue 4 (admin inventory):** **per-agent grouped sections** (collapsible) — Ryan's video describes a *subcategory* mental model, not a filter dropdown. Plus a bulk-reassign action and an "Unassigned (n)" group at the top.
- **Issue 3 (Schedule Trip modal):** **hybrid** — include in-flight orders for service/repair/replacement only; for `removal` against a pending order, redirect the user to **edit or cancel** the order instead.
- **Issue 1 (refund):** v1 was too thin for a real-money path. Added explicit Stripe↔DB consistency design, branded receipt, refund approval policy, partial-refund edge case (edit-then-cancel), team_admin cancel-on-behalf-of with appropriate notifications.
- **Issue 2 (admin promote):** ship **Track A (script) + Track B (UI)** together. Don't leave the role-change UI gap.
- **NEW:** **Audit log table** + writes from every refund, role change, admin-driven cancellation, and inventory reassignment.
- **NEW:** **Terms-page disclaimer for the $18/6-month post rental** (the terms page advertises it; we promised; nothing is charging). Either add an "effective from" date or remove the language. Either way, it can't stay silently undelivered.

The remaining structure of v1 stands. v1 file: `docs/ryan-feedback-plan-2026-06-02.md` (kept for diff reference).

---

## Issue 1 — Customer cancel + refund (REVISED)

### Approach
Owner-scoped cancel + Stripe refund, with consistency hardening:

1. **Stripe is the source of truth.** Refund flow:
   ```
   1. mark Order.cancelling = true (idempotency lock)
   2. stripe.refunds.create({ payment_intent, metadata: { orderId } }, { idempotencyKey: `refund-${orderId}` })
   3. on success → DB transaction: set paymentStatus='refunded', status='cancelled', cancelledAt, cancelledBy, refundedAt, refundAmount, refundStripeId; restoreOrderInventory
   4. on DB failure → log loud, alert Pink Posts ops (the refund happened, the DB lost) → reconciliation job
   ```
2. **Webhook:** handle `charge.refunded` / `refund.updated` to reconcile any Stripe-dashboard-initiated refunds back into our DB.
3. **Reconciliation job:** daily check for `paymentStatus !== 'refunded'` orders that have a refund recorded in Stripe (or vice versa). Initially manual review queue; cron later.
4. **Approval policy (Tanner's call, propose for Ryan ack):** auto-execute refunds **≤ $250**; over $250 require admin click-through (button on the order page that says "Approve refund of $X"). Reason: limits blast radius of any abuse or UI mistake on a B2B account.
5. **Receipt email:** Pink Posts branded; references the original order; lists what's being refunded; not just the Stripe default.
6. **Cancellation cutoff (Tanner's call, communicate to Ryan):** Customer self-cancel disabled when `status === 'scheduled'` AND `scheduledDate < now + 24h`. Admin/team_admin can still force-cancel.
7. **Authorization:** customer can cancel own order; team_admin can cancel any order in their team (`canActOnBehalfOf`); admin can cancel anything.

### Schema (additive)
- `Order.cancellingAt`, `Order.refundedAt`, `Order.refundAmount Decimal?`, `Order.refundStripeId`, `Order.cancelledAt`, `Order.cancelledBy` (`'customer'|'admin'|'team_admin'`).

### Open
- **Partial refund / edit-then-cancel.** If a broker edits the order DOWN (lower total) then customer cancels, we refund the **current** total, not the original charge. If lower than the original charge, the remainder stays with Pink Posts. Acceptable for v1; flagged in audit log; full proration is v2.
- **Audit log writes** on every refund (separate from order record): actor, payment intent id, amount, reason.

### Effort: ~8h (5h base + 3h hardening)

---

## Issue 2 — Promote user to admin (REVISED — ship A+B)

### A (immediate, 1-line):
Run a script — `npx tsx scripts/_promote-admin.ts <email>` — to update `user.role = 'admin'` for the account Ryan names. **Will do this the moment Ryan gives the email.**

### B (durable, ship same PR):
- Extend `PUT /api/admin/customers/[id]` to accept `role` (admin caller only).
- "Change role" control on admin customer detail page with confirm modal.
- Self-demote block (admin cannot remove their own admin role).
- **Audit log entry** on every role change.

### Effort: ~2h (A is 5 min, B is ~1.5h)

---

## Issue 3 — "Existing Installation" modal (REVISED — hybrid)

### Approach
Investigate `components/dashboard/installation-modals/ScheduleTripModal.tsx` (~30 min). Then implement **hybrid**:

- For **service / repair / replacement** trip types: broaden the picker to include both active `Installation` records AND **in-flight orders** (`status ∈ {confirmed, scheduled, in_progress}`) — labeled by property address with a small badge ("Installed" vs "Pending install"). Matches Ryan's mental model: *I placed an order, I expect to see it here.*
- For **removal** type: keep precise scope (only active Installations). When the customer picks "removal" and they have no installations but DO have pending orders, show an inline message: *"You can't schedule a removal on a pending order. Edit or cancel it instead."* with deep-link buttons.
- "Other Address" tab unchanged — still the fallback.

### Effort: ~3h (30 min investigation, 2h impl + UX, 30 min test)

---

## Issue 4 — Admin: assign inventory at add-time + per-agent grouped view (REVISED — grouped sections, not filter)

### (a) Add-time assignment (unchanged from v1)
"Assign to agent" dropdown in the Add Inventory modal, gated to team_admin customers. Extend `POST /api/admin/customers/[id]/inventory` to accept `assigned_to_member_id` (column already exists).

### (b) Per-agent grouped inventory (REVISED — was "filter")
On the admin customer detail page for `team_admin` customers, **re-organize the inventory cards into collapsible per-agent sections** with item counts: e.g.
```
▼ Ashley Carter (4 signs · 2 riders · 1 lockbox)
▶ Marcus Bell (1 sign · 0 riders · 1 lockbox)
▶ Unassigned (3 signs · 1 rider · 0 lockboxes)
```
Each section contains the existing inventory cards filtered to that agent. Items have an inline reassign control (admin equivalent of `PATCH /api/teams/inventory` that bypasses the team-membership check). Bonus: **bulk-reassign** action — admin selects N items via checkbox, picks a target agent.

### Effort: ~4h ((a) 2h + (b) 2h)

---

## Issue 5 — Cart concurrency + simultaneous orders (REVISED — embrace Ryan's ask)

### Part A — Server-side session-keyed cart (Path 2, was Path 1 in v1)
**Why:** Ryan said one shared login is what he wants. Pushing him to sub-accounts is engineering-convenient but isn't the customer ask. Build it.

- **Model:** `Cart { id, userId, sessionId String @unique, items Json, updatedAt }`. One Cart per browser session (NextAuth session id). Same login on machine A and machine B → 2 sessions → 2 carts.
- **API:** `GET/PUT/DELETE /api/cart` (and per-item endpoints). The `useCart` hook reads/writes from server (with localStorage as offline cache).
- **Migration:** `lib/cart.ts` rewritten to use the API. Tabs in the same session sync via short-poll or SSE on mutation events. Persist across reloads.
- **Cleanup:** carts older than 30 days auto-deleted (cron later, manual ok at launch).

### Part B — Soft-hold inventory reservations (was raw race-fix in v1)
**Why:** The raw "this item was just claimed" mid-batch error is brutal UX. We need to claim inventory the **moment** it goes into a cart, not only at checkout.

- **Model:** `InventoryHold { id, type ('sign'|'rider'|'lockbox'|'brochure_box'), inventoryId, cartId, holdsUntil DateTime, createdAt }`.
- **Semantics:** Adding an item with `customer_*_id` to the cart creates a 15-minute hold. Renew on cart mutation. Release on remove, cart clear, or hold expiry (cron, every 5 min).
- **Check at add-to-cart:** atomic `INSERT … SELECT … WHERE NOT EXISTS (active hold by other cart)`. If held by someone else, surface a friendly *"Marcus picked this sign 4 minutes ago — pick another or wait."*
- **Checkout:** validates all holds belong to this cart and haven't expired; then commits as today (atomic `updateMany WHERE inStorage = true`).
- **Edge:** abandoned holds (broker walks away). 15-min TTL releases them automatically.

### Effort
- Part A: ~8h (model, API, hook rewrite, cleanup)
- Part B: ~6h (model, hold logic, atomic add, expiry cron, UI affordance)

---

## NEW — Audit log

`Audit { id, actorUserId, action ('refund'|'cancel_order'|'role_change'|'inventory_assign'|...), targetType, targetId, payload Json, createdAt }`. Write from each of refunds, role changes, admin-driven cancellations, inventory reassignments. **Minimum viable:** the table + writes from the four paths. **Stretch:** an admin UI to browse. Cost: ~2h v1; UI ~3h v2.

---

## NEW — Terms-page disclaimer for $18/6-month rental

The terms page (`app/(marketing)/terms/page.tsx`) promises a recurring rental charge that nothing currently executes. Either:
- (A) Add inline copy: *"Extended rental billing is launching <DATE> — accounts under 6 months are not yet being charged."*
- (B) Remove the language until the system is live.

Recommend (A) with Ryan's go-live target. **Tanner do this week regardless of implementation.** Cost: 5 minutes.

---

## Sequencing (revised by PM)

| # | Item | Effort | Notes |
|---|---|---:|---|
| 0 | Terms-page disclaimer for $18 rental | 5m | This week, independent |
| 1 | Audit log model + writes (foundation) | 2h | Lands first so subsequent items use it |
| 2 | Promote admin (Track A script + Track B UI) | 2h | One PR |
| 3 | Inventory soft-hold reservations + race fix | 6h | Foundation for cart Part A |
| 4 | Server-side session cart (Path 2) | 8h | Sits on #3 naturally |
| 5 | Customer cancel + refund (with hardening + audit) | 8h | Highest-risk path |
| 6 | "Schedule a Trip" hybrid (service/repair vs removal-on-pending) | 3h | Customer-visible bug |
| 7 | Admin: inventory add-time + per-agent grouped sections + bulk reassign | 4h | Polish & UX |

**Total:** ~33h dev + ~5h QA on payments path = **~38h.** 6/10 is achievable if we start now and don't churn.

**If something must be cut for 6/10:** cut Issue 4(b) bulk-reassign and the per-agent grouping refinement first (drop to v1's simpler filter). Don't cut refund hardening, audit log, or cart Part A.

---

## Questions

### For Ryan (5)
1. **Cart confirmation.** "We're going to build server-side per-session carts so two humans on one login each get their own cart — confirming this is the model you want, vs giving each person their own login?"
2. **Refund email recipient.** "When a team_admin cancels an agent's order, who should receive the refund confirmation — the agent, the broker, both?"
3. **Existing Installation, removal case.** "If an agent has a pending order and tries to schedule a *removal* on it, should we (a) prevent it and tell them to edit/cancel the order, or (b) allow it and you'll reconcile on the back end?" (Recommending a.)
4. **Admin email to promote.** "Send the email."
5. **$18 rental target date.** "What's your real launch date for the extended-rental charge? We'll add an 'effective from' line to the terms page in the meantime."

### Tanner's calls (won't ask Ryan)
- Cancellation cutoff: 24h before scheduled install (propose, communicate as Pink Posts policy).
- Refund v1 = full refund only; partial in v2.
- Refund approval threshold: auto under $250, click-through over.
- Ship Track 2A + 2B together.
- Audit table now (not later).

---

## Risk register

| Risk | Mitigation |
|---|---|
| Stripe refund succeeds, DB write fails | Idempotency key + webhook reconciliation + daily check job |
| Soft-hold expiry while broker is mid-checkout | UI shows hold countdown; auto-renew on cart mutation |
| Promote-admin script + no UI = drift if Tanner is unavailable | Ship UI same PR (B) |
| 6/10 timeline tight | Don't cut payment safety; cut polish first (Issue 4b) |
| Real customers reading $18 promise on terms page | Disclaimer this week |

---

## Out of scope (intentionally)
- Full $18/6-month auto-charge implementation (separate sprint).
- Audit log browse UI (stretch).
- Sub-account self-invite UX (still possible via existing Add Member if Ryan wants it).
- Notifications to Pink Posts on high-value refunds (recommend Slack/email but not blocking 6/10).
