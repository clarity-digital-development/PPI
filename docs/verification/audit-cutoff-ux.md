All confirmed. The Badge component was removed from the per-row inventory display (no per-row "agent" badge); the agent assignment uses SearchableSelect. Now I have everything needed to produce the walkthrough.

## Schedule cutoff (Megan's 10pm bug) + UX polish — Ryan walkthrough

### Audit findings (code → changelog match)

**Schedule cutoff — all four write paths gated:**
- `lib/scheduling.ts:138` exports `validateScheduling({ requestedDate, isExpedited })` returning typed errors with codes `before_cutoff` | `sunday_closed` | `expedite_unavailable` | `invalid_date_format`.
- `canExpediteNow()` checks `hours < 16` Eastern (lib/scheduling.ts:51). `getNextAvailableDate()` pushes +1 day, +2 if past 4pm, skips Sunday (lib/scheduling.ts:24).
- `validateScheduling` enforces BOTH constraints when expedited+date are supplied (lib/scheduling.ts:149-187) — confirmed the adversarial-review fix: `is_expedited:true` with a past `requested_date` no longer slips through.
- Wired at: `app/api/orders/route.ts:122-131` (POST), `app/api/orders/batch/route.ts:111-121` (per order, returns "Order N: ..." prefix), `app/api/orders/[id]/edit/route.ts:87-104` (only when date OR expedited changed — older orders stay editable), `app/api/admin/orders/[id]/route.ts:84-96` (PUT, with `override_schedule:true` escape hatch for support).
- Cancel route uses `easternMidnightMs` (app/api/orders/[id]/cancel/route.ts:78), not UTC midnight. Helper at lib/scheduling.ts:74 binary-probes EST/EDT offsets.

**UX polish — all wired:**
- `components/ui/SearchableSelect.tsx` — keyboard-navigable, click-outside-closes, search-on-type. Used in `app/dashboard/inventory/page.tsx:318` (per-row assign dropdown) AND :371 (top "Filter by agent" card). Per-row Badge component is GONE — items render as plain `<span class="truncate">` (inventory page line 309).
- `app/dashboard/place-order/page.tsx:88-97` filters `teamMembers` by name OR email on every keystroke; Enter auto-picks first match (line 292-294); shows "X of Y agents" count (line 300); amber empty state (line 305).
- `components/order-flow/steps/review-step.tsx` — Order Summary block (line 1038-1179) renders Property / Schedule / Line Items / Promo / Totals only. No "agent who sold this property" tag block. (Agent name lives on the upstream property step via `placed_for_agent_name` and is persisted to `Order.placedForAgentName` at app/api/orders/route.ts:324 — but not re-rendered at review.)
- `app/(marketing)/terms/page.tsx:121-138` — Post Rental Terms section: "$18 every 3 months" + bolded "Effective June 10, 2026. Orders placed before this date are not subject to the extended rental fee until that date."
- `components/dashboard/installation-modals/ScheduleTripModal.tsx:67` calls `/api/installations` (was `/api/inventory`, which returned `undefined.installations`). Empty state at line 265-275 is amber and redirects to "Other Address" or "Order History" with explicit guidance.

**Mismatches:** None. One observation: the admin PUT escape hatch (`override_schedule:true`) is NOT logged to the audit table — it's gated only by `user.role === 'admin'`. The code comment says "logged implicitly via the order update" but I don't see an explicit audit() call. Low-risk (admin-only), but worth a future-Ryan note.

---

## Schedule cutoff (Megan's bug)

The bug: Megan submitted an order at 10pm ET with today's date and her install got booked for the same day, because the cutoff was client-side only.

**Repro 1 — confirm 4pm gate via dev tools (most direct):**
1. Sign in as `test@pinkposts.com` / `PinkPosts2026`.
2. Open dev tools → Network tab → throttle off.
3. After 4pm ET, in the Console run:
   ```js
   fetch('/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
     property_type:'residential', property_address:'1 Test St', property_city:'Louisville', property_zip:'40202',
     items:[{item_type:'sign',description:'test',quantity:1,unit_price:30,total_price:30}],
     is_expedited:true, payment_method_id:'pm_xxx'
   })}).then(r=>r.json()).then(console.log)
   ```
4. Expected: `400 { error: "Same-day service is unavailable after 4pm Eastern...", code: "expedite_unavailable" }`. If it returns 200 or any successful order — **that's the regression**.

**Repro 2 — past-date with expedited true (the harder bypass):**
5. Same console, body with `is_expedited:true` AND `requested_date:'2026-06-04'` (today). After 4pm ET, expect `400 expedite_unavailable`. Before 4pm ET, expect 200 (legitimate same-day).
6. Now try `is_expedited:true` + `requested_date:'2026-06-01'` (a past date) — expect `400` regardless of time. Pre-fix this slipped through and persisted a past `scheduledDate`.

