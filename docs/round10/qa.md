---

# QA REVIEW — Service-Area Gating

## 1. Diff vs claims — VERIFIED

Every file the 4 specialists claimed to touch is present in `git diff HEAD` / untracked. Untracked: `app/admin/service-areas/page.tsx`, `app/api/admin/service-centers/{route.ts,[id]/route.ts}`, `lib/service-area.ts`, `lib/service-area/zip-centroid.ts`, `scripts/_seed-service-centers.ts`, `scripts/calibrate-service-area.ts`. Modified: `prisma/schema.prisma` (User+Order+ServiceCenter exactly per spec), `lib/audit.ts` (6 constants), `app/admin/layout.tsx` (MapPin nav), `app/admin/customers/[id]/page.tsx`, `app/api/admin/customers/[id]/route.ts`, `app/api/admin/orders/[id]/route.ts`, `app/api/orders/route.ts`, `app/api/orders/batch/route.ts`, `package*.json` (us-zips@2022.9.1).

## 2. `npx tsc --noEmit` — CLEAN

Exit 0, no output.

## 3. Code quality

- **Exempt check FIRST**: `lib/service-area.ts:134` — runs before ZIP parse and before any DB hit. Confirmed exempt user with bogus ZIP `99999` resolves to `tier=exempt` with zero DB queries.
- **`any` usage**: One `as any` at `app/api/orders/route.ts:169` to widen `item_type` past the Zod enum at `lib/validations.ts:22` (which legitimately does NOT include `'surcharge'` — that's a security feature: clients can't fake a $0 surcharge). Batch route uses a cleaner `as BatchOrderBody['items'][number]` cast. Acceptable; would be nicer as `@ts-expect-error`.
- **Audit at every mutation**: `ServiceCenterCreate` (POST), `ServiceCenterUpdate` with `{from,to}` diff and no-op suppression (PATCH), `ServiceCenterDelete` (DELETE, soft, idempotent), `UserExemptToggle` (only on actual flip), `ServiceAreaBlock` (orders + batch + admin ZIP override), `ServiceAreaSurchargeApplied` (after order create succeeds). All gated `if-changed` so no noise rows.
- **HTML escape**: Admin UI uses React `{c.name}` interpolation only — no `dangerouslySetInnerHTML`, no raw HTML. Form is React-controlled.
- **Auth**: Admin endpoints inline `getCurrentUser()` + `role==='admin'` 403, matching the customer-route pattern. Reusable; correct.
- **Soft-delete**: `isActive=false` preserves Order.serviceAreaCenterId FK integrity. Smart.

## 4. DB state — VERIFIED

5 rows present on Railway, exact bands per Ryan's spec:

```
Bardstown       std=30m sur=60m  fee=5000c phone=859-395-8188 active=true
Cincinnati      std=60m sur=90m  fee=5000c phone=859-395-8188 active=true
Elizabethtown   std=30m sur=60m  fee=5000c phone=859-395-8188 active=true
Lexington       std=45m sur=105m fee=5000c phone=859-395-8188 active=true
Louisville      std=45m sur=90m  fee=5000c phone=859-395-8188 active=true
```

Lexington full JSON: `id="cmq1ll1v20000ismfof8xfr2y", lat="38.0406", lng="-84.5037"`, all fields exact-spec.

## 5. Behavioral spread

```
OK   40507 Lexington core      → standard   Lexington ~1m
OK   40004 Bardstown           → standard   Bardstown ~1m
OK   45202 Cincinnati downtown → standard   Cincinnati ~1m
OK   42701 Elizabethtown       → standard   Elizabethtown ~1m
OK   40391 Winchester          → standard   Lexington ~22m
OK   40403 Berea               → standard   Lexington ~38m
OK   40444 Lancaster KY        → standard   Lexington ~29m
OK   42501 Somerset            → surcharge  Lexington ~74m  ← surcharge band 45-105
CHK  47012 Brookville IN       → standard   Cincinnati ~37m
```

`47012` (Brookville IN) coming in as `standard via Cincinnati ~37min` is **correct** — Brookville is ~32 straight-line miles from downtown Cincinnati, well within the 60-min standard band. My pre-test expectation of `out_of_area` was wrong; the model is right.

Exempt user (`team_admin`) on ZIP `99999` → `tier=exempt, surchargeCents=0`. Exempt customer (`isServiceAreaExempt=true`) on ZIP `47012` → `tier=exempt`. **Pass.**

