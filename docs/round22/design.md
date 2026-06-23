# Round 22 — Client Change Requests (Plan / design)

**Status: PLAN — awaiting your review + QA. No code has been written.**
**Date:** 2026-06-23 · **Author:** dev (for client = Ryan) · **Branch (suggested):** `round22-client-changes`

This plan was verified against the **actual code** (file:line) and the **live Railway
production DB** (read-only `SELECT`s). Every premise below is marked ✅ verified /
❌ false / ❓ needs-decision. Nothing here is assumed from memory.

---

## 0. The four change requests

| # | Request | Recommended approach | Effort | Risk | Order |
|---|---|---|---|---|---|
| CR3 | Invoice emails must **always send**, even to opted-out accounts | Remove opt-out gate inside `sendInvoiceEmail` (transactional-always) | **S** | Low | **1st** |
| CR1 | Out-of-area mapping; **Danville not charged**; ensure Danville is out-of-area on future orders | Admin-editable **ZIP override** consulted before the distance model + re-resolve on edit | **M** | Med (money) | **2nd** |
| CR2 | Manual toggle to **stop post-rental billing** per order (agent uses their **own post**) | New `Order.postRentalDisabled` flag + admin toggle + auto-set for no-post orders | **M** | Low (cron dormant) | **3rd** |
| CR4 | **Flat-fee accounts** (e.g. Semonin): every order = flat **$66.07** regardless of items | Per-account `User.flatFeeBilling` + **server-authoritative** price clamp (create **and** edit) | **L** | **High** (money) | **4th** |

Recommended implementation order: **CR3 → CR1 → CR2 → CR4** (smallest/live-bug first;
flat-fee last because it interacts with all the others). Each is independently
shippable.

---

## 1. Cross-cutting decisions to confirm (please resolve during review)

These change what gets built. My recommendation is in **bold**; override freely.

- **D1 — Flat-fee scope:** per-**USER** toggle (`User.flatFeeBilling`, like
  `invoiceBilling`) **[recommended]** vs per-**TEAM**. Redfin is a `team_admin`
  with **no team**, so per-user is the robust choice and still covers Semonin.
- **D2 — What flat-fee suppresses:** flat $66.07 = $60 base + $2.47 fuel + 6% tax,
  **suppressing expedite ($50), no-post ($40), promo discounts, and the out-of-area
  surcharge** — i.e. *exactly* $66.07 every time. **[recommended: yes, suppress all]**
  (Your words: "no matter what is selected, it's just $60.")
- **D3 — Flat-fee × post-rental:** are flat-fee accounts also exempt from recurring
  post-rental billing? **Moot for Semonin** (they're `invoiceBilling=true`, which the
  post-rental cron already skips), but confirm the rule for any future flat-fee
  account. **[recommended: out of scope for CR4; treat one-time order only]**
- **D4 — Flat-fee invoice PDF:** for invoice-billed flat-fee accounts, the bundled
  invoice should show the **$66.07 total**; line items shown as **real items**
  (for fulfillment clarity) with the price reconciled to flat, or a **single flat
  line**? **[recommended: single "Flat Installation Fee — $60.00" line + fuel + tax]**
- **D5 — CR2 auto-detect:** besides the manual admin toggle, also **auto-set
  no-rental for no-post orders at checkout** (post type not selected)? This fixes the
  **6 existing no-post orders** that would otherwise be billed if the cron is ever
  switched on. **[recommended: yes — manual toggle + auto-set for no-post]**
- **D6 — CR1 ZIP list:** mark **Danville 40422** out-of-area now. Also add the other
  far ZIPs already seen escaping the fee (**Perryville 40468, Lancaster 40444,
  Richmond 40475**)? **[recommended: start with Danville + these 3; admin-manageable
  going forward]** And separately: do you want the **systemic** fix (real Google
  drive-time) as a later phase? **[recommended: yes, as Round 23]**
- **D7 — Past-order data fixes (approval-gated, separate from code):** do you want me
  to (a) backfill Terra Jeffries' order with the $50 surcharge, and/or (b) action the
  round-17 "Sarah ~$53" refund? Your request was "**future** orders," so the code plan
  does **not** include these — I'll only run data writes with your explicit go-ahead.

---

## 2. CR3 — Invoice emails must always send  *(do first)*

### Problem
Invoice-billed customers who have opted out of email never receive their invoices.

