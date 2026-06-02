# Plan: Ryan's 2026-06-02 feedback (videos + email)

**Owner:** Tanner · **Target ship:** before 6/10 implementation date · **Status:** draft for PM review

## Inputs synthesized

**Email (3 items):**
- E1. Simultaneous orders under one shared admin account must not conflict ("if 1 admin is logged in and adding to cart, it's not affected admin 2's cart"). Ryan prefers one login + simultaneous adding; sub-accounts a fallback but inventory must be shared.
- E2. Customer-facing **cancel order with refund**. On the test account, a pending order has no cancel control.
- E3. Promote a **specific user account to `admin`** so it gets the admin dashboard. Tell Ryan when ready so the admin can play with it.

**Videos (3 clips, Higgy-analyzed):**
- V1 (IMG_7059, 0:38) — Admin viewing Peggy's customer profile, adds team member "Carter Martin Jr". Wants the inventory Add modal to **let admin pick which team member to assign the item to** at add-time, and the inventory section to **sub-categorize by team member** so admin can drill into one agent's pool.
- V2 (IMG_7060, 0:13) — Confirms V1: after adding inventory, **no way to assign it to the team member** from the admin profile.
- V3 (IMG_7063, 0:54) — Praises new dashboard "Schedule Removal" flow. **Bug:** Service Requests → "Schedule a Trip" → "Existing Installation" tab shows **"No active installations found"** even when active installations exist; agents are skipping that tab and using "Other Address" instead.

**Implied/derived:**
- E1' (from E1) — There's also a server-side inventory race in `/api/orders` POST and `/api/orders/batch`: two concurrent claims of the same `customerSignId` both succeed (no DB-level uniqueness/atomic claim). Distinct from cart isolation, both must be addressed for "simultaneous orders that don't conflict."

## Current-state confirmations (from code map)

- Cart: `lib/cart.ts` → `localStorage` key `pp_cart_v1`, per-browser (not per-user). `storage` event syncs across tabs of the same browser. No server-side cart.
- Inventory locking: `app/api/orders/route.ts` (lines 363–400) and `app/api/orders/batch/route.ts` (lines 205–216) flip `inStorage: false` after order creation. **No atomic check** — two parallel orders can both claim the same `customerSignId`.
- Refunds: **zero `stripe.refunds.create` usages** anywhere. Only reference is a comment in the admin cancel route ("Refund it from Stripe first").
- Customer cancel: **does not exist** — only admin can set `status = 'cancelled'`, and only if `paymentStatus !== 'succeeded'`.
- Role change: **no UI, no API** — direct DB UPDATE required to promote a user.

---

## Issue 1 — Customer cancel + refund (E2)

### Recommendation
Add an owner-scoped cancel-and-refund flow. Mirror the existing service-request cancel pattern.