**Repro 3 — Megan's exact scenario through the wizard:**
7. Sign in, click **Place a New Order** at 10pm ET.
8. On the Schedule step, the "Same Day (Expedited)" option should be hidden/disabled, and the date picker's earliest selectable date should be **day-after-tomorrow** (since past 4pm we push +2). Pick that date, complete the wizard.
9. Open dev tools, edit the JSON body before submit (replace `requested_date` with today's date). Submit. Expected: `400 before_cutoff` with message "Earliest available install date is YYYY-MM-DD..."
10. If the order goes through with today's date — **that's the bug**.

**Repro 4 — Sunday closed:**
11. Pick the next Sunday in the wizard's date picker (the input's `min` doesn't filter weekdays, just minimum date). Submit. Expected: `400 sunday_closed`.

**Repro 5 — admin override (support tool):**
12. Sign in as `admin@pinkposts.com` / `admin123`. Open any order's admin detail page.
13. Try to PATCH a date past the cutoff via dev tools without override: `fetch('/api/admin/orders/<id>', {method:'PUT', body: JSON.stringify({scheduled_date:'2026-06-01'})})`. Expected: `400 before_cutoff`.
14. Retry with `override_schedule:true` in the body. Expected: 200 + date updated. This is the escape hatch for support reschedules — if you ever fix a date over the phone, this is what the support staff route should call.

**Repro 6 — cancel window in ET (not UTC):**
15. Place an order today scheduled for tomorrow.
16. Just before midnight UTC (= ~8pm ET, which is well WITHIN the 24h-before-install window), call cancel. Expected: 200 success. Pre-fix this returned 409 "window closed" because UTC-midnight rolled the cutoff forward by ~4 hours.

**If you see X, that's a bug:**
- 200 on any expedited submission after 4pm ET → cutoff bypassed, page check `validateScheduling` and the route wiring.
- 200 on `is_expedited:true` + past `requested_date` → adversarial fix regressed.
- "Cancellation window closed" message earlier than expected ET-midnight − 24h → `easternMidnightMs` returning UTC.
- Batch endpoint returning a generic 500 instead of `"Order 2: Same-day service unavailable..."` → check `app/api/orders/batch/route.ts:116` prefixes with order index.

---

## UX polish

**1. Searchable agent input on Team Inventory:**
1. Sign in as a team_admin with multiple team members (e.g. `test@pinkposts.com`).
2. Go to **Dashboard → Inventory** ("Team Inventory" header).
3. Top "Filter by agent" card: click the dropdown → search box auto-focuses → type a few letters → list filters in real time. ArrowDown/Up navigate, Enter selects, Escape closes.
4. On any inventory row, the right-side "Assign to" dropdown is the same `SearchableSelect`. Open it, search for a teammate, click — assignment saves silently (spinner via `saving` state).
5. Agent name in the row is a plain truncated `<span>` — no colored pill/Badge per row. If a name overflows, it ellipsizes on one line (line 309 `truncate`).
6. **If you see X, that's a bug:** native browser `<select>` instead of search popup → SearchableSelect import lost; full-width-wrap or two-line agent names → truncate class regressed; clicking outside doesn't close → click-outside listener broke.

**2. Search-as-you-type on Place Order agent picker:**
7. As team_admin, click **Place a New Order**. The agent-picker gate appears.
8. A search input (line 285) sits above the agent cards with placeholder "Search agents by name or email…".
9. Type — cards filter on every keystroke (`useMemo` filter at place-order/page.tsx:90).
10. "X of Y agents" counter appears next to the input when filtering (line 298).
11. Press Enter with one or more matches — first match is auto-selected and the wizard loads (line 292-294).
12. Empty state when no matches: "No agents match 'foo'" with a Clear button.

**3. Removed redundant agent tag at checkout:**
13. Place-order wizard → fill through to Review & Pay step.
14. Order Summary block shows: Property / Requested Date / Line Items / Promo / Totals. No "agent who sold this property" pill/tag visible. The `placed_for_agent_name` is still captured upstream and sent to the server (review-step.tsx:973) but not re-rendered at review.
15. **If you see X, that's a bug:** a chip or "Agent: Ashley Brown" label appearing in the Order Summary box.

**4. Quantity field for "Other" inventory (admin modal):**
16. Sign in as admin. Inventory admin → Add Inventory → pick type "Other". A `Quantity` numeric field should be visible (default 1).
17. Bulk-reassign endpoint: re-checked in #7 commit (b3e2751). Not in this audit's strict scope.

**5. $18 rental terms disclaimer:**
18. Open `/terms` (footer link or direct).
19. Scroll to "Post Rental Terms" → second paragraph reads:
    > **Effective June 10, 2026.** Orders placed before this date are not subject to the extended rental fee until that date.
20. **If you see X, that's a bug:** the date reads anything other than "June 10, 2026" or the bold wrapping is missing.

**6. Schedule a Trip fix:**
21. Sign in as a customer with at least one completed installation.
22. Dashboard → click **Schedule a Trip**.
23. "Existing Installation" tab → dropdown populates (was empty pre-fix because it hit `/api/inventory` instead of `/api/installations`). Active + removal_scheduled installs included; fully-removed are hidden (ScheduleTripModal.tsx:73-75).
24. Now sign in as a customer with NO completed installs (e.g. a brand-new account).
25. Same modal: dropdown area shows the amber empty-state card:
    > **No completed installations on your account yet.**
    > If you have an order being installed in the next few days, switch to **Other Address** and reference the order in the notes — our crew will combine it with the install visit.
    > To **cancel** or change a pending order, use **Order History** — removal service isn't applicable before install.
26. Click "Other Address" → enter manual address. The Preferred Date picker enforces `getNextAvailableDate()` as min and rejects Sundays (same cutoff rules as install orders, ScheduleTripModal.tsx:185-194).
27. **If you see X, that's a bug:** dropdown silently empty with no amber card → empty-state JSX regressed; "Schedule a Trip" succeeding with today's date past 4pm via the date input → `minDate` regressed.

---

**One non-blocking note for follow-up:** The admin PUT `override_schedule:true` path (app/api/admin/orders/[id]/route.ts:84) bypasses `validateScheduling` but doesn't write to the audit table. The route comment claims "logged implicitly via the order update" — I don't see an explicit `audit()` call. Low-risk (admin-only, behind role gate), but if you ever want a paper trail of who overrode whose cutoff, that's where to add it.