I have enough to answer. The TodoWrite reminder doesn't apply — this is a single-shot exploration task. Here's the report.

---

**EXPLORER A — Order-creation surface map**

**1. Where server-side total is computed (where to add $50 surcharge OrderItem + bump total)**

Two paths, both server-authoritative on pricing:

- **Single-order** `app/api/orders/route.ts:135-238`. Subtotal = `items.reduce` (L135), then `expediteFee` (L140), `noPostSurcharge` (L177), `discount` (L143-175), `tax` (L182-236), `total = discountedSubtotal + actualFuelSurcharge + expediteFee + noPostSurcharge + tax` (**L238**). To add the surcharge: introduce `serviceAreaSurcharge` alongside `noPostSurcharge` (~L177), push it into `taxableAmount` (L180) and `total` (L238). The matching DB columns get persisted at `app/api/orders/route.ts:361-368`. Push an OrderItem (e.g. `item_type: 'trip'`, already in the zod enum at `lib/validations.ts:22`) into `orderData.items` so it shows on the receipt as a line — or add a dedicated `serviceAreaSurcharge` Decimal column on `Order` mirroring `noPostSurcharge` (`prisma/schema.prisma:398`). Recommend the column approach — symmetric with `noPostSurcharge`/`expediteFee`, no fake OrderItem rows.

- **Batch/cart** `app/api/orders/batch/route.ts:137-141` calls `computeOrderPricing` (`lib/orders/pricing.ts:34-53`). That's the single chokepoint for batch pricing — add a `serviceAreaSurcharge` field to `ComputedOrderPricing` and roll it into `total` on `lib/orders/pricing.ts:50`. Then plumb through to `Order.create` at `app/api/orders/batch/route.ts:273-279`.

Client review pricing is in `components/order-flow/steps/review-step.tsx:224-237` (subtotal/total compute) — purely cosmetic; server is the source of truth.

**2. "Block with 400 + friendly message" pattern (validateScheduling template)**

`lib/scheduling.ts:138-190` defines the validator returning `{ ok, error, code }`. Call sites:

- `app/api/orders/route.ts:123-132` — single-order POST, returns 400 with `{ error, code }`.
- `app/api/orders/batch/route.ts:113-122` — batch POST, prefixes `Order ${i+1}:`.

Mirror exactly: create `lib/service-area.ts` exporting `validateServiceArea({ propertyZip, user, request })` → returns `{ ok: true } | { ok: false, error, code: 'out_of_area' | 'invalid_zip', tier, surchargeAmount?, phone?, nearestCenter? }`. Slot the call in `app/api/orders/route.ts` right after L132 (post-schedule, pre-pricing — so surcharge can feed into pricing), and in `app/api/orders/batch/route.ts` after L122 inside the per-order `for` loop.

**3. propertyZip shape at submit**

- Type: `string`, zod-validated `min(5)` at `lib/validations.ts:15`. No upper bound, no regex — `"42701-1234"`, `" 42701 "`, and `"abcde"` all pass.
- Source on the wire: `body.property_zip` (`components/order-flow/steps/review-step.tsx:984`) → `orderData.property_zip` → `Order.propertyZip` (`app/api/orders/route.ts:349`; `app/api/orders/batch/route.ts:262`).
- Schema column is plain `String` (`prisma/schema.prisma:378`).
- **Normalization required in validator**: `zip.trim().split('-')[0]` → require `/^\d{5}$/`. Reject otherwise with `code: 'invalid_zip'`. Do NOT tighten the zod schema (historic orders have garbage); enforce only in the service-area gate.

**4. Existing admin override / bypass pattern at submit**

None for validators. The closest existing bypass concept is `canActOnBehalfOf` at `app/api/orders/route.ts:79` (gates impersonation, not a validator skip), and `fuelSurchargeWaived` via promo code (`app/api/orders/route.ts:171`, persisted as a price field — not a validator bypass).

Propose: gate the bypass inside `validateServiceArea` itself, taking `user` as input. Helper `isServiceAreaExempt(user) = user.role === 'team_admin' || user.isServiceAreaExempt`. Exempt → `{ ok: true, exempt: true, tier: 'exempt', surchargeAmount: 0 }` regardless of computed tier. Audit emits the computed tier so we still see "out_of_area but exempt" attempts. New User column: add `isServiceAreaExempt Boolean @default(false) @map("is_service_area_exempt")` after L82 in `prisma/schema.prisma`.

**5. Batch / on-behalf-of: who is "the user" for exemption?**

In batch (`app/api/orders/batch/route.ts:255`), `userId: actor.id` — there is no on-behalf-of in the cart (comment says so explicitly). So batch = actor = payer, no ambiguity. Use **actor** for exemption.

In single-order (`app/api/orders/route.ts:74-88`), `user` = the agent (order owner), `payer`/`actor` = the placer. The placer pays the card (L240-261). **Recommend: use the PAYER (actor) for the exemption check.** Matches Ryan's "we want to keep them from having to pay" — they're the wallet. Implementation: `validateServiceArea({ user: actor, ... })` in both endpoints. This also means a team_admin placing for a non-exempt agent → free pass (which Ryan explicitly wants — "always going to try to accommodate them").

---

Files referenced (absolute):
- c:\Users\tanne\PPI\app\api\orders\route.ts
- c:\Users\tanne\PPI\app\api\orders\batch\route.ts
- c:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx
- c:\Users\tanne\PPI\lib\scheduling.ts
- c:\Users\tanne\PPI\lib\orders\pricing.ts
- c:\Users\tanne\PPI\lib\validations.ts
- c:\Users\tanne\PPI\prisma\schema.prisma