# Pink Posts Service-Area Gating — Implementation Spec

Branch: `ryan-feedback-2026-06-02` (head 0991efc). Target ≤ 6h.

---

## 1. Schema (Prisma)

**File:** `prisma/schema.prisma`

```prisma
model ServiceCenter {
  id                String   @id @default(cuid())
  name              String   @unique
  addressLine       String?  @map("address_line")
  city              String
  state             String   @db.VarChar(2)
  zip               String   @db.VarChar(5)
  lat               Decimal  @db.Decimal(9, 6)
  lng               Decimal  @db.Decimal(9, 6)
  standardMinutes   Int      @map("standard_minutes")            // upper bound of standard band
  surchargeMinutes  Int      @map("surcharge_minutes")           // upper bound of surcharge band; > this = out_of_area
  surchargeCents    Int      @default(5000) @map("surcharge_cents")
  contactPhone      String   @default("859-395-8188") @map("contact_phone")
  isActive          Boolean  @default(true) @map("is_active")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@map("service_centers")
  @@index([isActive])
}
```

**Add to User** (after existing `role` field):
```prisma
isServiceAreaExempt Boolean @default(false) @map("is_service_area_exempt")
```

**Add to Order** (mirrors `noPostSurcharge` at schema.prisma:398):
```prisma
serviceAreaSurchargeCents Int @default(0) @map("service_area_surcharge_cents")
serviceAreaCenterId       String? @map("service_area_center_id")
```
Rationale: dedicated column, symmetric with existing surcharges. NOT a fake OrderItem (Explorer A recommendation).

**Seed** (`prisma/seed.ts` — append, idempotent via `upsert` on `name`):

| name | city | state | zip | lat | lng | stdMin | surMin |
|---|---|---|---|---|---|---|---|
| Lexington     | Lexington     | KY | 40507 | 38.0406 | -84.5037 | 45 | 105 |
| Cincinnati    | Cincinnati    | OH | 45202 | 39.1031 | -84.5120 | 60 | 90  |
| Elizabethtown | Elizabethtown | KY | 42701 | 37.6940 | -85.8591 | 30 | 60  |
| Louisville    | Louisville    | KY | 40202 | 38.2527 | -85.7585 | 45 | 90  |
| Bardstown     | Bardstown     | KY | 40004 | 37.8089 | -85.4669 | 30 | 60  |

All `surchargeCents=5000`, `contactPhone='859-395-8188'`, `isActive=true`.

**New `AuditAction` constants** (`lib/audit.ts:69-91`):
```ts
ServiceCenterCreate:        'service_center.create',
ServiceCenterUpdate:        'service_center.update',
ServiceCenterDelete:        'service_center.delete',
UserExemptToggle:           'user.service_area_exempt_toggle',
ServiceAreaBlock:           'service_area.block',
ServiceAreaSurchargeApplied:'service_area.surcharge_applied',
```

---

## 2. Core lib

**File:** `lib/service-area.ts`

```ts
export type Tier = 'standard' | 'surcharge' | 'out_of_area' | 'exempt';

export interface ResolveInput {
  zip: string | null | undefined;
  user: { id: string; role: string; isServiceAreaExempt: boolean } | null;
}

export interface ResolveResult {
  tier: Tier;
  surchargeCents: number;                     // 0 unless tier === 'surcharge'
  contactPhone?: string;                      // present when tier === 'out_of_area'
  decidedBy?: { centerId: string; centerName: string; driveTimeMinutes: number };
  reason?: 'zip_required' | 'zip_invalid_format' | 'zip_not_in_centroid_dataset'
         | 'no_active_centers' | 'all_centers_out_of_area';
}

export async function resolveServiceArea(input: ResolveInput): Promise<ResolveResult>;

// Test helpers — exported:
export function haversineMiles(a: LatLng, b: LatLng): number;
export function estDriveMinutes(miles: number): number;       // miles * 1.18 / 65 * 60 (Explorer B tuned)
export function normalizeZip(raw: string): string | null;     // trim, slice 0..5, /^\d{5}$/ or null
```