### Root cause (✅ verified — code + DB)
- All invoice sends funnel through one helper, `sendInvoiceEmail`, which gates on the
  recipient's `emailOrderConfirmations` preference at **`lib/email.ts:562`**. Paths:
  admin create+send (`lib/invoices/send-invoice-job.ts:176`), resend, and
  regenerate-payment-link (`app/api/admin/invoices/[id]/regenerate-payment-link/route.ts:147`);
  broker bundle (`app/api/invoices/bundle/route.ts`).
- Opt-out is **per-flag booleans** on `users` (`email_marketing`,
  `email_order_confirmations`, `email_service_requests`) — **there is no
  invoice/billing category**. `shouldSendEmail` is fail-open otherwise
  (`lib/email-preferences.ts:29-56`).
- Password-reset and admin-notification emails **already bypass** `shouldSendEmail`
  (`lib/email.ts:647, 309`) — i.e. the codebase already treats must-send mail this way.
- **DB proof:** exactly **1** user is opted out of order confirmations —
  `supportstaff@semonin.com` (`invoice_billing=true`) — and **1 invoice already has
  `email_status='skipped'`.** The bug has fired in production, on Semonin.

### Non-goals
- Not touching order-confirmation, refund, installation-complete, or post-rental
  receipt emails (they keep honoring opt-out).
- Not adding a new email-preference category.

### Design (chosen: **Option A — transactional-always**)
Remove the `shouldSendEmail` gate inside `sendInvoiceEmail` so invoice emails always
send. A bill is a transactional/relationship message (CAN-SPAM exempts these from
opt-out), and one edit fixes all four paths.
- Alternatives considered: **B** — pass `recipientUserId:null` at each call site
  (more places to touch, easy to miss one); **C** — new `User.alwaysReceiveInvoiceEmails`
  column defaulting true (extra schema + toggle for no real benefit; a bill should
  not be opt-out-able). Both rejected.

### Files to change
- `lib/email.ts` — remove the opt-out gate in `sendInvoiceEmail` (~562-565).
- `lib/invoices/send-invoice-job.ts` — the `skipped` branch (~182-202) becomes dead
  for invoices; leave or clean up.
- `app/dashboard/profile/page.tsx` (~285) — copy tweak: note billing/invoice emails
  always send regardless of this setting.
- *(optional)* `lib/audit.ts` — add an audit line when an invoice is sent despite a
  standing opt-out (forensic trail).

### Failure modes / test plan
- Unit/behavior: opted-out user (`emailOrderConfirmations=false`) → invoice send →
  Resend called, `email_status='sent'` (not `skipped`).
- Regression: opted-out user still does **not** get an order-confirmation email.
- Verify the broker-bundle and regenerate paths now send too.
- Manually re-send the one historical `skipped` invoice for Semonin after deploy
  (data op — your call).

---

## 3. CR1 — Out-of-area mapping / Danville  *(do second)*

### Problem
A ~53-minute-drive order to **Danville KY (40422)** (Terra Jeffries, order
`PPI-MQO81ED4-W9PF`, total $53.35) was **not** charged the $50 out-of-area surcharge.

### How the mapping actually works (✅ verified — `lib/service-area.ts`)
- It is **NOT Google Maps drive-time.** `lib/google-maps.ts` is only browser
  address-autocomplete. Detection is **straight-line (haversine) distance** from the
  order ZIP's centroid (`us-zips` dataset) to each service center, converted to
  *estimated* minutes via `miles × 1.18 ÷ 65 mph × 60` (`lib/service-area.ts:89-104`).
- Each `ServiceCenter` row has its own `standardMinutes` / `surchargeMinutes` bands
  and `surchargeCents`. **Best tier across all centers wins** (`:108-119, 172-208`).
  5 live centers (Louisville, Lexington, Bardstown, Elizabethtown, Cincinnati); all
  `surchargeCents = 5000 ($50)`. Lexington = standard 45 / surcharge 105 min.
- Tiers: `standard` (no fee) ≤ standardMinutes; `surcharge` ($50) ≤ surchargeMinutes;
  else `out_of_area` → **order is blocked (400)**, not charged.
- Exempt (no check at all): `role==='team_admin'` **or** `isServiceAreaExempt`
  (`:133-136`). (So Semonin is exempt — CR1 is about regular customers.)

### Root cause (✅ verified — code + DB)
- Danville 40422 centroid ≈ **31 straight-line miles** from Lexington ≈ **34 estimated
  minutes**, which is **under** Lexington's 45-min `standard` band → tier `standard`
  → **$0**. The real ~53-min winding-road drive is badly under-modeled by the
  straight-line ×1.18 heuristic.
