All deliverables complete.

---

**SPECIALIST A: SCHEMA + SEED + ZIP CENTROIDS — DONE**

**1. Schema diff (`c:\Users\tanne\PPI\prisma\schema.prisma`)**

Added to `User` model (after `stripeCustomerId`):
```prisma
isServiceAreaExempt Boolean @default(false) @map("is_service_area_exempt")
```

Added to `Order` model (between `noPostSurcharge` and `expediteFee`):
```prisma
serviceAreaSurchargeCents Int     @default(0) @map("service_area_surcharge_cents")
serviceAreaCenterId       String? @map("service_area_center_id")
```

Added new `ServiceCenter` model (inserted before `UserPreferenceChange`): fields `id, name @unique, addressLine?, city, state(VarChar 2), zip(VarChar 5), lat/lng Decimal(9,6), standardMinutes, surchargeMinutes, surchargeCents @default(5000), contactPhone @default("859-395-8188"), isActive @default(true), createdAt, updatedAt`. Indexed on `isActive`. Table name `service_centers`.

Added 6 new constants to `AuditAction` in `c:\Users\tanne\PPI\lib\audit.ts`:
`ServiceCenterCreate`, `ServiceCenterUpdate`, `ServiceCenterDelete`, `UserExemptToggle`, `ServiceAreaBlock`, `ServiceAreaSurchargeApplied`.

**2. DB push log (Railway live)**

```
Datasource "db": PostgreSQL database "railway", schema "public" at "yamanote.proxy.rlwy.net:50643"
Your database is now in sync with your Prisma schema. Done in 4.45s
```

`npx prisma generate` → Generated Prisma Client v7.2.0 successfully.

**3. ZIP centroid data**

Installed `us-zips@2022.9.1` (`npm install --save`). Package provides `require('us-zips/object')` → flat `{ "<zip>": { latitude, longitude } }` map with 33,791 ZIPs. Dataset file on disk: `c:\Users\tanne\PPI\node_modules\us-zips\object.js` (1.83 MB; 6.0 MB unpacked total). Sourced from public Census/USPS data per package README.

Wrapper module already present at `c:\Users\tanne\PPI\lib\service-area\zip-centroid.ts` — exports `getZipCentroid(zip)` returning `{lat, lng} | null`, imports `us-zips/object` default.

Reference ZIPs verified present:
- `40507` Lexington     → 38.046898, -84.496262
- `45202` Cincinnati    → 39.106735, -84.504181
- `42701` Elizabethtown → 37.703239, -85.839548
- `40202` Louisville    → 38.252811, -85.751946
- `40004` Bardstown     → 37.802403, -85.469858

**4. Seed script run output**

File: `c:\Users\tanne\PPI\scripts\_seed-service-centers.ts` (idempotent via `findUnique` on `name`, only inserts when missing, never clobbers admin edits).

First run against live Railway DB:
```
Seed complete: 5 created, 0 unchanged.
  created   Lexington        cmq1ll1v20000ismfof8xfr2y
  created   Cincinnati       cmq1ll1zb0001ismfs3usuqep
  created   Elizabethtown    cmq1ll2390002ismfsd4p1p14
  created   Louisville       cmq1ll27f0003ismf167x3hql
  created   Bardstown        cmq1ll2bl0004ismfn9b79qva
```

Re-run confirmed idempotent (`5 unchanged`). All 5 rows seeded with `surchargeCents=5000`, `contactPhone='859-395-8188'`, `isActive=true`, bands per spec table. Single `service_center.create` audit row written with `actorRole='system'` listing the created names.

**5. tsc**

`npx tsc --noEmit` — no errors, no output.

**Files touched/created**
- `c:\Users\tanne\PPI\prisma\schema.prisma` (modified — User, Order, new ServiceCenter)
- `c:\Users\tanne\PPI\lib\audit.ts` (modified — 6 new AuditAction constants)
- `c:\Users\tanne\PPI\scripts\_seed-service-centers.ts` (new)
- `c:\Users\tanne\PPI\package.json` + `package-lock.json` (modified — `us-zips@2022.9.1` added)
- `c:\Users\tanne\PPI\node_modules\us-zips\` (new — 1.83 MB centroid dataset)
- `c:\Users\tanne\PPI\lib\service-area\zip-centroid.ts` (already present from parallel work; verified compiles)