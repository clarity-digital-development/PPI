TypeScript clean. Final summary:

---

**Files modified — 3:**

**`app/api/orders/route.ts`** (single-order POST)
- Added `resolveServiceArea` import; inserted gate after `validateScheduling` (L135-180) using actor as effectiveUser (actor is the wallet/payer per Ryan), returns 400 `service_area_unavailable` with `contactPhone` on `out_of_area`, audits `ServiceAreaBlock` with `{zip, reason, attemptedTotal, centersChecked:5}`. On `surcharge`, pushes a synthetic OrderItem `{item_type:'surcharge', description:"Out-of-area service fee – <center> ~<min>min", quantity:1, unit/total_price: cents/100}` into `orderData.items` BEFORE pricing — so it naturally flows into `subtotal`, tax, total, email items list, order detail page, and Order.orderItems. Added `ServiceAreaSurchargeApplied` audit after order create with `{centerId, centerName, driveTimeMinutes, surchargeCents, zip}`.

**`app/api/orders/batch/route.ts`** (cart batch POST)
- Imported `resolveServiceArea` + `ResolveResult`. Added `saBlocks[]` accumulator and `serviceArea` field on `Computed`. Per-order in Step 1 loop: resolves SA after schedule check; `out_of_area` pushes into `saBlocks` (continues scanning so response lists every failed order at once) and audits `ServiceAreaBlock` per-order with `targetType:'cart'`; `surcharge` pushes synthetic OrderItem into `o.items` so it flows through `computeOrderPricing` → tax → total → DB OrderItem create. After the loop, if `saBlocks.length > 0` returns 400 `{code:'service_area_unavailable', failed_orders:[{order_index, zip, reason}], contactPhone}` BEFORE any Stripe/PI work. After PI success, audits `ServiceAreaSurchargeApplied` per created order whose tier was surcharge.

**`app/api/admin/orders/[id]/route.ts`** (admin order edit PUT)
- Gate NOT applied (admins trusted to override intentionally per spec). Added `property_zip` field handling: if changing the ZIP on an order whose owner is NOT exempt (not `team_admin`, not `isServiceAreaExempt`), writes a WARN `ServiceAreaBlock` audit `{warn:'admin_zip_override_no_regate', from, to, ownerUserId}`. ZIP write is applied either way.

**Surcharge rendering check — clean, no template changes needed:**
- Customer order confirmation email (`lib/email.ts` `sendOrderConfirmationEmail`): renders each `items[].description` + `total_price` regardless of itemType → surcharge line shows up as "Out-of-area service fee – Lexington ~70min  $50.00".
- Admin order notification email (`sendAdminOrderNotification`): same iteration pattern → renders cleanly.
- Order detail page (`app/dashboard/orders/[id]/page.tsx` ~L399): iterates `order.orderItems` reading `description` + `totalPrice` → renders cleanly. Note: itemCategory is undefined for surcharge so the small italic category subtitle is skipped, which is correct.
- Order confirmation page (`app/dashboard/order-confirmation/page.tsx` ~L171): same pattern → renders cleanly.
- `OrderItem.itemType` is a plain `String` in `prisma/schema.prisma:462` (no enum constraint), so `'surcharge'` persists fine.
- The Zod `orderItemSchema.item_type` enum at `lib/validations.ts:22` does NOT include `'surcharge'` — but that's intentional and correct: the surcharge OrderItem is added server-side AFTER `safeParse`, so clients can't fake a $0 surcharge into the cart to spoof the fee.

**Verification:** `npx tsc --noEmit` exit 0, zero output.