- **This is systemic, not a one-off:** of **239 orders, only 30 ever matched a center
  and exactly 1 was ever surcharged.** Richmond, Lancaster, Perryville (all far) also
  came back $0.
- Secondary bug: the **edit route never re-resolves** service area
  (`app/api/orders/[id]/edit/route.ts:345-374`) — changing the ZIP on an edit does not
  recompute the surcharge.

### Non-goals
- Not rewriting the distance engine in this phase (see D6 / Round 23).
- Not auto-refunding/backfilling past orders (D7, approval-gated).
- Not lowering Lexington's `standardMinutes` (would wrongly surcharge close-in
  Lexington-metro ZIPs).

### Design (chosen: **ZIP override, admin-manageable**)
Add an **explicit out-of-area ZIP override** consulted **before** the distance model
in `resolveServiceArea`. A ZIP on the list resolves to tier `surcharge`,
`surchargeCents = 5000`, regardless of estimated minutes.
- **Two sub-options for where the list lives** (pick in review):
  - **C1 — DB table `ServiceAreaZipOverride`** (zip, tier, surchargeCents, active):
    admin can mark new ZIPs out-of-area **without a deploy**. **[recommended]**
  - **C2 — code constant** (a `Set` of ZIPs in `lib/service-area.ts`): fastest to
    ship, but every future ZIP needs a code change.
- **Also fix the edit route** to re-call `resolveServiceArea` and update
  `serviceAreaSurchargeCents`/`serviceAreaCenterId` when the property ZIP changes.
- **Systemic alternative (D6 / later):** Google **Distance Matrix** real drive-time
  with haversine fallback — accurate everywhere, but adds an external dependency +
  cost + latency to the billing path and needs broad regression QA. Recommended as its
  own round, not this hotfix.

### Data model
- C1: new `model ServiceAreaZipOverride { zip String @id; tier String; surchargeCents Int @default(5000); isActive Boolean @default(true); ... }` → `npm run db:push` (no migration). Seed Danville 40422 (+ D6 ZIPs).
- C2: no schema change.

### Files to change
- `lib/service-area.ts` — consult the override list first in `resolveServiceArea`
  (after exempt fast-path, before haversine).
- `app/api/orders/[id]/edit/route.ts` — re-resolve service area on ZIP change; update
  the surcharge columns + (re)inject/remove the synthetic surcharge line.
- *(C1)* admin UI to manage the ZIP list (small page or reuse service-areas admin) +
  a seed/insert for Danville. *(C2)* the ZIP `Set` constant.

### Failure modes / test plan
- Danville 40422 order (regular customer) → **$50 surcharge** applied as a synthetic
  line; total reflects it; `service_area_surcharge_cents=5000`.
- Close-in Lexington ZIP (e.g. 40507) → **still $0** (no over-charge).
- `isServiceAreaExempt`/team_admin (Semonin) → **still exempt** even if ZIP is on the
  list (confirm desired — exempt should win).
- Edit an order's ZIP from in-area → Danville → surcharge **appears** on recompute;
  and Danville → in-area → surcharge **removed**.
- Out-of-area (beyond surcharge band) still blocks with 400.

### UI states
- Review step already fetches `/api/service-area/quote` and renders the surcharge line
  + disables submit on `out_of_area` (`review-step.tsx:1251-1256,1414-1472`) — verify
  the override flows through the quote endpoint so the customer sees the fee pre-pay.

---

## 4. CR2 — Manual post-rental opt-out / "agent uses their own post"  *(do third)*