**Algorithm:**
1. Exempt fast-path: `user && (user.role === 'team_admin' || user.isServiceAreaExempt)` → `{tier:'exempt', surchargeCents:0}`. No DB hit.
2. `normalizeZip(zip)` → null → `{tier:'out_of_area', reason:'zip_required'|'zip_invalid_format', contactPhone:DEFAULT_PHONE}`.
3. `getZipCentroid(zip)` (from `lib/service-area/zip-centroid.ts` — wraps `us-zips/object`, Explorer B) → null → `{tier:'out_of_area', reason:'zip_not_in_centroid_dataset', contactPhone:DEFAULT_PHONE}`.
4. `prisma.serviceCenter.findMany({where:{isActive:true}})`. Empty → fail-OPEN: `{tier:'standard', surchargeCents:0, reason:'no_active_centers'}` + `console.warn`.
5. For each center: `minutes = estDriveMinutes(haversineMiles(zipLL, centerLL))`. Per-center tier:
   - `minutes <= standardMinutes` → standard
   - `minutes <= surchargeMinutes` → surcharge
   - else → out_of_area
6. **Best-tier wins** (Standard > Surcharge > Out). Track winning center.
7. surcharge → `surchargeCents = decidedBy.center.surchargeCents`. out_of_area → `contactPhone = first active center's contactPhone` (all same per spec).

`DEFAULT_PHONE = '859-395-8188'` constant in this file (used when no centers exist or pre-DB rejects).

---

## 3. API endpoints

### Admin CRUD — `/api/admin/service-centers`

**File:** `app/api/admin/service-centers/route.ts`
- `GET` → `{ centers: ServiceCenter[] }` (active + inactive). Admin-only.
- `POST` body: `{ name, addressLine?, city, state, zip, lat, lng, standardMinutes, surchargeMinutes, surchargeCents?, contactPhone? }`. Zod. Default surchargeCents=5000, contactPhone=DEFAULT_PHONE. Audit `ServiceCenterCreate`. Returns `{ center }`.

**File:** `app/api/admin/service-centers/[id]/route.ts` (params Promise per CLAUDE.md):
- `GET` → `{ center }`.
- `PATCH` body partial of POST fields + `isActive`. Audit `ServiceCenterUpdate` with `{before, after}` diff.
- `DELETE` → soft delete: `update({isActive:false})`. Audit `ServiceCenterDelete`.

Auth: inline `getCurrentUser()` + `role==='admin'` 403 pattern (Explorer C, mirroring `app/api/admin/customers/[id]/route.ts:248-255`).

### Extend customer PATCH

**File:** `app/api/admin/customers/[id]/route.ts` (~L258-264 allowlist):
```ts
if (body.is_service_area_exempt !== undefined) {
  updateData.isServiceAreaExempt = Boolean(body.is_service_area_exempt);
}
```
After update, if the value changed, emit `AuditAction.UserExemptToggle` with `{from, to}` next to existing role-change audit (~L312-321).

---

## 4. Admin UI

**File:** `app/admin/service-areas/page.tsx` (`'use client'`)
- Mirror `app/admin/customers/[id]/page.tsx` patterns: `<Modal title="Add Service Center">` / `"Edit Service Center"`, native `confirm()` for delete (Explorer C §3).
- Table cols: Name, City/State, Standard ≤, Surcharge ≤, Fee, Phone, Active, Actions (Edit / Deactivate).
- Form fields: `<Input label>` for text/numeric, `<select>` for state. Numeric inputs accept minutes (not h:m); display helper text "minutes".
- Surcharge fee input takes dollars (UI), converts to cents on submit.

**Nav entry:** insert in `app/admin/layout.tsx:22-29` between Inventory and Settings:
```ts
{ href: '/admin/service-areas', label: 'Service Areas', icon: MapPin },
```

**Customer Edit modal** (`app/admin/customers/[id]/page.tsx`):
- State (~L80-92): add `isServiceAreaExempt: boolean`.
- Hydrate (~L113-119): `isServiceAreaExempt: customer.isServiceAreaExempt ?? false`.
- PUT body (~L134-140): `is_service_area_exempt: editForm.isServiceAreaExempt`.
- UI: insert between L1076 and L1077 — labeled checkbox "Exempt from out-of-area fee (relationship customer)".

---

## 5. Wizard wiring

### `app/api/orders/route.ts`

After the `validateScheduling` block (L132), BEFORE pricing (L135):

