# Walkthrough & Verification — 6/2 through 6/4 ship

Everything shipped between 6/2 and 6/4 is listed below. Walk through the checklist; each item has the steps to test it and what you should see. Flag anything that doesn't match what's described. The doc is grouped by feature area and every step is a checkbox — tick as you go. Issues found by the code audit are called out in §6 at the bottom so you don't have to hunt for them.

---

## 1. Test credentials

| Login | Password | Role | What they see |
|---|---|---|---|
| `admin@pinkposts.com` | `admin123` | Platform admin | Full admin shell: `/admin/customers`, `/admin/orders`, `/admin/inventory`, `/admin/holds` (JSON only), audit log access, refund-any-order button. |
| `test@pinkposts.com` | `PinkPosts2026` | Team admin (Ryan's Test Team) | Customer-facing dashboard + Team Inventory + My Team. 3 agents on the team: Ashley, Marcus, Diana. Seeded inventory across all three. |
| `supportstaff@semonin.com` | (use prod password / SSO) | Team admin (Peggy Heckert Team, Semonin Realtors) | Same as test@, but real team. Owns Peggy's 3 signs (preserved `assignedToMemberId`). |
| `pheckert@semonin.com` | (use prod password / SSO) | Plain customer | Customer dashboard only. No team, no inventory. Demoted correctly. |

**Test cards:** Stripe test mode — `4242 4242 4242 4242`, any future expiry, any CVC, any zip.

---

## 2. Pre-flight checks

Do these in order before starting the verification sections. If any fail, stop and ping back — the rest of the walkthrough depends on them.

- [ ] **2.1** Log in as `test@pinkposts.com`. You land on the customer dashboard. Sidebar shows: Dashboard, Schedule a Trip, Place a New Order, Team Inventory, Cart, Order History, My Team, Account.
- [ ] **2.2** Click **Team Inventory** — page loads with three sections (Ashley / Marcus / Diana), each with seeded items. No 500, no empty page.
- [ ] **2.3** Log out, log in as `admin@pinkposts.com`. Sidebar shows the full admin nav (Customers, Orders, Installations, Inventory, Promos, etc.).
- [ ] **2.4** Visit `/admin/customers` — search "supportstaff" returns one row labeled **Team Admin**; search "pheckert" returns one row labeled **Customer**.
- [ ] **2.5** Visit `/admin/orders` — search "PPI-TEST" returns **0 results** (the 3 fake test orders have been deleted; revenue rollup is clean).

If 2.1–2.5 all pass, proceed.

---

## 3. Refund + Cancel

Covers: customer self-cancel, $250 double-confirm, admin force-refund, Stripe-dashboard reconciliation, idempotency, and the broker-email recipient rule.

### 3.1 Customer auto-refund under $250

- [ ] **3.1.1** Logged in as `test@pinkposts.com` → **Place a New Order** → choose agent Ashley.
- [ ] **3.1.2** Fill the wizard with a real address, pick one sign from storage, complete checkout with `4242 4242 4242 4242`. Total should be **under $250**.
- [ ] **3.1.3** Sidebar → **Order History** → open the new order.
- [ ] **3.1.4** Click **Cancel Order** (red, bottom-right of the action row).
- [ ] **3.1.5** In the modal, leave the reason field blank → click **Cancel Order**.

**What you should see:** modal closes, page reloads, a Cancelled banner appears, status flips to `cancelled`. Within ~30 seconds the "Refund processing" badge flips to "Refund processed". One refund email arrives at `test@pinkposts.com`.

**If you see** a $250 confirmation modal on a sub-$250 order, that's a bug (threshold logic).
**If you see** nothing happen after click, open DevTools → Network → look at `POST /api/orders/[id]/cancel`. 500 = server error; 409 with `requiresConfirmation` = threshold logic broken.

### 3.2 Customer double-confirm over $250

- [ ] **3.2.1** Same login → Place Order → Ashley → add **3+ signs** so the total is ≥ $250 → checkout.
- [ ] **3.2.2** Order History → open the new order → click **Cancel Order**.
- [ ] **3.2.3** First click should surface an amber **"Yes, Refund $XXX.XX"** confirmation modal.
- [ ] **3.2.4** Click the amber **"Yes, Refund $XXX.XX"** button.

**What you should see:** refund proceeds. Two-step confirmation enforced.

**If you see** the refund go through on the first click without the amber step, that's a bug.
**If you see** the amber modal but "Yes, Refund" does nothing, check Network — the POST should include `{ confirmed: true }`.

### 3.3 24-hour cutoff blocks cancel

- [ ] **3.3.1** In Prisma Studio (or via the admin tool) pick a recent paid order and set `scheduledDate` to today (Eastern), OR place a new order scheduled for tomorrow and verify within 24h.
- [ ] **3.3.2** Reload `/dashboard/orders/[id]` as the order owner.

**What you should see:** the **Cancel Order** button is hidden. If you POST directly via curl, server returns 409 "Cancellation window closed".

**Known low-severity caveat (§6.1):** the client-side `canCancel` helper still uses UTC midnight while the server uses Eastern midnight. Result: the button can appear ~4h after the true ET cutoff (or hide ~4h early). The server is authoritative so no money risk, just inconsistent UX. Document if you notice it; not ship-blocking.

For **Next-Available** orders (`scheduledDate = null`), Cancel should ALWAYS be visible until status changes.

### 3.4 Refund email goes to broker, not agent

- [ ] **3.4.1** Logged in as `test@pinkposts.com` (the broker).
- [ ] **3.4.2** Place Order **on behalf of Ashley** (the standard team-admin flow: pick Ashley at the agent gate, then walk through the wizard).
- [ ] **3.4.3** Complete checkout, then immediately cancel the order from Order History.

**What you should see:** the refund-confirmation email lands in `test@pinkposts.com`'s inbox (the broker / placer), **not** Ashley's. Verify in Resend dashboard.

**If you see** Ashley get the email instead, check that `order.placedByUserId` is set — the resolver prioritizes placer → team_admin via teamId → self → user fallback.

### 3.5 Admin force-refund any order

- [ ] **3.5.1** Logged in as `admin@pinkposts.com` → `/admin/orders` → pick any paid, non-cancelled order → open detail page.
- [ ] **3.5.2** Click **Refund Order** (red, top-right action bar).
- [ ] **3.5.3** Optionally type an internal reason → click **Refund $XXX.XX**.

**What you should see:** single-step modal (no $250 confirmation step for admin). Green banner: "Refund of $X.XX initiated. The broker will be notified once Stripe confirms." Yellow "Refund processing" badge appears immediately; flips to "Refunded" after the webhook lands (~10–30s).

The admin path has **no** 24h cutoff — should work even on past-scheduled orders.

**If you see** a 409 "Cancellation window closed" as admin, the UI hit the wrong route (admin should call `/api/admin/orders/[id]/refund`, not `/api/orders/[id]/cancel`).

### 3.6 Stripe-dashboard refund reconciles

- [ ] **3.6.1** In Stripe Dashboard (test mode) → find the PaymentIntent for a paid order → Refund → Full → confirm.
- [ ] **3.6.2** Wait ~10 seconds for the `charge.refunded` webhook to fire.
- [ ] **3.6.3** Refresh `/admin/orders/[id]` for that order.

**What you should see:** order shows `paymentStatus='refunded'`, `status='cancelled'`, `cancelReason='stripe_dashboard'`. Inventory holds released. Broker gets exactly one refund email.

**If you see** the status not flip, check `STRIPE_WEBHOOK_SECRET` and the Stripe CLI listener. Look for the `charge.refunded` event in Stripe Dashboard → Events.
**If you see** two emails arrive, the email-reservation conditional update failed — check the `refundEmailSentAt` column migration.

### 3.7 Idempotency — double-click cancel

- [ ] **3.7.1** Place a sub-$250 order, open it.
- [ ] **3.7.2** DevTools → Network → throttle to Slow 3G.
- [ ] **3.7.3** Click **Cancel Order** twice rapidly in the modal.

**What you should see:** first request wins the reservation; second gets 409 `ALREADY_REFUNDED`. Exactly **one** Stripe refund in the dashboard, **one** email, **one** `OrderRefundCreate` audit row.

**If you see** two refunds in Stripe Dashboard, that's catastrophic — the conditional `updateMany` failed.
Verify in DB: `SELECT refundInitiatedAt, refundId, refundedAt, refundEmailSentAt FROM Order WHERE id = '...'` — exactly one row, all timestamps populated once.

### 3.8 Customer-cancel + admin-refund race

- [ ] **3.8.1** As customer, click Cancel on a sub-$250 order.
- [ ] **3.8.2** Within 2 seconds — before the `charge.refunded` webhook lands — open the same order as admin in another tab and click **Refund Order**.

**What you should see:** the admin path returns 409 "Order has already been refunded". Belt-and-suspenders (the route checks `refundId`, and the underlying `updateMany` would fail anyway because `refundInitiatedAt` is already set).

**If you see** the admin successfully create a second Stripe refund, that's a bug — this is the exact scenario the reserve-before-Stripe pattern was built for.

---

## 4. Inventory Holds + Cart Edit

Covers: 15-min TTL, heartbeat, two-tab race, edit-cart-row, remove releases hold, expiry UX, batch checkout = single charge.

### 4.1 Reserve, walk away 10 min, come back

- [ ] **4.1.1** Log in as `test@pinkposts.com` (or `admin@pinkposts.com` if you want to test the on-behalf flow).
- [ ] **4.1.2** Top nav → **Place Order** → pick Ashley → fill wizard with a real address → on the Sign step, pick **From storage** and select a specific sign by description.
- [ ] **4.1.3** Continue to Review & Pay → click **Add to Cart**.
- [ ] **4.1.4** You land on `/dashboard/cart`. The row shows the property + agent + a `Reserved for 14:59` countdown badge.
- [ ] **4.1.5** Switch tabs / lock the laptop for **10 minutes**. Come back.

**What you should see:** the badge reads `~10:00` (the 4-min heartbeat fired on tab focus and re-bumped to 15:00, then ticked down). No red "expired" pill.

**If you see** a red `Reservation expired — remove & re-pick` instead, that's a bug — the heartbeat or `visibilitychange` listener regressed.

### 4.2 Same sign, two tabs (race condition)

- [ ] **4.2.1** Same login. Use Place Order to add one specific sign for Ashley to cart. Land on `/dashboard/cart`.
- [ ] **4.2.2** **Open a new tab** (Cmd/Ctrl-click) → Place Order again → same agent, same specific sign.
- [ ] **4.2.3** Click **Add to Cart** in tab 2.

**What you should see:** the wizard surfaces an inline error: **"One of these items is already in another cart. Please refresh the inventory list and re-pick."** The row is NOT added; cart still has only the tab-1 entry. No phantom hold from tab 2.

**If you see** both tabs land on `/dashboard/cart` with the same sign reserved twice, the partial unique index `inventory_holds_live_uniq` is missing or the SAVEPOINT path is broken — this is the only thing standing between us and double-allocation.

### 4.3 Edit a cart row, swap one sign for another

- [ ] **4.3.1** Add Sign-A for Ashley to cart, go to `/dashboard/cart`.
- [ ] **4.3.2** On the row, click the small **Edit** (pencil) link next to **Remove**.
- [ ] **4.3.3** You land back in the wizard. Header reads `Edit Cart Order — Ashley`. Wizard pre-filled with everything from step 1.
- [ ] **4.3.4** Navigate back to the inventory step, **deselect Sign-A**, select **Sign-B** instead.
- [ ] **4.3.5** Continue to Review & Pay → button now reads **Update cart item — $XXX.XX** (not "Add to Cart"). Click it.

**What you should see:** you return to `/dashboard/cart`. The original row is updated in place (same `addedAt`, same agent), now showing Sign-B's description. Row count is still **1** — no duplicate.

To verify hold swap server-side: visit `/admin/customers` → find Ashley → open her inventory. Sign-A should be back to **In Storage**; Sign-B should be **Reserved**. Or hit `GET /api/admin/holds` as admin@ to see only Sign-B's hold live.

**If you see** Sign-A still appears reserved after the edit, the release-stale step silently failed — check browser console for 4xx/5xx on the `DELETE /api/inventory/holds?id=…` call.

### 4.4 Remove a row releases the hold

- [ ] **4.4.1** With one row in cart, open `/api/admin/holds` in another tab as admin@ — note the hold id for that sign.
- [ ] **4.4.2** On `/dashboard/cart` click **Remove** on the row.
- [ ] **4.4.3** Refresh `/api/admin/holds`.

**What you should see:** the hold no longer appears in the live list (soft-released via `released_at`; the cron sweeper hard-deletes it within a minute or two). The sign on Ashley's inventory shows **In Storage** again, no `heldUntil`.

**If you see** the hold still listed 5+ minutes later, the DELETE route's owner-scope guard may be rejecting your request — check Network for a 403.

### 4.5 Expired-cart UX (16+ minutes)

- [ ] **4.5.1** Add a sign to cart, go to `/dashboard/cart`. Note the countdown.
- [ ] **4.5.2** DevTools → disable JavaScript (kills the heartbeat without removing the row).
- [ ] **4.5.3** Wait 16 minutes (TTL is 15, plus a slop minute for the sweeper).
- [ ] **4.5.4** Re-enable JS, refresh `/dashboard/cart`.

**What you should see:** row stays visible but its badge flips to red `Reservation expired — remove & re-pick`. Amber banner at the bottom: "Some reservations expired while your cart was open." The **Place N orders** button is **disabled**.

- [ ] **4.5.5** Click **Remove** on the expired row → re-add from the wizard. Checkout button re-enables.

**If you see** the checkout button stays enabled with a red row, the guard regressed (the server's batch route would still 409, so you're safe, but the UX is worse).

### 4.6 Two cart items → single Stripe charge

- [ ] **4.6.1** Use the wizard twice: add two orders to cart for two different agents (or the same agent, two properties). Estimated totals combined should be ~$300.
- [ ] **4.6.2** On `/dashboard/cart`: pick your saved card from the **Charge to** select.
- [ ] **4.6.3** Click **Place 2 orders — $300.00+**.

**What you should see:**
- Both row footers turn pink with `Placing order 1 of 2…` spinners, then both flip green to `Placed — PP-XXXXXX`.
- The cart empties.
- In **Stripe Dashboard → Payments**, exactly **one** PaymentIntent for $300+tax (NOT two).
- In `/admin/orders`, two distinct order rows, each carrying the **same** `paymentIntentId`.

**If you see** two separate Stripe charges, the batch route was bypassed (single-order POST `/api/orders` hit instead of `/api/orders/batch`) — that's a regression.
**If you see** the spinner finishes but the cart still has both items, `clearCart()` was skipped — refresh once and re-clear manually.

---

## 5. Admin features

Covers: role changes with safety rails, per-agent grouped inventory view, assign-at-add, bulk reassign, live-hold visibility, "Other" inventory quantity.

### 5.1 Confirm admin nav shell

- [ ] **5.1.1** Log in as `admin@pinkposts.com` / `admin123`.
- [ ] **5.1.2** Sidebar should show: Dashboard, Customers, Orders, Installations, Inventory, Promos, etc.

**If you see** customer-only nav (Dashboard / Schedule a Trip / My Inventory / Cart), you logged in as the wrong account.

### 5.2 supportstaff@semonin.com = Team Admin on Peggy Heckert Team

- [ ] **5.2.1** `/admin/customers` → search "supportstaff" → click the row.
- [ ] **5.2.2** Header shows **Support Staff** + **Team Admin** badge (blue).
- [ ] **5.2.3** "Team Members" card shows `Peggy Heckert Team (Semonin Realtors)` and lists Peggy.
- [ ] **5.2.4** Click **Edit Info** → Role dropdown is set to `Team Admin (brokerage)`.

**If badge says "Admin" (purple) or role is "Customer"**: demotion didn't take.

### 5.3 pheckert@semonin.com = plain customer with no inventory

- [ ] **5.3.1** `/admin/customers` → search "pheckert" → click the row.
- [ ] **5.3.2** No role badge in header (plain customer). No "Team Members" card. Inventory cards all empty.

**If team shows "Peggy Heckert Team" or any inventory rows exist**: demotion left orphan data.

### 5.4 Add a sign pre-assigned to Ashley

- [ ] **5.4.1** `/admin/customers` → search `test@pinkposts.com` → click the row.
- [ ] **5.4.2** You land in the **grouped view** (per-agent collapsible sections, not the 2-column grid). At the top: an Unassigned section + a section for each team member (Ashley / Marcus / Diana).
- [ ] **5.4.3** Click the **Add inventory: Sign** button near the top.
- [ ] **5.4.4** Modal: description "Ryan audit test sign", Quantity 1, **Assign to agent → Ashley**. Click **Add**.
- [ ] **5.4.5** Ashley's accordion badge count goes up by 1. Expand → see "Ryan audit test sign" under Signs.

**If the new sign lands under Unassigned instead**: `assigned_to_member_id` not being forwarded.
**If you see no "Assign to agent" dropdown**: the team didn't load — refresh.

**Audit note (§6.2):** the assign-at-add path does NOT write an `inventory.assign` audit row. The constant is defined but never invoked. Bulk-reassign (5.6) IS audited. Functional but unaudited — flag if you want it logged.

### 5.5 Per-agent collapsible sections render correctly

- [ ] **5.5.1** Same page. Each agent (Ashley, Marcus, Diana) has its own card with:
  - Title (member name) + sublabel (email) + total-count badge
  - Summary like "3 signs · 2 riders"
  - Expand → Signs / Riders / Lockboxes / Brochure Boxes sub-lists with checkboxes
- [ ] **5.5.2** "Unassigned (team pool — not yet assigned to any agent)" section defaults to open.
- [ ] **5.5.3** "Other" rendered as a separate, non-grouped card above (other items have no agent assignment).

**If you see** two side-by-side "Signs in Storage" / "Riders in Storage" cards instead of grouped accordions, `useGroupedView` evaluated false — customer has no team members.

### 5.6 Sticky bulk-reassign across multiple agents

- [ ] **5.6.1** Expand Ashley → check 1 sign. Expand Marcus → check 1 rider. Expand Unassigned → check 1 lockbox.
- [ ] **5.6.2** A **sticky pink-bordered bar** appears pinned to the bottom center: "3 items selected · Reassign to: [dropdown] · Apply · Clear".
- [ ] **5.6.3** Dropdown → Marcus → **Apply**.
- [ ] **5.6.4** Bar disappears, page refreshes. All 3 items now inside Marcus's accordion.

**If you see** "Failed to reassign items": check Network tab — likely a 400 ("Target agent not found on this team") meaning Marcus's member id was stale.

### 5.7 Bulk-reassign refuses items in a live cart

- [ ] **5.7.1** Open a second tab as `test@pinkposts.com`. Start Place Order, get to the sign-selection step, add 1 sign to cart — that creates a live hold.
- [ ] **5.7.2** Back in the admin tab on the customer detail page, find that specific sign, check it, choose any reassign target, click **Apply**.

**What you should see:** alert: **"One or more selected items are in an active cart. Release the hold first via Admin → Inventory Holds, then try again."** Network response: 409 with `code: "items_held"`.

**Heads-up (§6.3):** there is **no admin UI page at `/admin/holds`** — only the JSON endpoint. To release the hold manually:
- Browser → `GET /api/admin/holds` (raw JSON) → grab the matching hold `id`
- REST client → `DELETE /api/admin/holds/<id>` (optional body `{"reason":"..."}`)

After release, retry the reassign — should succeed.

**If the reassign succeeds anyway** while the cart hold is live, that's a regression in the pre-check.

### 5.8 Add "Other" inventory with quantity 5

- [ ] **5.8.1** Same customer detail page. In the "Other" card, click **+ Add**.
- [ ] **5.8.2** Modal title: "Add Other Item". Description: "Yard flag stake", Quantity: **5**.
- [ ] **5.8.3** Notice there is **no "Assign to agent" dropdown** for Other (correct — no agent column on that table).
- [ ] **5.8.4** Click **Add**.
- [ ] **5.8.5** Other card shows "Yard flag stake ×5" on a single grouped row.
- [ ] **5.8.6** Hover the trash icon → tooltip "Removes one of these items". Click → count drops to ×4.

**If only one item appears or you see ×1**: the `createMany` loop is broken.

### 5.9 Live holds via API

- [ ] **5.9.1** With the test team_admin still holding a cart item from 5.7 (or add a fresh one).
- [ ] **5.9.2** Visit `https://<host>/api/admin/holds` directly in the browser as admin.
- [ ] **5.9.3** Response JSON includes: `{holds: [{id, itemType, itemId, itemDescription, ownerEmail, actorEmail, cartSessionId, cartItemId, expiresAt, ageSeconds, ...}]}`.

**If 401/403**: not logged in as platform admin.
**If empty `holds: []` when a cart item exists**: the hold wasn't written (cart-add path bug, not an admin-feature regression).

### 5.10 Role-change safety rails

- [ ] **5.10.1** Open the admin's own customer detail (`/admin/customers/<your-own-id>`) → **Edit Info** → try to change Role → Save.
  - Expected: alert "Cannot change your own role" (400 from server).
- [ ] **5.10.2** Open any other admin user → Edit Info → try to demote.
  - If they're the last other admin: expect "Cannot demote the last remaining admin. Promote another user to admin first."
- [ ] **5.10.3** Any successful role change writes to `audit_log` with action `user.role_change` and `{from, to, email}` metadata.

---

## 6. Schedule cutoff (Megan's 10pm bug) + UX polish

Covers: 4pm ET cutoff on every write path, searchable agent picker, $18 rental disclaimer, Schedule-a-Trip dropdown fix.

### 6.1 Confirm 4pm gate (most direct repro)

- [ ] **6.1.1** Sign in as `test@pinkposts.com`. **After 4pm ET**, open DevTools → Console.
- [ ] **6.1.2** Paste:
  ```js
  fetch('/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
    property_type:'residential', property_address:'1 Test St', property_city:'Louisville', property_zip:'40202',
    items:[{item_type:'sign',description:'test',quantity:1,unit_price:30,total_price:30}],
    is_expedited:true, payment_method_id:'pm_xxx'
  })}).then(r=>r.json()).then(console.log)
  ```

**What you should see:** `400 { error: "Same-day service is unavailable after 4pm Eastern...", code: "expedite_unavailable" }`.

**If you see** a 200 / successful order, that's the regression.

### 6.2 Past-date with expedited true (the harder bypass)

- [ ] **6.2.1** After 4pm ET — same console, body with `is_expedited:true` AND `requested_date:'2026-06-04'` (today) → expect `400 expedite_unavailable`.
- [ ] **6.2.2** Before 4pm ET — same body → expect 200 (legitimate same-day).
- [ ] **6.2.3** Any time — `is_expedited:true` + `requested_date:'2026-06-01'` (past date) → expect `400` regardless.

Pre-fix, scenario 6.2.3 slipped through and persisted a past `scheduledDate`. The adversarial fix gates both constraints together.

### 6.3 Megan's exact wizard scenario

- [ ] **6.3.1** Sign in, click **Place a New Order** **at 10pm ET**.
- [ ] **6.3.2** On the Schedule step, the "Same Day (Expedited)" option should be hidden/disabled. The date picker's earliest selectable date should be **day-after-tomorrow** (past 4pm pushes +2).
- [ ] **6.3.3** Pick that date, complete the wizard.
- [ ] **6.3.4** DevTools → edit the JSON body before submit (replace `requested_date` with today's date). Submit.

**What you should see:** `400 before_cutoff` with message "Earliest available install date is YYYY-MM-DD...".

**If you see** the order go through with today's date, that's the bug.

### 6.4 Sunday closed

- [ ] **6.4.1** Pick the next Sunday in the wizard's date picker (input's `min` doesn't filter weekdays, just minimum date). Submit.

**What you should see:** `400 sunday_closed`.

### 6.5 Admin override (support tool)

- [ ] **6.5.1** Sign in as `admin@pinkposts.com`. Open any order's admin detail page.
- [ ] **6.5.2** Try to PATCH a date past the cutoff via DevTools without override:
  ```js
  fetch('/api/admin/orders/<id>', {method:'PUT', body: JSON.stringify({scheduled_date:'2026-06-01'})})
  ```
  Expected: `400 before_cutoff`.
- [ ] **6.5.3** Retry with `override_schedule:true` in the body. Expected: 200 + date updated.

This is the escape hatch for support reschedules.

**Note (§6.4):** the override path is NOT currently audit-logged. Low risk (admin-only behind role gate), but if you want a paper trail of overrides, that's where to add it.

### 6.6 Cancel window in ET (not UTC)

- [ ] **6.6.1** Place an order today scheduled for tomorrow.
- [ ] **6.6.2** Just before midnight UTC (~8pm ET, well within the 24h-before-install window), call cancel.

**What you should see:** 200 success. Pre-fix this returned 409 "window closed" because UTC midnight rolled the cutoff forward ~4 hours.

### 6.7 Searchable agent input on Team Inventory

- [ ] **6.7.1** Sign in as `test@pinkposts.com` (team_admin with multiple members).
- [ ] **6.7.2** Dashboard → **Team Inventory**.
- [ ] **6.7.3** Top "Filter by agent" card: click the dropdown → search box auto-focuses → type a few letters → list filters in real time. ArrowDown/Up navigate, Enter selects, Escape closes.
- [ ] **6.7.4** On any inventory row, the right-side "Assign to" dropdown is the same searchable component. Open it, search, click — assignment saves silently.
- [ ] **6.7.5** Agent name in the row is a plain truncated `<span>` — no colored pill/Badge per row. Long names ellipsize on one line.

**If you see** a native browser `<select>` instead of the search popup → SearchableSelect import lost.
**If you see** clicking outside doesn't close → click-outside listener broke.

### 6.8 Search-as-you-type on Place Order agent picker

- [ ] **6.8.1** As team_admin, click **Place a New Order**. The agent-picker gate appears.
- [ ] **6.8.2** A search input sits above the agent cards with placeholder "Search agents by name or email…".
- [ ] **6.8.3** Type — cards filter on every keystroke.
- [ ] **6.8.4** "X of Y agents" counter appears next to the input when filtering.
- [ ] **6.8.5** Press Enter with one or more matches — first match is auto-selected and the wizard loads.
- [ ] **6.8.6** Empty state when no matches: "No agents match 'foo'" with a Clear button.

### 6.9 Removed redundant agent tag at checkout

- [ ] **6.9.1** Place-order wizard → fill through to Review & Pay.
- [ ] **6.9.2** Order Summary block shows: Property / Requested Date / Line Items / Promo / Totals. **No** "agent who sold this property" pill/tag.

The `placed_for_agent_name` is still captured upstream and sent to the server but no longer re-rendered at review (it was visually redundant with the agent gate banner).

**If you see** a chip or "Agent: Ashley Brown" label inside the Order Summary box, that's a regression.

### 6.10 $18 rental terms disclaimer

- [ ] **6.10.1** Open `/terms` (footer link or direct).
- [ ] **6.10.2** Scroll to **Post Rental Terms** → second paragraph reads:
  > **Effective June 10, 2026.** Orders placed before this date are not subject to the extended rental fee until that date.

**If the date reads anything other than "June 10, 2026" or the bold wrapping is missing**, that's a bug.

### 6.11 Schedule a Trip fix (empty dropdown)

- [ ] **6.11.1** Sign in as a customer with at least one completed installation.
- [ ] **6.11.2** Dashboard → **Schedule a Trip** → "Existing Installation" tab.
- [ ] **6.11.3** Dropdown populates with active + removal-scheduled installs. Fully-removed installs hidden.
- [ ] **6.11.4** Now sign in as a brand-new account (no completed installs).
- [ ] **6.11.5** Same modal → dropdown area shows the amber empty-state card:
  > **No completed installations on your account yet.**
  > If you have an order being installed in the next few days, switch to **Other Address** and reference the order in the notes — our crew will combine it with the install visit.
  > To **cancel** or change a pending order, use **Order History** — removal service isn't applicable before install.
- [ ] **6.11.6** Click "Other Address" → enter manual address. The Preferred Date picker enforces `getNextAvailableDate()` as min and rejects Sundays (same cutoff rules as install orders).

**If you see** the dropdown silently empty with no amber card, the empty-state JSX regressed.
**If you see** "Schedule a Trip" succeeding with today's date past 4pm via the date input, `minDate` regressed.

---

## 7. Audit log + data hygiene

Covers: the audit log foundation, every audit-worthy action, and the three data corrections that already ran (supportstaff fix, Peggy demote, test-order delete).

### 7.1 Verify Semonin team state

- [ ] **7.1.1** Sign in as `supportstaff@semonin.com`.
- [ ] **7.1.2** Top-right user menu role badge reads **Team Admin** (not Customer, not Admin).
- [ ] **7.1.3** Dashboard → Team Inventory shows **3 signs**, each with the original `assignedToMemberId` preserved (member name on row should match whoever Peggy had assigned them to before — typically herself).

**If role is Customer or Team Inventory is empty**: demotion / re-attribution didn't run. Quick DB check:
```sql
SELECT role, team_id FROM users WHERE email='supportstaff@semonin.com';
-- expect: team_admin + non-null team_id
```

### 7.2 Verify Peggy is plain customer

- [ ] **7.2.1** As admin → `/admin/customers` → search "Peggy" or "pheckert".
- [ ] **7.2.2** Role badge says **Customer**. Team column empty.
- [ ] **7.2.3** Click into profile → Inventory section shows **0 items**.

**If role still says "Team Admin"**: demotion didn't take.
**If inventory still shows her 3 signs**: re-attribution UPDATE didn't fire.

### 7.3 Verify test-order cleanup

- [ ] **7.3.1** Admin → `/admin/orders` → search `PPI-TEST` → **0 results**.
- [ ] **7.3.2** Filter customer = `test@pinkposts.com` → 0 orders (only seeded inventory and Ashley/Marcus/Diana remain).

**If any `PPI-TEST-*` row appears**: delete script missed one.

### 7.4 Verify revenue rollup excludes deleted orders

- [ ] **7.4.1** `/admin/dashboard` (or wherever the revenue widget lives).
- [ ] **7.4.2** Note total gross revenue + completed-orders count.
- [ ] **7.4.3** Confirm the $206.69 from the 3 deleted PPI-TEST orders is **not** included. If you remember the pre-cleanup number, the new number should be exactly $206.69 lower and 3 fewer orders.

**If the dashboard shows the old number**: likely a cached aggregate; hard-refresh. Deletion (not cancellation) was used, so any properly written sum over the `orders` table should already be correct.

### 7.5 Spot-check the audit trail

There is no admin UI for browsing audit rows yet (helper + model in place; surface is TBD). Verify directly against the DB:

- [ ] **7.5.1** Peggy's demotion row exists:
  ```ts
  await prisma.auditLog.findMany({
    where: { action: 'user.role_change', targetId: '<peggy-user-id>' },
    orderBy: { createdAt: 'desc' },
  })
  // Expect: metadata.from='team_admin', metadata.to='customer',
  // actor_email='admin@pinkposts.com' (or null if 'system'), actor_role='admin' or 'system'.
  ```

- [ ] **7.5.2** Hold lifecycle rows exist:
  ```ts
  await prisma.auditLog.findMany({
    where: { action: { startsWith: 'inventory_hold.' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  // Expect a mix of inventory_hold.created / .released / .consumed / .expired
  ```

- [ ] **7.5.3** Test-order deletions left `order.cancel` rows:
  ```ts
  await prisma.auditLog.findMany({
    where: {
      action: 'order.cancel',
      metadata: { path: ['source'], equals: 'script:_delete-test-orders' },
    },
  })
  // Expect: 3 rows, one per deleted PPI-TEST-* order.
  ```

**If any return zero rows**, flag — either the script bypassed `audit()` (wrote raw SQL) or used a different `metadata.source` string.

### 7.6 Audit-action coverage matrix

For reference — what's wired vs. defined-but-unused:

| Action constant | Wired? | Notes |
|---|---|---|
| `UserRoleChange` | YES | rate-limited, from/to + email metadata |
| `OrderCancel` | YES | admin cancel + customer cancel both audit |
| `OrderRefundCreate` | YES | fires after Stripe success, before email |
| `OrderRefundFail` | YES | Stripe failure + email failure both audit |
| `OrderRefundWebhook` | YES | Stripe webhook reconciliation |
| `InventoryReassignBulk` | YES | with per-type counts + target_member_id |
| `InventoryHoldCreated/Released/Conflict/Consumed/Expired/Overridden` | YES | full lifecycle |
| `CartCheckoutSucceed/Fail` | YES | via batch route |
| `CartCheckoutBegin` | NO | constant defined but no natural call site (single-shot server checkout) |
| `InventoryAssign` | **NO** | constant defined but admin "Add Inventory" POST does not call `audit()`. Bulk-reassign IS audited. See §6.2. |

---

## 8. Issues found by code audit

Items here came out of the read-only audit, not from manual testing. Severity / action suggested in parens. The three items that were easy to fix inline were patched before this doc was finalized — those are marked **FIXED** below.

- **8.1** ~~UI/server cutoff drift on customer Cancel button.~~ **FIXED.** Client `canCancel()` now uses `easternMidnightMs` to match the server (matches the cancel route's ET-midnight rule); Cancel button shows/hides at the correct ET-midnight boundary.
- **8.2** ~~`AuditAction.InventoryAssign` defined but never invoked.~~ **FIXED.** Admin Add Inventory POST now writes an `inventory.assign` audit row when `assigned_to_member_id` is set (captures the target agent + quantity + type).
- **8.3** _No admin UI page at `/admin/holds`._ (low, UX) The bulk-reassign 409 error message tells the admin to "release via Admin → Inventory Holds" but there is no such page — only the JSON endpoint. For now, hit `GET /api/admin/holds` and `DELETE /api/admin/holds/<id>` directly. If we want a polished surface, that's separate work.
- **8.4** ~~Admin `override_schedule:true` PUT not audit-logged.~~ **FIXED.** Override path now writes an audit row with `metadata.action: 'schedule_override'` capturing the new date + optional `override_reason`. Re-using `AuditAction.OrderCancel` as the action name for now (no dedicated `order.schedule_override` constant yet — cosmetic follow-up).
- **8.5** _`AuditAction.CartCheckoutBegin` defined but never called._ (cosmetic) Checkout is single-shot server-side, so "begin" had no natural call site. Either leave the constant for forward-compat or remove. No functional impact.
- **8.6** _Refund email author copy on webhook fallback path._ (edge case) `app/api/webhooks/stripe/route.ts:279` hardcodes `refundedBy: 'admin'`. In practice the customer-cancel path emails from `refunds.ts` first (reserves the slot), so the webhook only sends when `refunds.ts` failed. Edge case: a customer who cancelled their own order could see "refunded by admin" copy if email-send failed in `refunds.ts` and only the webhook retry succeeded.
- **8.7** _Admin refund modal doesn't pre-disclose broker as email recipient._ (cosmetic) Admin sees "the broker will be notified" in the success banner after refund, but not before confirming. Minor.
- **8.8** _Bulk-reassign 409 error UI uses `alert()` not a toast._ (cosmetic, pre-existing) Functional but unpolished. Pattern matches the rest of the admin customer detail page.
- **8.9** _Design-doc / code drift on hold index name._ (cosmetic) Design doc says `inventory_holds_live_unique`, code consistently uses `inventory_holds_live_uniq`. Code wins (it's the runtime contract). If a fresh Postgres ever gets the doc's name, the SAVEPOINT + SQLSTATE 23505 fallback still works.
- **8.10** _Role-select Edit modal shows Role field even for non-admin viewers._ (cosmetic, no security risk) A team_admin who somehow reaches `/admin/customers/[id]` can attempt a role change, but the route correctly returns 403. UI doesn't pre-hide the field. Out of scope for this audit.

No high-severity (P0/P1) findings. The money-safety path (refunds, idempotency, reserve-before-Stripe, webhook reconciliation, hold race protection) is clean. Three of the low-severity findings (8.1, 8.2, 8.4) were patched inline before this doc shipped; the rest are cosmetic.

---

## 9. What's NOT in this PR

Defer list — explicitly scoped out of the 6/2–6/4 ship. Not regressions, just not done yet.

- **Server-side cart persistence** (round 1, item #4). Cart still lives in localStorage + cart_session_id; not in the DB. Plan exists; not built.
- **Rural-area surcharge** (round 2, item #3). Research in `docs/round3/r3-design.md`; pricing model TBD.
- **Per-wizard-step hold acquisition.** Holds today are acquired only at Add-to-Cart (and on Edit at Save). Mid-wizard inventory selection does NOT reserve as you go — two team_admins picking the same sign mid-wizard will both proceed; the loser hits a 409 at Add-to-Cart. Acceptable per spec; flagged for awareness.
- **Admin UI page at `/admin/holds`.** JSON endpoint exists; no rendered page (see §8.3).
- **Audit log viewer in the admin shell.** `prisma.auditLog` rows are written everywhere they should be; no UI to browse them. Direct DB query for now.
- **Inline `InventoryAssign` audit row.** See §8.2.
- **Admin schedule-override audit row.** See §8.4.

---

## 10. Sign-off

Once you've worked through this, reply with the section numbers of anything that didn't match expectations. Format that works best:

> **§4.2 — both tabs allowed the same sign.** Saw two reservations in cart, screenshot attached.

If a step passed but felt awkward, call that out too — labeled `UX` so we can sort separately from functional issues:

> **§6.7 UX — dropdown closes when I tab into another field.** Expected it to stay open on focus.

If everything passed clean, a single "all green" reply is enough. We'll cut the merge to `main` after your sign-off.
