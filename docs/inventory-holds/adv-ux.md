I have enough grounding. Returning the critique now.

---

# UX & Operations Critique — Soft-Hold Plan (ryan-feedback-2026-06-02)

The plan is technically sound; the failure modes are almost all in the human-facing seams. Findings prioritized **P0 (must fix before merge) → P3 (nice-to-have)**.

---

## P0 — Will cause real user pain or support escalations on day one

### P0-1. "Expired hold mid-cart" UX is explicitly punted, but the cart UI today shows no countdown at all
The plan acknowledges this in §4 ("no real-time countdown, no toast, no auto-redirect"). For a team_admin building 8 orders over a 20-minute span — the exact persona this feature is for — this is the *primary* failure mode and the plan ships it broken.

**Concrete scenario:** Alice (team_admin) builds 6 cart items over 18 minutes. She clicks "Checkout All." Items 1–3 silently 409 because their holds expired 3 minutes ago (heartbeat didn't fire because she had a different tab focused and `setInterval` got throttled). She sees a "conflict" toast with no clear path forward. She doesn't know which items conflicted, which conflicts are "my own expired hold" vs "someone else grabbed it", or whether her card was charged.

**Recommendation (must do, ~45m extra):**
- The `bumpHolds` response already returns per-cart-item `{ extended: boolean }`. When `extended: false`, the cart row turns yellow and shows **"Hold released — re-pick before checkout"** with a button that re-runs `acquireHold` for that row's ids. If acquire succeeds, restore green. If 409, turn red and disable checkout for that row only.
- Background-tab throttling kills `setInterval` after a few minutes in modern browsers. The 5-minute heartbeat against a 15-minute TTL gives only two retries before TTL expires — too tight. Either bump to a 30-minute TTL with a 5-minute heartbeat, **or** run the heartbeat on a Service Worker / `BroadcastChannel`-coordinated leader tab. Cheapest fix: also call `bumpHolds` on `visibilitychange → visible` and on the cart page mount.
- Distinguish in the 409 payload between `reason: 'expired_self'` (your hold ran out, you can retry) and `reason: 'held_by_other'` (lost the race, you must re-pick a different item). The cart UI must render these two cases differently.

### P0-2. `assignedToMemberId` interaction is completely unaddressed
The plan never mentions `assignedToMemberId`. This is a correctness *and* UX gap. Today an item assigned to Agent Bob can be selected in any order — but per `app/api/inventory/route.ts` lines 30–45, the *visibility* filter when `member_id` is in the query string only shows that agent's assigned items. So:

- **Scenario A:** Alice opens the cart with `member_id=Bob`, picks Sign #42 (assigned to Bob). Hold acquired for Alice. Carol (another team_admin in the same agency? or Alice in another tab with `member_id=Charlie`) loads inventory for Charlie — Sign #42 is filtered out for *visibility* reasons (it's Bob's), but the new hold logic in `GET /api/inventory` (#9) doesn't know that — it returns `held_by_other` info but Carol can't see the item to begin with. Confusing diagnostic state.
- **Scenario B:** Alice puts Bob's Sign #42 in her cart. Before checkout, Alice reassigns Sign #42 from Bob to Dan via `PATCH /api/teams/inventory`. The PATCH at lines 124 of `app/api/teams/inventory/route.ts` succeeds blindly. The hold is still Alice's, the item now shows assigned to Dan, the cart still has it tagged as Bob's order. Who gets billed?
- **Scenario C:** Sign #42 is unassigned. Anyone on the team can hold it. Two team_admins racing for unassigned pool items is the actual race the spec calls out — confirmed valid.

**Recommendations (must do before merge):**
1. **Block re-assignment of held items.** In `PATCH /api/teams/inventory`, refuse with 409 if the item has an active `heldByHoldId`. Surface "Item is in {holder name}'s cart — release the hold or wait until {heldUntil}."
2. **Document the visibility rule explicitly:** unassigned items are pool-wide and can be held by any authorized actor; assigned items can be held by the assignee's owning team_admin acting `on_behalf_of=customer` or with `member_id=<assignee>`. The plan's `acquireHold` schema must validate this — currently `acquireHold` takes only `itemType, itemId, ownerUserId` and trusts the caller. Add an authorization check that mirrors the visibility check in `GET /api/inventory`.
3. **Audit metadata must include `assignedToMemberId` snapshot** at hold creation time so support can answer "whose pocket does this billing leak from?" without joining against the live row (which may have been reassigned).

### P0-3. Support has no UI to diagnose a "stuck" hold
The plan writes audit rows but provides no admin surface. A real support ticket on day one will be: *"I can't add Sign X to my cart — it says it's held but I'm not holding it."* Support's only recourse with this plan is opening a Railway psql console.

**Recommendation (must do, ~30m):** Add a minimal admin page `app/admin/holds/page.tsx` (or even just a JSON-returning route `GET /api/admin/holds`) that lists live holds with `{ itemType, itemId, itemDescription, ownerEmail, actorEmail, onBehalfOfEmail, cartSessionId, expiresAt, ageSeconds }`. Add a `DELETE /api/admin/holds/[id]` that force-releases with an `InventoryHoldOverridden` audit row (constant already in the plan but never wired). This is the single thing that prevents this feature from generating support pain.

### P0-4. `/api/orders/route.ts` "critical bonus fix" is a scope-creep landmine
Step #14 wraps the single-order path in a `$transaction`. That route is the customer-direct checkout path and currently calls Stripe *outside* the transaction; pulling it inside would either (a) hold a DB transaction open across a Stripe network call (bad — connection pool exhaustion at scale), or (b) require a careful "create order in tx, commit, then Stripe, then a second tx to flip inventory" dance that changes the failure semantics. The 30-min budget is fantasy.

**Recommendation:** Either explicitly carve this out (single-order path keeps blind flip + the existing webhook restore is the safety net), OR allocate a separate PR for it. Don't ship it conflated with the hold feature.

---

## P1 — Will cause confused users or alerts within first week

### P1-1. No metrics or observability surface
The plan writes audit rows but defines no SLOs, dashboards, or alerts. Within a week you will get a "is the hold thing working?" question with no answer.

**Recommendation:** Define these from day one, even as a single JSON endpoint or a daily summary email:
- **Counter:** holds created / released-explicit / expired-by-cron / expired-by-lazy-sweep / consumed / conflicted (409)
- **Gauge:** live hold count, max hold age, count of holds where `expires_at < now() - 5min` (sweeper lag indicator)
- **Ratio:** `conflicted_409 / acquired_total` — a sustained spike means real contention or a bug
- **Ratio:** `lazy_sweep_count / cron_sweep_count` — if lazy sweep dominates, cron is dead and nobody noticed
- **Alert:** any `InventoryHoldConflict` audit row at checkout (not pick time) — that's actual lost-race-at-payment, which should be vanishingly rare. Page on it.

### P1-2. Audit log volume is going to explode
Back-of-envelope: a team_admin building 8 carts × 4 items/cart × (1 create + 1 bump every 5min × 4 bumps + 1 consume) = ~192 audit rows per checkout session. If `InventoryHoldExtended` is written on every bump (the plan implies it), one active team_admin in a 20-min session generates more audit volume than every other action in the system combined.

**Recommendations:**
- **Do not audit `InventoryHoldExtended` at all** — it's noise. Or audit only the *first* extension per hold, or only extensions that crossed a midnight UTC boundary. The TTL on the hold row itself is the source of truth; audit is for state transitions, not heartbeats.
- Tag hold-related audit rows with a `correlationId` (= `cartSessionId` or `holdId`) so support can pull "everything that happened to this cart" in one query without `LIKE` scanning.
- Plan a 90-day retention window for `action LIKE 'inventory_hold_%'` separate from security-relevant audit actions.

### P1-3. The cron sweeper has no failure path
`vercel.json` / Railway cron runs every 60s with `CRON_SECRET`. What happens if:
- The cron 500s for 6 hours (Railway outage)? → Lazy sweep covers correctness. Good. But there's no alert that cron stopped.
- The cron auths but the route throws midway? → Half-deleted state across `Customer*` updateMany and `inventory_holds` DELETE.
- Two cron invocations overlap (Railway sometimes double-fires after a deploy)? → Both try the same updateMany; either both succeed idempotently (good) or one deadlocks (need to verify).

**Recommendations:**
- Wrap the sweeper's body in a Postgres advisory lock (`pg_try_advisory_lock(hashtext('inventory-hold-sweeper'))`) so concurrent invocations no-op cleanly.
- Have the sweeper write a heartbeat row to a `system_heartbeats` table (or just an audit row with `action: 'cron.inventory_hold_sweeper.tick'` at INFO level, once per N runs). Alert if no heartbeat in 10 minutes.
- The sweeper response payload should return `{ swept: n, durationMs, oldestExpiredAgeSec }` so an external Pingdom / Better Uptime check has something meaningful to assert on.

### P1-4. No mid-cart conflict for the user who *lost* an item to admin override
If support uses the P0-3 force-release tool to clear Alice's stuck hold, Alice's cart still shows the item as held-by-her, with a green countdown, until she clicks checkout and gets a 409. She has no way to know her hold was admin-revoked.

**Recommendation:** When a force-release happens, set `releasedAt` AND set a sentinel field (e.g. `releaseReason: 'admin_override'`). The next `bumpHolds` for that cartItemId returns `{ extended: false, reason: 'admin_override' }` and the row turns red with a tooltip. Or even just write `InventoryHoldOverridden` audit row with `metadata.notifyOwner = true` and have a cron poke a websocket / email — but that's overkill for v1.

---

## P2 — Quality-of-life and longer-tail risks

### P2-1. The "two tabs, same admin, same sign" 409 is genuinely confusing
The plan accepts this as out-of-scope, but the error message at the picker level today will just be "Item unavailable" or similar. A team_admin's mental model is "this is my inventory, why can't I add it twice?"

**Recommendation:** When the 409's `currentHolder.ownerUserId === me.id` AND `cartSessionId === my-current-session`, return a specific error code (`hold_owned_by_self`) and have the picker render: *"You already have this item in your cart (added {ago})."* with a link to that cart row. Costs ~10 minutes, prevents 50% of "bug?" reports.

### P2-2. `cartSessionId` from localStorage is unstable across browsers and incognito
A team_admin who builds half a cart on their laptop and finishes on their phone will have two separate `cartSessionId`s — the laptop's holds will block the phone session. The plan's §4 says server `Cart` table fixes this later, but mention it explicitly to support so the first ticket isn't a surprise.

**Recommendation:** Document this in a runbook entry: *"If a customer reports being blocked by their own holds across devices, run `SELECT * FROM inventory_holds WHERE owner_user_id = ?` and release the orphaned session's holds."* Better: include `User-Agent` snapshot in the hold's audit metadata so support can spot the cross-device case immediately.

### P2-3. Brochure-box scope cut creates an inconsistency
The plan keeps brochure boxes quantity-aggregated and un-held. Result: a team_admin can put 10 brochure boxes in 3 different carts; the *most recent* checkout wins, the others fail silently or oversell. Brochure boxes are physical objects too — same race exists.

**Recommendation:** Either (a) hold them too with a quantity-aware hold (`acquireHold` takes a count, hold row stores `quantity` on a polymorphic record), or (b) explicitly document the oversell behavior and add a check in `/api/orders/batch` that the sum of all in-flight orders for `userId X` doesn't exceed `count(CustomerBrochureBox WHERE userId=X AND inStorage=true)`. Option (b) is ~20 minutes and closes the only remaining race.

### P2-4. The 15-minute TTL is asserted without justification
Why 15? Average wizard completion time? P95? The team_admin persona explicitly fills out multiple orders.

**Recommendation:** Instrument the existing wizard with a `wizardCompletedSeconds` metric in the order audit metadata for two weeks before this PR ships, then pick the TTL as P90 of that distribution + a safety margin. If you can't wait, make it 30 minutes initially and tune down — false-positive expirations (Alice's hold dies while she's still on the page) are *much* worse for the user than a slightly stale hold blocking a stranger.

### P2-5. Kill switch is undertested
The plan describes the env-var kill switch in detail but the test checklist only has one line for it. The kill switch is the most-important-to-actually-work thing in this whole PR.

**Recommendation:** Add tests for: (a) flip switch with live holds in the DB → existing carts complete checkout via the blind-flip path without 409ing, (b) flip switch back on → new holds resume cleanly, (c) flip switch with the sweeper mid-run → sweeper aborts safely.

---

## P3 — Cosmetic / future-considerations

- **P3-1.** `HoldItemType` enum values use `snake_case`; the rest of the schema uses `camelCase` for enums (check `OrderStatus`, etc.). Match existing convention.
- **P3-2.** The plan creates `actorUserId` and `ownerUserId` as separate columns but never explains when they diverge except in admin-on-behalf-of. Add a CHECK constraint or runtime assertion that `actorUserId === ownerUserId OR onBehalfOfUserId IS NOT NULL`.
- **P3-3.** `consumedByOrderId` is `SetNull` on order delete — if an order is hard-deleted later (currently rare but possible from admin tools), the audit trail loses the linkage. Consider `Restrict` or store the order id as a denormalized string field too.
- **P3-4.** No e2e/Playwright test in the checklist — all 20 test cases are manual. Given the existing `.playwright-mcp/` directory in the repo, write at least the two-tab race as an automated test before merge.

---

## Suggested re-prioritization of the implementation plan

If 6.5h is the real budget, cut these to make room for P0 fixes:

| Cut / defer | Saved | Why |
|---|---|---|
| Step #14 (single-order `/api/orders/route.ts` tx wrap) | 30m | Risky scope creep per P0-4, do separately |
| Step #19 wizard pickers (already deferred) | 0 | already cut |
| Audit on `InventoryHoldExtended` | ~10m | noise per P1-2 |

Add:
- **Admin holds page** (P0-3) — 30m
- **Mid-cart expired-hold UI** (P0-1 partial) — 45m
- **Reassign-block check** (P0-2) — 20m
- **Hold-acquire authorization mirroring inventory visibility** (P0-2) — 15m
- **Cron advisory lock + heartbeat** (P1-3) — 20m

Net: roughly even, but the feature actually ships usable instead of generating tickets the day after merge.

---

Relevant files for the recommended follow-ups:
- `C:\Users\tanne\PPI\app\api\inventory\route.ts` (P0-2 visibility mirror)
- `C:\Users\tanne\PPI\app\api\teams\inventory\route.ts` line 124 (P0-2 reassign block)
- `C:\Users\tanne\PPI\lib\audit.ts` line 69 (P1-2 selective auditing)
- `C:\Users\tanne\PPI\lib\cart.ts` (P0-1 expiry UX integration point)
- `C:\Users\tanne\PPI\prisma\schema.prisma` lines 261–324 (Customer* columns to add)