```ts
// WHY: payer (actor) gets the exemption per Ryan — they're the wallet.
const sa = await resolveServiceArea({ zip: orderData.property_zip, user: actor });

if (sa.tier === 'out_of_area') {
  await audit({ actor, action: AuditAction.ServiceAreaBlock,
    targetType: 'order', metadata: { zip: orderData.property_zip, reason: sa.reason }, request });
  return NextResponse.json({
    error: `We don't currently service ZIP ${orderData.property_zip}. Please call ${sa.contactPhone} to discuss options.`,
    code: 'service_area_unavailable',
    phone: sa.contactPhone,
  }, { status: 400 });
}
```

Pricing block (~L177, where `noPostSurcharge` is computed): add
```ts
const serviceAreaSurchargeCents = sa.tier === 'surcharge' ? sa.surchargeCents : 0;
```
Add to `taxableAmount` (L180) and `total` (L238). Persist `serviceAreaSurchargeCents` + `serviceAreaCenterId: sa.decidedBy?.centerId ?? null` on Order.create (L361-368).

After successful order create, if `sa.tier === 'surcharge'`: `audit(ServiceAreaSurchargeApplied, {centerId, centerName, driveTimeMinutes, cents: 5000})`.

### `app/api/orders/batch/route.ts`

Inside per-order loop, after `validateScheduling` (L122):
```ts
const sa = await resolveServiceArea({ zip: order.property_zip, user: actor });
if (sa.tier === 'out_of_area') {
  await audit({...ServiceAreaBlock, metadata:{orderIndex:i, zip:order.property_zip}});
  return 400 with `Order ${i+1}: ${msg}`;
}
```
Plumb `serviceAreaSurchargeCents` into `computeOrderPricing` (`lib/orders/pricing.ts:34-53`) by adding it as input to `ComputedOrderPricing` and rolling into `total` (L50). Persist at `app/api/orders/batch/route.ts:273-279`.

### `app/api/admin/orders/[id]/route.ts`
Admin edits don't re-gate ZIP changes in v1 — admins are trusted, and they often *intentionally* override. Deferred. (Document in PR.)

---

## 6. Edge cases (table)

| Case | Behavior | Audit |
|---|---|---|
| `propertyZip` null/empty | 400 `{code:'service_area_unavailable', reason:'zip_required'}` | ServiceAreaBlock w/ reason |
| ZIP fails `/^\d{5}$/` after normalize | 400, reason `zip_invalid_format` | ServiceAreaBlock |
| ZIP not in `us-zips` dataset | 400, reason `zip_not_in_centroid_dataset` | ServiceAreaBlock — **WARN log** so we add it |
| 0 active centers | Fail-OPEN: tier=standard, no fee, `console.warn('[service-area] no active centers')` | none |
| All centers compute out_of_area | tier=out_of_area, reason `all_centers_out_of_area` | ServiceAreaBlock |
| Exempt user with bad ZIP | Still passes (exempt fast-path runs before ZIP check) | none |
| Batch mixed tiers | Each order independent; per-order block returns at first failure (existing pattern) | per-order |
| Payer (actor) ≠ owner (user) | Use **actor** for exemption (Explorer A §5; matches "keep them from paying") | actor logged |

---

## 7. Deferred (out of scope)

- Inline pre-check at address-entry step in the wizard (separate polish PR)
- SMS/phone alert on `ServiceAreaBlock`
- Google/Mapbox Distance Matrix integration (haversine × 1.18 / 65 mph good enough; recalibrate after first month of data)
- Historical-order backfill of `serviceAreaSurchargeCents` / `serviceAreaCenterId` (only forward orders gated)
- Admin re-gate on `/api/admin/orders/[id]` ZIP edits

---

## Parallel work assignment (≤ 6h)

| Specialist | Files | Est. |
|---|---|---|
| **1. Schema + lib** | `prisma/schema.prisma`, migration, `prisma/seed.ts`, `lib/audit.ts` (constants), `lib/service-area.ts`, `lib/service-area/zip-centroid.ts`, install `us-zips@2022.09` | 1.5h |
| **2. Admin API** | `app/api/admin/service-centers/route.ts`, `.../[id]/route.ts`, extend `app/api/admin/customers/[id]/route.ts` allowlist+audit | 1h |
| **3. Admin UI** | `app/admin/service-areas/page.tsx`, nav entry in `app/admin/layout.tsx`, exempt checkbox in `app/admin/customers/[id]/page.tsx` | 1.5h |
| **4. Wizard wiring** | `app/api/orders/route.ts`, `app/api/orders/batch/route.ts`, `lib/orders/pricing.ts` (add `serviceAreaSurchargeCents` field), client review-step display row | 1.5h |

**Sequencing:** Specialist 1 must land schema migration + `lib/service-area.ts` skeleton before 2/3/4 can compile against the model. Once `npx prisma migrate dev` + `lib/service-area.ts` exports `resolveServiceArea` (even stubbed `{tier:'standard'}`), 2/3/4 run fully parallel. Final `npx tsc --noEmit` gate before PR.

**Buffer:** 30 min for the integration merge + tsc fixes.