### Problem
Need a manual admin toggle to stop **recurring post-rental billing** for an order —
specifically when the agent supplies their own post (PPI shouldn't charge rental on a
post it doesn't own).

### Current state (✅ verified — code + DB)
- Post-rental = a separate recurring subsystem: the cron schedules `PostRentalCharge`
  rows (T+6mo $18, T+9mo $18, then $6/mo) for `completed`+`succeeded` orders with an
  active installation and `invoiceBilling=false` (`lib/post-rental-billing.ts`,
  `app/api/cron/post-rental-billing/route.ts`).
- `Order.postRentalEnabledOverride` is an **opt-IN for grandfathered (pre-rollout)
  orders only** (`lib/post-rental-billing.ts:178`) — **not** a general on/off. **DB:
  all 239 orders = false** (nobody has opted in).
- An admin override **endpoint + UI already exist** but only render for
  grandfathered/override-on orders (`app/api/admin/orders/[id]/post-rental/override/route.ts`,
  `app/admin/orders/[id]/page.tsx:1145-1173`).
- "Own post" is **not modeled** today. A no-post order is just `post_type_id IS NULL`
  (+ the $40 no-post fee). `CustomerSign` is sign *panels*, not posts.
- **Cron is dormant** (`POST_RENTAL_BILLING_START_AT` default 2099) and
  **`post_rental_charges` is empty** → no live charges, no backfill needed. But **158
  orders would be billable** today and **6 are no-post** (would be wrongly billed).

### Non-goals
- Not launching/restructuring post-rental billing (separate business decision).
- Not modeling full post ownership/inventory — just an opt-out flag.

### Design (chosen: **dedicated opt-out flag**)
Add `Order.postRentalDisabled Boolean @default(false)` (a.k.a. "customer-owned post /
no rental"). Add an **early short-circuit** in `isPostRentalEligible` (before the
grandfathered check) and to the cron Pass-1 `WHERE`. **Precedence: disabled wins over
the opt-in override.**
- Per **D5**: also auto-set `postRentalDisabled=true` at checkout when no post type is
  selected (`post_type_id IS NULL`) in **both** create paths — permanently fixing the
  6-no-post-orders bug.
- Admin toggle: make it **always visible** on the order page (not just grandfathered),
  cloning the existing override toggle UI/route; reversible.
- Alternative considered: overload `postRentalEnabledOverride` into a nullable
  tri-state — rejected (mutates a live money-gating field + a non-null read in
  `admin-view`, semantically muddy, saves nothing).

### Data model
- `Order.postRentalDisabled Boolean @default(false) @map("post_rental_disabled")` →
  `npm run db:push`. New audit action in `lib/audit.ts`.

### Files to change
- `prisma/schema.prisma` (new field), `lib/post-rental-billing.ts` (short-circuit +
  new eligibility reason), `app/api/cron/post-rental-billing/route.ts` (Pass-1 WHERE),
  `lib/post-rental/admin-view.ts` (keep the admin "next charge" badge truthful — math
  is duplicated here), the admin order page + a toggle route, and *(D5)* both order
  create paths.

### Failure modes / test plan
- Order with `postRentalDisabled=true` → cron Pass-1 dry-run (`?dry_run=true`) does
  **not** schedule it; an eligible order still does.
- No-post order created → flag auto-set true (D5).
- Toggle on/off in admin persists + audits; disabled beats override-on.
- (No `post_rental_charges` exist, so no suppression/backfill needed — going-forward
  only.)

---

## 5. CR4 — Flat-fee accounts ($66.07)  *(do last — highest money risk)*

### Problem
Some brokerages (e.g. **Semonin**) should be billed a **flat $66.07 per order**
regardless of items selected — no à la carte. Items still flow to fulfillment /
service requests as normal.

### The exact math (✅ verified — code + DB)
- Tax base **excludes** the fuel surcharge (`lib/orders/pricing.ts:48`,
  `app/api/tax/calculate/route.ts:27`, etc.; confirmed empirically on Tara's order:
  $48 taxable × 6% = $2.88).
- Flat: **taxable $60.00 → tax $3.60** (6% fallback, deterministic) **+ fuel $2.47
  (untaxed) = $66.07.** Expedite/no-post/discount = 0.
- Context: current post prices are $40–$95 (`post_types`), so $60 flat is a genuine
  simplification.

### Why it must be server-authoritative (✅ verified)
- **Item totals are client-trusted** — no server recompute on create or edit
  (`orders/route.ts:217`, `edit/route.ts:238`). So the flat clamp **must** be enforced
  on the server, not just shown in the UI.
- **The edit route MUST be flat-aware** or it's a money bug: editing a flat-fee order
  would recompute a normal total and the diff-charge logic (`edit:423-551`) would bill
  the difference. Store `Order.flatFeeApplied=true` so the edit route recomputes flat.
- Fulfillment is **fully decoupled** from price (`orders/[id]/route.ts:204-298` reads
  item types only) — clamping the total does not affect installations/service requests. ✅

### Account model (✅ verified — DB)
- Semonin = `team_admin`, team "Semonin Realtors", `invoice_billing=true`,
  `is_service_area_exempt=true`. 3 team_admins, 2 teams; **Redfin has no team** → use a
  **per-USER** flag (D1).

### Non-goals
- Not changing fulfillment, item selection, or service-request creation.
- Not making the flat amount admin-configurable in v1 (hardcoded constants, matching
  existing fee-constant style) unless you want it.

### Design (chosen: **server clamp via shared helper + per-user flag + display**)
1. Add `User.flatFeeBilling Boolean @default(false)` (admin toggle; D1).
2. Add a shared `computeFlatFee()`/branch in `lib/orders/pricing.ts` and clamp in
   **both** create paths (`orders/route.ts`, `orders/batch/route.ts`): when the payer
   (`resolveEffectivePayer`) is flat-fee, override the pricing block to
   subtotal/base $60, fuel $2.47, expedite 0, no-post 0, discount 0, tax $3.60,
   total $66.07; persist the **real** order items unchanged for fulfillment.
3. **Make the edit route flat-aware** (recompute flat instead of diff-charging).
4. Set `Order.flatFeeApplied=true` for edit/invoice/reporting correctness.
5. Client display (cosmetic): plumb the flag to the wizard (like the existing
   `lockboxInstallFee` pattern) so the review step shows **$60 + $2.47 + $3.60 =
   $66.07**. Server remains source of truth.
6. Per **D2**: flat suppresses expedite/no-post/promo/out-of-area surcharge.
7. Per **D4**: bundled invoice for invoice-billed flat-fee accounts shows $66.07.

### Data model
- `User.flatFeeBilling Boolean @default(false) @map("flat_fee_billing")`.
- `Order.flatFeeApplied Boolean @default(false) @map("flat_fee_applied")`.
- *(optional)* store flat amounts on the order if you want them configurable later.
- `npm run db:push` (no migration). New audit action for the account toggle.

### Files to change
- `prisma/schema.prisma`; `lib/orders/pricing.ts` (flat helper); `app/api/orders/route.ts`
  + `app/api/orders/batch/route.ts` (clamp); `app/api/orders/[id]/edit/route.ts`
  (flat-aware recompute); admin account edit (toggle — see §6); review-step + wizard
  (display); invoice PDF/load-detail if D4 wants a single flat line.

### Failure modes / test plan
- Flat-fee account, any item combination (cheap, expensive, expedite, no-post,
  promo) → server total is **exactly $66.07**; persisted `subtotal/fuel/tax/total`
  correct; items still created for fulfillment.
- **Edit** a flat-fee order (add/remove items) → total stays $66.07, **no diff
  charge**.
- Non-flat account → unchanged (regression).
- Invoice-billed flat-fee (Semonin) → bundled invoice shows $66.07, no checkout PI.
- Tax determinism: flat uses the 6% fallback (bypass Stripe Tax) so it's always $3.60.

---

## 6. Shared admin toggle pattern (used by CR4, and CR2's account-level bits)

✅ verified: broker/customer accounts are edited at **`app/admin/customers/[id]`**;
the save route is **PUT** (not PATCH), **no Zod** — a hand-written allow-list of
`if (body.x !== undefined)` branches (`app/api/admin/customers/[id]/route.ts:292-405`),
**admin-only**, with per-field audit deltas. `isServiceAreaExempt` and `invoiceBilling`
are the existing boolean-toggle pattern to **clone verbatim**:
1. `prisma/schema.prisma` — add the boolean (`db:push`).
2. `lib/audit.ts` — add an audit action.
3. `route.ts` — GET mapping + PUT allow-list branch + audit delta.
4. `app/admin/customers/[id]/page.tsx` — `editData` type/init, fetch hydrate, PUT body,
   and a checkbox in the Edit-Customer modal (clone the `invoice_billing` block).

---

## 7. Sequencing, dependencies, and what review/QA should cover

1. **CR3** (no deps) — ship the live-bug fix; re-send Semonin's skipped invoice.
2. **CR1** (no deps) — ZIP override + edit re-resolve; QA over-charge/under-charge ZIPs.
3. **CR2** (no deps) — opt-out flag + admin toggle + no-post auto-set; cron dry-run QA.
4. **CR4** (depends on D1–D4 + the §6 toggle pattern) — server clamp + flat-aware edit;
   this is the money-critical one — review Lens 1 (correctness) + Lens 2 (no
   double/wrong charge) hard.

All schema changes use **`npm run db:push`** (this repo does **not** use migrations);
after any DB reset, re-apply the `inventory_holds` partial unique index. New money
paths should ship behind their flags and get an adversarial review pass.

## 8. Data operations (require your explicit approval — NOT in the code plan)
- Backfill Terra Jeffries' order `PPI-MQO81ED4-W9PF` with the $50 surcharge? (you said
  *future* orders, so default = **no**).
- Round-17 "Sarah ~$53" refund? (separate; default = **no** unless you confirm).
- Seed the CR1 ZIP override list (Danville 40422 + neighbors per D6).
- Re-send the 1 historically `skipped` Semonin invoice after CR3 ships.
