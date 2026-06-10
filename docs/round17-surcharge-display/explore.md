I have everything. Returning the explorer report.

# Explorer Report — Service-Area Surcharge Display Gap

## 1. Existing /api/service-area/* endpoint
None. `Glob app/api/service-area/**` and `app/api/**/service-area*` both return empty. New endpoint must be created from scratch.

## 2. Single-order flow (`app/api/orders/route.ts`)
- Auth: `getCurrentUser()` at line 17.
- Surcharge injection: lines 166-179 push synthetic OrderItem with `item_type: 'surcharge'`.
- `prisma.order.create()`: lines 383-437. Fields written include `subtotal, fuelSurcharge, noPostSurcharge, expediteFee, discount, tax, total` — but **NEVER `serviceAreaSurchargeCents` nor `serviceAreaCenterId`**. They are defined in the schema (`prisma/schema.prisma:412-413` defaults to 0) but never set in the data payload. Sarah's column = 0 because the code literally does not write it.
- Audit at lines 440-455 references `sa.surchargeCents` — proof the value is in scope but is dropped on the floor.
- **Hypothesis verified:** add `serviceAreaSurchargeCents: sa.tier === 'surcharge' ? sa.surchargeCents : 0` and `serviceAreaCenterId: sa.decidedBy?.centerId ?? null` to the `data:` block at line 408-417.

## 3. Batch route (`app/api/orders/batch/route.ts`)
- Surcharge injection: lines 163-173 — identical pattern.
- `tx.order.create()`: lines 322-369. Same bug — `subtotal, fuelSurcharge, noPostSurcharge, expediteFee, discount, tax, total` written; `serviceAreaSurchargeCents`/`serviceAreaCenterId` omitted. Add same two fields to data block at line 343-349.
- Surcharge audit at lines 530-548 (same `sa.surchargeCents` reference, never persisted).

## 4. Review-step (`components/order-flow/steps/review-step.tsx`)
- `property_zip` lives in `formData.property_zip` (typed at `components/order-flow/types.ts:18`).
- Order summary line items render around lines 1160-1213 (Subtotal 1162-1165, Discount 1166-1171, Service Trip Fee no_post 1172-1176, Fuel Surcharge 1178-1184 — closest analogue, Expedite 1185-1190, Tax 1191-1197, Total 1198-1201).
- Existing debounce/blur for ZIP: **no dedicated handler.** But there IS an existing `useEffect` (lines 296-350) that already fires on `formData.property_zip` change to call `/api/tax/calculate` — same hook can call the service-area quote. Trigger pattern is already wired.
- Submit handler: `buildItems()` at line 621 — **no surcharge line is ever pushed client-side**. Submits via `fetch('/api/orders', ...)` at line 976 (create) and `/api/orders/${orderId}/edit` at line 918 (edit). So server is sole injector — no double-charge risk when we add a display-only row.

## 5. Recommended fix shape
- Endpoint: `app/api/service-area/quote/route.ts` — `GET ?zip=XXXXX`. Use `getCurrentUser()` (matches orders route at line 17). Pure GET, returns `{ tier, surchargeCents, centerName?, driveTimeMinutes?, contactPhone?, reason? }`. Add `Cache-Control: private, max-age=60` — ZIP→center mapping is stable per user.
- Client integration: extend the existing tax `useEffect` (lines 296-350) OR add a sibling `useEffect` with the same `[formData.property_zip]` dep. Store `{ tier, surchargeCents, centerName, driveTimeMinutes, contactPhone }` in `useState`. Already-present `property_zip` change detection means no debounce work.
- Display: mirror the Fuel Surcharge row at lines 1178-1184 (`flex justify-between text-sm`, gray-600 label, gray-900 amount). Insert between line 1184 and 1185. Include the surcharge in `subtotal`, `taxableAmount` (line 232), and `total` (line 237) when `tier === 'surcharge'`.
- Out-of-area: when `tier === 'out_of_area'`, render an inline error block (mirror `error` state at line 46 / display around the Submit button) AND disable the submit button. Pre-empts the 400 from the route at lines 156-163.

## 6. Column-persistence bug — confirmed
Not a Prisma client/name mismatch (Prisma field `serviceAreaSurchargeCents` maps to `service_area_surcharge_cents` correctly at schema line 412). The bug is **simple omission**: the field is never included in either `prisma.order.create({ data })` block. Fix:
- `app/api/orders/route.ts` line ~414 (in the `data:` object): add `serviceAreaSurchargeCents: sa.tier === 'surcharge' ? sa.surchargeCents : 0, serviceAreaCenterId: sa.decidedBy?.centerId ?? null,`
- `app/api/orders/batch/route.ts` line ~349 (in `tx.order.create({ data })`): same two lines.

Files involved (absolute paths):
- `C:\Users\tanne\PPI\lib\service-area.ts`
- `C:\Users\tanne\PPI\app\api\orders\route.ts`
- `C:\Users\tanne\PPI\app\api\orders\batch\route.ts`
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx`
- `C:\Users\tanne\PPI\components\order-flow\types.ts`
- `C:\Users\tanne\PPI\prisma\schema.prisma`
- New file: `C:\Users\tanne\PPI\app\api\service-area\quote\route.ts`