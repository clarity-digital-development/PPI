### Verdict
**Ship-ready, one minor refinement noted.** The fix correctly addresses the display gap and the persistence bug. Diff matches the claim: new `/api/service-area/quote` endpoint (auth + ZIP-validated, exemption honored), both order routes now persist `serviceAreaSurchargeCents` + `serviceAreaCenterId`, and `review-step.tsx` fetches the quote (300ms debounce), shows the line, folds it into subtotal/discount/tax/total, blocks submit on `out_of_area`. Server remains sole injector of the synthetic `OrderItem` — no double-charge risk.

### Code quality issues
- **No `any`**, no banned patterns. Quote response shape is properly typed. WHY-comments are one-liners.
- **Auth**: ✓ `getCurrentUser()` returns 401 if missing.
- **ZIP validation**: ✓ `/^\d{5}$/` on trimmed input.
- **Exemption**: ✓ Quote endpoint passes `role` and `isServiceAreaExempt`; `resolveServiceArea` short-circuits to `tier: 'exempt'` at line 134 for `team_admin || isServiceAreaExempt`. (Note: `role === 'admin'` is NOT explicitly in the short-circuit. It's not in the resolver either — confirmed pre-existing behavior in `lib/service-area.ts:134`. If admins place orders this fix doesn't change that.)
- **Debounce**: ✓ 300ms with cancellation flag + clearTimeout on cleanup.
- **Minor display gap (not a blocker)**: `buildTaxItems()` in `review-step.tsx:254-307` does NOT push the surcharge into the Stripe-tax preview items. The client's `taxableAmount` (line 246) does include the surcharge via `discountedSubtotal`, so the *fallback* path is correct (Sarah's case). But if Stripe Tax returns a non-zero value for an in-state ZIP it'd be computed without the surcharge ($88 × rate) while the server's Stripe call uses $138 × rate. Display under-reports tax by ~$3 in surcharge-tier ZIPs that get Stripe-tax-active. Worth a follow-up: push a synthetic surcharge line into `buildTaxItems()` (or just `expedite_fee`-style param) when `serviceAreaQuote.tier==='surcharge'`.

### Typecheck status
`npx tsc --noEmit` → **EXIT=0**. Clean.

### Server/client consistency check
- Direct probe of `haversineMiles + estDriveMinutes` against `us-zips` centroids:
  - ZIP **40744** → Lexington (38.0406,-84.5037): 73.0 mi → **79.5 min** → falls in surcharge band ✓ (matches the bug report's "~79 min")
  - ZIP **40509** → Lexington: 7.5 mi → **8.2 min** → standard ✓
- Sarah's user shape (`role='customer', isServiceAreaExempt=false`) **does NOT short-circuit** at the exempt fast-path, so she would receive `tier='surcharge', surchargeCents=5000, decidedBy={centerName:'Lexington', driveTimeMinutes:80}` from the quote endpoint. Cart preview would now render the new line and total $148.75 — matching her actual charge.
- DB-stub: Local Postgres is down (ECONNREFUSED) so I couldn't end-to-end Sarah's user record or run live `prisma.serviceCenter.findMany`. Math/data layer above is sufficient.

### Behavioral verification
Live Playwright **not viable**: dev server is up on port 3000 but DB is unreachable (Prisma ECONNREFUSED). Any login flow would fail at session lookup. Static trace instead:
- ZIP 40744 (non-exempt customer): debounce fires → fetch returns `tier:'surcharge'`. `serviceAreaSurcharge = 50.00`. `subtotal = 88 + 50 = 138`. `discountedSubtotal = 138`. `taxableAmount = 138`. Fallback tax = 8.28. Total = 148.75. New line renders "Out-of-area service fee — Lexington (~80 min) $50.00" above Fuel Surcharge. ✓
- ZIP 40509 (in-band): tier='standard', `serviceAreaSurcharge=0`, line hidden. ✓
- team_admin (supportstaff@semonin.com): resolver short-circuits at line 134 → tier='exempt', `surchargeCents=0`, line hidden. ✓
- Out-of-area ZIP (e.g. 95014): amber callout renders with `tel:` link, Submit/AddToCart/Save buttons all disable via the new `|| serviceAreaQuote?.tier === 'out_of_area'` predicate at lines 1411 / 1421 / 1440. ✓

### Sarah recommendation
She was misled. Preview showed $95.75, card was charged $148.75 — a $53 surprise (the $50 surcharge plus its compounded $3 tax). The synthetic OrderItem appears on her email/invoice, but if she didn't read the line item carefully the only thing she saw at submit time was a smaller total than what posted.
**Recommended action: refund $53.00** ($50 surcharge + $3 tax differential) to Sarah's original PM, with a brief apology note ("Our checkout didn't show a service-area fee that was included in your charge — we've fixed the display, and refunded the difference"). Don't recommend zeroing the entire fee for future orders — the fee itself is legitimate (79-min drive); the bug was display. **Do NOT auto-execute the refund** — Tanner should confirm and run it through Stripe (test-mode first per the constraints). Also: `serviceAreaSurchargeCents` should be **backfilled to 5000** on her order row so reporting matches.

### Recommendation: **ship**
The fix is correct, typed cleanly, defense-in-depth preserved, and resolves both the display gap and the column-persistence bug. Follow-ups (non-blocking):
1. Backfill Sarah's `service_area_surcharge_cents=5000` + center_id.
2. Refund Sarah $53.00 (Tanner-confirmed).
3. Push surcharge line into `buildTaxItems()` so Stripe-tax preview matches server in non-fallback regions.
4. Optional: add a one-line audit on the quote endpoint (`ServiceAreaQuote`) for analytics — currently silent, which matches the spec's "no new audit on read-only quote".