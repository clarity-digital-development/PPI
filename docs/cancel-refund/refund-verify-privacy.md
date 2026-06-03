I have enough. The TodoWrite reminder isn't applicable for this audit-style task. Producing findings now.

---

# Privacy/Leakage Audit Findings

## F1 — `placedByUserId` recipient resolution trusts the role implicitly [MEDIUM]
**File:** `lib/orders/refund-recipient.ts:39-51`
The branch returns `role: 'broker'` for whoever the placer is, but never verifies `placer.role === 'team_admin'`. If a `team_admin` who placed an order is later demoted to `customer` (or moved off the team), they still receive a refund email for an order owned by an agent on a team they no longer administer. They also get full PII for that agent's order (order#, full property address).
**Leaked:** Order#, property street address + city/state/zip, refund amount, optional customer reason.
**Fix:** When loading the placer, also `select role, teamId` and assert `role === 'team_admin' && teamId === order.user.teamId`. If the assertion fails, fall through to tier (3) — lookup the *current* team_admin for `order.user.teamId`.

## F2 — Agent vs broker email: case (1) is correct, but no fallback when the team has no admin [LOW]
**File:** `lib/orders/refund-recipient.ts:63-76` then `78-83`
For an agent on a team where no `team_admin` exists (e.g. admin deleted, team being wound down), the code silently falls through to tier (4) and emails the *agent directly*. That contradicts the locked decision ("brokers get the email, not the agents"). Worse, the agent only learns *implicitly* that their broker is gone.
**Leaked:** Same fields, delivered to the wrong principal class.
**Fix:** If `order.user.teamId` is set and no team_admin found, audit `OrderRefundFail{stage:'recipient'}` and skip the email, surfacing an internal ticket instead.

## F3 — `/api/orders/[id]` GET broadens to `placedByUserId` — stale visibility for demoted brokers [MEDIUM]
**File:** `app/api/orders/[id]/route.ts:23-29`
The OR clause `{ placedByUserId: user.id }` has no role check. A user who was once `team_admin` and placed an order, then was demoted to `customer` (or moved to a different team), can still GET that order indefinitely. They will see the agent's name, property address, items, totals, refund metadata.
**Leaked:** Full order detail (PII + financial) for orders on a team the requester no longer belongs to.
**Severity:** Medium — requires role change to exploit, but no time bound.
**Fix:** Either (a) gate the `placedByUserId` clause behind `user.role === 'team_admin' && user.teamId === order.user.teamId` at query time (compose with two findFirst calls or post-filter), or (b) clear/null `placedByUserId` on role demotion in the user-update path.

## F4 — Order-ID enumeration via 404 vs 403 timing/status oracle [LOW]
**File:** `app/api/orders/[id]/cancel/route.ts:42-48` and `app/api/orders/[id]/route.ts` (GET uses `findFirst` with composite where, so it returns 404 in both cases — that path is fine). The cancel route, however, does `findUnique` first then ownership check — returning 404 for missing IDs and 403 for foreign IDs. An attacker can enumerate valid order IDs (cuid/uuid, but the universe is finite per tenant). Order IDs are cuids (~25 chars, base36) — practically unguessable, so this is **mostly defense-in-depth**, not an active leak.
**Leaked:** Existence of an order ID. With cuid IDs the search space is too large to brute force.
**Severity:** Low.
**Fix:** Collapse to a single response — return 404 for both missing-and-foreign in `cancel/route.ts:42-48`. The admin refund route has the same shape (`route.ts:38-41`) but is admin-gated, so not exploitable.

## F5 — HTML escape coverage is good; no URL-context injection [PASS]
**File:** `lib/email.ts:471-481`
`recipientName`, `orderNumber`, `propertyAddress`, `formattedDate`, `refundReason` are all escaped. The only `<a href>` is the static `mailto:support@pinkposts.com` — no user/order data is interpolated into href, mailto, or `src` attributes. **No finding.**

## F6 — Audit metadata: customer free-text reason is NOT stored in audit rows [PASS]
**File:** `lib/refunds.ts:131,148`
`OrderRefundCreate` metadata = `{refundId, amountCents, reason: options.reason /* enum */, auto}`. `OrderCancel` metadata = `{reason: options.reason, refundId, refunded}`. `options.reason` is the enum (`'customer_cancel'|'admin_cancel'|'stripe_dashboard'`), not the user-typed `customerReason`. The free-text `customerReason` is persisted only on `Order.refundReason` (a typed column, not audit JSON). **No leak.**

Sub-note: the refund email *does* render `customerReason` as `refundReason` field, but the email goes to the broker who placed it / belongs to the team that placed it — so a broker may see their own agent's free-text reason. That's expected by design (they're the order's account-of-record), but worth flagging: an agent writing "my client thinks you're a scam" in the cancel reason will land in their broker's inbox. Consider stripping or omitting `refundReason` from broker-bound emails (resolveRefundRecipient.role === 'broker').

## F7 — Cross-tenant cancel via team_admin role [PASS]
**File:** `app/api/orders/[id]/cancel/route.ts:46`
Ownership check is strictly `order.userId === user.id || order.placedByUserId === user.id`. A team_admin on Team1 attempting to cancel an order owned by an agent on Team2 (where Team1 admin is neither owner nor placer) gets 403. **No leak.** Role is not used as an authorization shortcut here — good.

## F8 — Admin refund route role-check timing [LOW]
**File:** `app/api/admin/orders/[id]/refund/route.ts:17-23`
`getCurrentUser()` runs first, then role check, then `findUnique`. A non-admin will short-circuit at line 22 before the DB lookup. An admin will hit the DB and return 404 for missing. Timing differential between non-admin-403 (no DB) and admin-404 (DB roundtrip) is observable (~5-50ms) and lets an external attacker confirm admin status from an authenticated session — but they'd already know their own role from the dashboard. **Severity: negligible**, no practical exploit.
**Fix (optional):** Move `findUnique` ahead of role check if you want constant-time response. Not worth the perf cost.

---

## Summary table

| # | Severity | File:Line | Issue |
|---|---|---|---|
| F1 | MEDIUM | `lib/orders/refund-recipient.ts:39` | Placer assumed broker; demoted user still gets emails |
| F2 | LOW | `lib/orders/refund-recipient.ts:78` | Orphan-agent fallback emails agent against locked decision |
| F3 | MEDIUM | `app/api/orders/[id]/route.ts:28` | Stale `placedByUserId` grants indefinite order visibility |
| F4 | LOW | `app/api/orders/[id]/cancel/route.ts:42-48` | 404/403 distinction; defense-in-depth only (cuid IDs) |
| F5 | PASS | `lib/email.ts:471-481` | escapeHtml coverage complete; no URL-context injection |
| F6 | PASS | `lib/refunds.ts:131,148` | No raw customer free-text in audit metadata |
| F7 | PASS | `app/api/orders/[id]/cancel/route.ts:46` | Role not used as auth shortcut; cross-tenant blocked |
| F8 | INFO | `app/api/admin/orders/[id]/refund/route.ts:17-23` | Negligible admin-role timing oracle |

**Top fix priority:** F1 + F3 (both turn on user role/team mutation over time — fix together by either (a) adding a role+team assertion at recipient/query time, or (b) nulling `placedByUserId` and re-resolving on role/team change).