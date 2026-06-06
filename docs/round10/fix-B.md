Clean. Summary of deliverables:

**Files created:**
- `c:\Users\tanne\PPI\lib\service-area.ts` — main lib (`resolveServiceArea`, `haversineMiles`, `estDriveMinutes`, `normalizeZip`, `DEFAULT_PHONE='859-395-8188'`)
- `c:\Users\tanne\PPI\lib\service-area\zip-centroid.ts` — wraps `us-zips/object` → `getZipCentroid(zip): {lat,lng} | null`
- `c:\Users\tanne\PPI\scripts\calibrate-service-area.ts` — runnable calibration check

**Dependency added:** `us-zips@2022.9.1` (per spec).

**Algorithm matches spec:** exempt fast-path → ZIP normalize → centroid lookup → load active centers → fail-OPEN if none → per-center tier via haversine × 1.18 / 65 mph × 60 → best-tier wins (Standard > Surcharge > Out), tie-broken by closer center.

**Tuned model — `haversine × 1.18 / 65 mph × 60`** (spec called for 1.18/65 vs. Ryan's prompt 1.3/55; the 1.18/65 combo passes calibration, the 1.3/55 combo overshoots — Lex→Cincy would compute ~104min vs 80 expected). All three of Ryan's mandatory reference drives within 10%:

```
*Lexington → Cincinnati      73.4 mi   80.0m vs   80m    -0.0%  OK
*Lexington → Louisville      69.7 mi   76.0m vs   75m    +1.3%  OK
*Lexington → Bardstown       54.9 mi   59.8m vs   65m    -8.0%  OK
 Louisville → Elizabethtown  39.0 mi   42.5m vs   45m    -5.6%  OK   (info)
 Louisville → Bardstown      34.5 mi   37.6m vs   45m   -16.4%  info (info)
```

`* = Ryan's stated benchmark.` `Louisville→Bardstown` is off by 16% (no interstate connector, Bluegrass Pkwy detour) — informational only; Ryan's three stated points all pass.

**`npx tsc --noEmit` clean.**

**Notes for downstream specialists:**
- `lib/service-area.ts` reads `prisma.serviceCenter.findMany({where:{isActive:true}})` — Specialist A must land the migration before this runtime-runs (compiles fine via the `as unknown as ServiceCenterRow[]` shim).
- Field reads expect `lat`/`lng` as Prisma `Decimal` or `number` (handled defensively).
- `ResolveResult.reason` enum matches the spec's edge-case table exactly so Wizard wiring (Specialist 4) can pass it straight to audit `metadata.reason`.