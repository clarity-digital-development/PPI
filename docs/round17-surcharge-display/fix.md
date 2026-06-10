Good — the field is widely used. The fix is complete and compiles cleanly.

---

## Sarah's case trace (ZIP 40744, items $88, surcharge $50)

**Before** (production today):
- Client preview: subtotal $88 + fuel $2.47 + tax ($88 * 0.06 = $5.28) → **$95.75 shown**
- Server injection: items array gains $50 surcharge → subtotal $138 + fuel $2.47 + tax ($138 * 0.06 = $8.28) → **$148.75 charged**
- Gap: **$53.00 surprise**

**After** (this fix):
- Client fires `GET /api/service-area/quote?zip=40744` after debounce → returns `{ tier: 'surcharge', surchargeCents: 5000, centerName: 'Lexington', driveTimeMinutes: 79, ... }`
- `serviceAreaSurcharge = 50`
- `subtotal = 88 + 50 = 138`
- `discountedSubtotal = 138`, `taxableAmount = 138 + 0 + 0 = 138`
- `tax = 138 * 0.06 = 8.28`
- `total = 138 + 2.47 + 0 + 0 + 8.28 = 148.75` ✓ matches server
- Review summary now renders: `Out-of-area service fee — Lexington (~79 min) $50.00`
- Order row persists `service_area_surcharge_cents = 5000` and `service_area_center_id = <Lexington id>`

---

## Files changed

- `C:\Users\tanne\PPI\app\api\service-area\quote\route.ts` (new) — auth-gated GET, 5-digit ZIP validation, calls `resolveServiceArea`, returns `{ tier, surchargeCents, centerName?, driveTimeMinutes?, contactPhone?, reason? }` with `Cache-Control: private, max-age=30`.
- `C:\Users\tanne\PPI\app\api\orders\route.ts:417-418` — added `serviceAreaSurchargeCents` and `serviceAreaCenterId` to `prisma.order.create({ data })`. Fixes the column-persistence bug that left Sarah's column = 0.
- `C:\Users\tanne\PPI\app\api\orders\batch\route.ts:350-352` — same two fields added to the batch `tx.order.create({ data })`.
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx:58-66` — `serviceAreaQuote` state.
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx:233-241` — `serviceAreaSurcharge` derived; folded into `subtotal` and `discountableSubtotal` so it flows through discount/tax/total exactly like the server's synthetic OrderItem.
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx:362-388` — new `useEffect` on `formData.property_zip` with 300ms debounce; fetches `/api/service-area/quote?zip=...`, clears on invalid zip, cancellable on unmount/change.
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx:1190-1200` — new summary row "Out-of-area service fee — {centerName} (~{driveTimeMinutes} min)" rendered only when `tier === 'surcharge'`, inserted right above the Fuel Surcharge row.
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx:1395-1407` — out-of-area amber callout with `tel:` link to `contactPhone`, rendered when `tier === 'out_of_area'`.
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx:1418, 1430, 1444` — submit/add-to-cart/save-changes buttons all gain `|| serviceAreaQuote?.tier === 'out_of_area'` to the `disabled` predicate, pre-empting the server 400.

## Verification

- `npx tsc --noEmit` → **EXIT=0** (strict TS, no `any` introduced).
- No changes to server-side surcharge injection — server remains source of truth.
- `audit()` calls unchanged; no new audit on the read-only quote endpoint.