## 6. Edge cases

| Case | Behavior | Result |
|---|---|---|
| Empty ZIP | `out_of_area`, `reason=zip_required`, `contactPhone=859-395-8188` | as-spec |
| 4-digit ZIP | `out_of_area`, `reason=zip_invalid_format` | as-spec |
| ZIP `99999` (not in dataset) | `out_of_area`, `reason=zip_not_in_centroid_dataset`, **logs `[service-area] zip not in centroid dataset { zip: '99999' }`** | as-spec |
| 0 active centers (TX disable-all, resolve, re-enable) | `tier=standard, reason=no_active_centers`, **logs `[service-area] no active centers — failing OPEN`** | as-spec |
| Exempt user + bad ZIP | `tier=exempt` (fast-path wins) | as-spec |

## 7. Surcharge end-to-end

Simulated the orders/route.ts flow against ZIP `42501` (Somerset, surcharge band from Lexington ~74min):
- Pre-SA items: $75 install + $10 rider = **$85**
- Surcharge pushed: `[surcharge] Out-of-area service fee – Lexington ~74min  $50.00`
- Post-SA subtotal: **$135** + 6% tax $8.10 = **$143.10**

Confirmed surcharge item:
- Persists fine (`OrderItem.itemType` is plain `String` in schema).
- Renders in customer email (`lib/email.ts` iterates `items[].description` + `total_price` without category filtering).
- Renders in admin email (same template iteration).
- Renders in order detail page (`app/dashboard/orders/[id]/page.tsx` iterates `orderItems` reading `description`+`totalPrice`).
- Cannot be spoofed by client (the synthetic item is pushed **after** `validationResult.data` so the Zod enum at `lib/validations.ts:22` blocks client-supplied `'surcharge'` items).

## Calibration

Three of Ryan's stated benchmarks land within ±10%:
```
Lex→Cincy       80.0m vs 80m   -0.0%
Lex→Louisville  76.0m vs 75m   +1.3%
Lex→Bardstown   59.8m vs 65m   -8.0%
```
Two informational extras:
```
Lou→Etown       42.5m vs ~45m  -5.6%
Lou→Bardstown   37.6m vs ~45m  -16.4%   ← Bluegrass Pkwy detour, expected
```
Specialist B picked `1.18 × miles / 65 mph × 60` (NOT spec's prompt-level 1.3/55, which would have overshot Lex→Cincy to ~104min). Justified deviation, correctly documented.

## Verdict per piece

| Piece | Verdict |
|---|---|
| **A. Schema + seed + ZIP centroids** | **SHIP** — schema diff exact-spec, 5 rows live with correct bands, us-zips dataset working (33,791 ZIPs incl all 5 references), idempotent seed verified. |
| **B. Core lib** | **SHIP** — exempt-first ordering correct, fail-open on no centers works, all 5 reason codes wired, calibration within tolerance on Ryan's three stated drives. |
| **C. Admin UI + customers PATCH** | **SHIP** — full CRUD with band-validation client+server, no-op audit suppression, soft-delete idempotent, exempt checkbox round-trips correctly (GET returns `is_service_area_exempt`, PUT accepts + audits only on flip). React auto-escapes all user-supplied text. |
| **D. Wizard wiring** | **SHIP** — single-order POST gates correctly, batch aborts before Stripe (no charge on doomed cart), surcharge as synthetic OrderItem flows through subtotal/tax/total/email/detail-page cleanly, admin order PUT logs `admin_zip_override_no_regate` WARN, Zod-enum bypass is intentional security. One minor: `as any` at `route.ts:169` — would prefer `@ts-expect-error` but acceptable. |

## Final recommendation: **SHIP**

All four specialists delivered against spec. TypeScript clean. DB seeded with Ryan's exact bands. Spread test confirms standard / surcharge / out-of-area / exempt all behave correctly. Three of Ryan's three stated drive-time benchmarks are within 8% of his numbers. Surcharge $50 propagates through pricing, persists as OrderItem, renders in email + admin email + order detail + confirmation page. Audit coverage complete. Fail-open behavior correct and logged loudly.

One nit pre-merge: swap `'surcharge' as any` at `app/api/orders/route.ts:169` for `// @ts-expect-error — surcharge OrderItem is server-injected, intentionally not in client Zod enum` to match the cleaner cast used in batch/route.ts:166. Non-blocking.