### Changes
- **Schema (additive, nullable):** `Order.refundedAt DateTime?`, `Order.refundAmount Decimal?`, `Order.refundStripeId String?`, `Order.cancelledBy String?` (`'customer' | 'admin'`), `Order.cancelledAt DateTime?`. `paymentStatus` already has `refunded` value.
- **New route:** `PATCH /api/orders/[id]/cancel` (or extend `/api/orders/[id]/edit`).
  - Auth: order owner OR admin OR `team_admin` whose `canActOnBehalfOf(actor, order.userId)` is true (lets the broker cancel an agent's order).
  - Status gate: allow when `status ∈ {pending, confirmed, scheduled}`. Reject when `in_progress | completed | cancelled`.
  - If `paymentStatus === 'succeeded'` and `paymentIntentId` exists:
    - `stripe.refunds.create({ payment_intent: paymentIntentId, metadata: { orderId } })` (idempotency-key = `cancel-<orderId>`).
    - On success, write `refundedAt`, `refundAmount = total`, `refundStripeId`, set `paymentStatus = 'refunded'`.
  - Restore inventory (`inStorage: true`) via the existing `restoreOrderInventory` helper.
  - Set `status = 'cancelled'`, `cancelledBy`, `cancelledAt`.
  - Trigger admin email notification.
- **Webhook:** handle `charge.refunded` / `refund.created` for idempotency safety (if a refund is initiated via Stripe Dashboard manually, sync back).
- **UI:**
  - `app/dashboard/orders/[id]/page.tsx` — add a **"Cancel order"** button for eligible statuses, with confirm modal that explicitly says "This will refund $X to the card ending in •••• Y." Disabled for non-eligible.
  - Add the same control to the team_admin order-history rows (so brokers can cancel on behalf of agents).
- **Email:** customer cancellation confirmation; admin notification.

### Trade-offs / risks
- **Money risk:** real refunds. Mitigations: idempotency key, status checks, audit trail, webhook reconciliation.
- **Cut-off policy:** open question — should there be a "no self-cancel within X hours of scheduled install"? Recommend `no cancel if status === 'scheduled' AND scheduledDate is within 24h` (admin can still force-cancel).
- **Partial refund:** propose **full refund** only in v1. If Ryan wants prorated (e.g. expedite fee non-refundable), add later.

### Effort: **Medium** (~4-5h incl. tests)

---

## Issue 2 — Promote user to `admin` (E3)

### Recommendation
**Two-track:**
- **Track A (immediate):** When Ryan gives us the email, I run one DB update via a script (mirrors how we set Semonin's `freeLockboxInstall`). Done in minutes — unblocks Ryan.
- **Track B (durable):** Add an admin-only "Change role" control on the admin customer detail page with strong guardrails:
  - Confirmation modal that prints the email + new role explicitly.
  - Block self-demote (admin can't remove their own admin).
  - Extend `PUT /api/admin/customers/[id]` to accept `role` (admin caller only).
  - Audit log entry (we don't have one today — minimum: server `console.log` + email Pink Posts on each role change).

### Trade-offs / risks
- Self-promote/demote loops. Block self-changes.
- Without an audit table, traceability is weak. Consider a simple `RoleChangeLog` table.

### Effort: A = **0** dev (1-minute script). B = **Small** (~1.5h).

### Open question: which email is the target account?

---

## Issue 3 — "Schedule a Trip" → "Existing Installation" empty (V3)

### Likely root cause (to confirm)
`Installation` records are only created when an admin marks an order `status='completed'` (see `PUT /api/orders/[id]` line 165-176). A customer with pending/confirmed/scheduled orders **has no Installation** yet → the modal correctly reports "no active installations" but it's misleading because the user clearly has an order in flight.

### Recommendation
Investigate the modal (`components/dashboard/installation-modals/ScheduleTripModal.tsx`) — confirm the assumption above. Then:
- **Option A (preferred):** Broaden the "Existing Installation" tab to also surface **active orders that don't yet have an Installation** (`status ∈ {confirmed, scheduled, in_progress}` and no completed installation). Show them in the same picker labeled with the property address. This matches the user mental model ("I placed an order — show it to me here").
- **Option B (smaller):** Rename the tab to "Existing Property" and update copy + empty-state to point users to "Other Address" with one click when no installations exist.
- **Option C (smallest):** Just fix copy + UX flow — keep "Existing Installation" precise but auto-switch to "Other Address" when empty.

Recommend **Option A** — matches Ryan's example and reduces support load.

### Trade-offs / risks
- Need to be careful that a trip request on an in-flight order is meaningful (the install hasn't happened yet — what does "schedule a removal" mean for it?). May want to limit the new option to only `service`/`repair`/`replacement` types, not `removal`. Or block `removal` with a friendlier message.

### Effort: **Small** (~2h: 30 min investigation, 1h impl, 30 min test).

---

## Issue 4 — Admin: assign inventory to a team member at add-time, and subdivide inventory by member (V1+V2)

### Recommendation
Two complementary additions to the **admin customer detail page** (`app/admin/customers/[id]/page.tsx`):

**(a) Add-time assignment.** When the customer is a `team_admin` and `data.team` is present, the Add Inventory modal (each of Signs/Riders/Lockboxes/Brochure) gains an **"Assign to agent"** dropdown populated from `data.team.members`, with "Unassigned" as the default. On POST to `/api/admin/customers/[id]/inventory`, include `assigned_to_member_id`. Extend the endpoint to accept and write it (the column already exists per the Teams epic).

**(b) Subdivide inventory by member.** Above the inventory cards (for team_admin customers only), add a **"Filter by agent"** selector (mirrors the team_admin-facing inventory page we built in Phase 2). Selecting an agent filters all inventory cards to items where `assignedToMemberId = <id>`. Each item also gets a small **"Assign"** dropdown to re-assign (reuse PATCH `/api/teams/inventory` — but expose an admin equivalent that bypasses the team-membership check since admins can assign across any team).

### Trade-offs / risks
- Low. Additive. No schema change (column exists).
- (b) adds noise to non-team_admin customer profiles — gate strictly on `data.team` presence.

### Effort: (a) **Small** ~2h · (b) **Small** ~1.5h.

---

## Issue 5 — Simultaneous orders / cart concurrency under one admin (E1 + E1')

This issue has **two distinct parts** that must both be addressed for "simultaneous orders don't conflict":

### Part A — Cart isolation between humans
Today the cart is `localStorage` (per browser). Two humans on **different machines** logged into the same account have **independent carts** today. Two humans/tabs on the **same machine** share one cart (and the `storage` event syncs in real-time). This is what would feel like "carts colliding."

**Two paths, depending on Ryan's preference:**

- **Path 1 (recommended, zero-build):** Embrace the Teams feature we already shipped. Each human at the brokerage gets their own `team_admin` login under the brokerage's Team. Inventory is shared (already supported via `teamId` + `canActOnBehalfOf`), but each login = independent browser session = independent cart. Audit trail per-person, no "shared password" hygiene risk. The "Add Member" admin UI we just built can spin up additional team_admin sub-accounts in seconds.
  - Cost: 0 dev hours; Ryan needs to be sold on it.
- **Path 2 (if Ryan insists on one shared login):** Move the cart server-side, keyed by NextAuth **session id** (not user id), so each browser session has its own cart. Persists across reloads, doesn't sync across sessions. Larger build (~6h: schema, route, refactor `useCart`).
- **Path 3 (smallest cart-only fix):** Switch `localStorage` → `sessionStorage` for the cart. Per-tab isolation, no server work. Downside: cart lost on tab close, which would frustrate brokers mid-batch.

**Recommendation: Path 1.** Falls out of architecture we already built; lowest risk; best long-term.

### Part B — Server-side inventory race
Independent of carts. Today two parallel orders (whether from one shared cart, two shared-login admins, or two separate users on the same team) can both reference the same `customerSignId` (no uniqueness check), both mark `inStorage: false`, and both succeed — physical inventory double-promised.

**Fix:** Make the inventory lock **atomic and conditional**. Inside the order-creation transaction, for each linked inventory id, do:

```ts
const r = await tx.customerSign.updateMany({
  where: { id, inStorage: true },          // only update if still in storage
  data:  { inStorage: false },
})
if (r.count === 0) throw new Error('inventory_already_claimed')
```

If any item is no longer claimable, **abort the transaction** and return a friendly error like *"This sign was just claimed by another order — please pick a different one."* The user re-loads inventory and re-submits. Apply the same to `customerRider`, `customerLockbox`, `customerBrochureBox`.

Apply to **both** `POST /api/orders` and `POST /api/orders/batch`. For batch, abort the whole batch (so we don't end up with a partial multi-order checkout).

### Trade-offs / risks
- Edge case: a customer with a fast double-click could now hit the error on their second submit instead of double-charging — that's the desired outcome. Make the error message clear and the cart restore the failed item.
- Slight latency increase in order POST (one extra updateMany per inventory id; negligible).

### Effort
- Path 1 (cart): **0 dev** + a 5-min conversation with Ryan.
- Path 2 (server cart) if needed: **Medium-large** (~6h).
- Inventory race fix: **Medium** (~3h incl. tests).

---

## Cross-cutting cleanups / open questions for Ryan

- **Q-A** Cancellation cutoff window — *"No customer self-cancel within 24h of scheduled install"* OK? Or always allowed?
- **Q-B** Refund policy v1 — full refund only, or proration (e.g. retain the $2.47 fuel surcharge or expedite fee)? Default proposal: **full refund**.
- **Q-C** Cart concurrency — willing to use the Teams sub-account model (each broker employee gets their own login)? Or hard requirement for one shared login?
- **Q-D** "Existing Installation" modal scope — also include in-flight orders (recommended), or keep precise and just rename / nudge to "Other Address"?
- **Q-E** Email/account to promote to admin — share with us.
- **Q-F** Role-change UI now (Track 2.B) or just the one-time script (Track 2.A)?

---

## Sequencing (proposed)

| # | Item | Why first | Effort |
|---|---|---|---|
| 1 | **2A** Promote that user to admin (1-line script) | Unblocks Ryan handing the account off | 1 min |
| 2 | **5B** Inventory race fix | Silent data corruption today; broadest safety | ~3h |
| 3 | **3** ScheduleTripModal "Existing Installation" fix | Real customer pain Ryan saw an agent hit | ~2h |
| 4 | **4a** Admin inventory: assign at add-time | Direct video feedback; small | ~2h |
| 5 | **1** Customer cancel + refund | Real money path; must be careful, isolate from rest | ~5h |
| 6 | **4b** Admin inventory: filter-by-agent subdivision | Polish on #4a | ~1.5h |
| 7 | **5A** Cart concurrency — depends on Ryan's answer to Q-C | Probably zero-build (Path 1) | 0 (or ~6h Path 2) |
| 8 | **2B** Admin UI for role change | Nice-to-have | ~1.5h |

**Total dev:** ~14.5h if Ryan accepts Path 1; ~20.5h if we build server-side cart.

---

## Out of scope (intentionally)
- The **$18 6-month post-rental** auto-charge (separate conversation; flagged earlier — terms page promises it but no code does it).
- Sub-account creation UX polish (Path 1 enables it via existing "Add Member" but maybe Ryan wants a dedicated invite flow).
