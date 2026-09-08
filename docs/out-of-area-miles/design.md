# Out-of-area fee by route miles — design (PLAN, awaiting Ryan's answers)

**Status:** plan · **Requested:** Ryan, Slack 2026-09-08 ("Instead of drive time, let's go off miles… based on route, not straight line") · **Scouted:** 2026-09-08

## What Ryan asked for

Per service city, a free radius in **road miles**; beyond it the **$25 fee covers up to 20 additional miles**, then **$2 per mile**. Cities: Louisville 28, Elizabethtown 10, Shelbyville 5, Lexington 20, Georgetown 10, Frankfort 9, Richmond 10, Berea 5, Cincinnati 28, Middletown OH 10, Dayton OH 17. **Bardstown removed.** Ryan's stated reason: the business loses money on drive time; miles by route also absorbs the traffic variance.

## What exists today (verified)

Everything is **minutes**. `ServiceCenter { standardMinutes, surchargeMinutes, surchargeCents=5000 }` (`prisma/schema.prisma:1078-1100`); `resolveServiceArea` (`lib/service-area.ts:254-356`) scores every active center by drive **time** (ZIP cache → haversine estimate → address cache → live Google Routes), takes the best tier, and returns a flat `surchargeCents`. Order create splits it 50/50 (`app/api/orders/route.ts:253-255`: $25 now, $25 at removal via `serviceAreaSecondChargeCents`). Google is asked only for `duration` (`lib/service-area/google-routes.ts:79` field mask) — **`distanceMeters` is never requested or cached**. Both cache tables store `driveMinutes` only. There is no free-radius/overage/per-mile concept anywhere. Centers are DB rows (admin page `/admin/service-areas`, minutes-labelled).

Customer copy that hardcodes the old rule: `review-step.tsx:1493` ("approx 45 mins+ one way… $25 per trip"), `:1512` consent checkbox ("$25 out of area fee to install… $25 to pickup"), `lib/policy-notices.ts:33` (still says "$50" and "one hour one way"; changing it needs `CURRENT_NOTICE_VERSION` bump → everyone re-accepts once).

## Recommendation

**Keep the resolver's shape (score every center, best wins), swap the unit and the fee function.**

### Data
- `ServiceCenter` gains `freeRadiusMiles Int?`, `includedOverageMiles Int @default(20)`, `perMileCents Int @default(200)`, `baseFeeCents Int @default(2500)` (per trip). Keep the minutes columns until the cut-over is verified, then drop in a later cleanup. `isActive=false` for Bardstown; seven new rows (Shelbyville, Georgetown, Frankfort, Middletown OH, Dayton OH — Berea and Richmond already exist as rows) with downtown lat/lng.
- Caches: add `driveMiles Decimal?` to `ZipDriveTimeCache` and `AddressDriveTimeCache` (same 30-day TTL). Existing rows have no miles → treated as a miss for miles (one Google call per address, cached).
- `Order` gains `serviceAreaDriveMiles Decimal?` next to `serviceAreaDriveMinutes` for the audit trail.

### Google
- Field mask adds `distanceMeters` (same Essentials SKU). Parse meters → miles (÷1609.344, 1 decimal). Haversine fallback becomes `haversineMiles × ROAD_FACTOR` when Google is unavailable (already the pattern for minutes).

### Fee
```
over  = max(0, routeMiles − freeRadiusMiles)          // per center, best (lowest over) wins
trip  = over === 0 ? 0 : baseFeeCents + max(0, over − includedOverageMiles) × perMileCents
total = trip × 2 (install + pickup) — or trip × 1 if Ryan answers "one fee" (Q1)
```
Returned as `surchargeCents = total` so the existing 50/50 split and `serviceAreaSecondChargeCents` keep working unchanged; the second charge already reads the stored cents (`lib/orders/out-of-area-charge.ts`), so a variable fee needs no change there. Tier: `standard` (over = 0) / `surcharge` (over > 0) / `out_of_area` only if Q2 says a hard cutoff exists.

### Surfaces
- Review step: fee line shows "`41` road miles from Lexington (`21` over the free `20`)"; consent text becomes "$X out of area fee to install, $X to pickup" with the computed amount; explainer rewritten in miles. Policy notice reworded + version bump.
- Admin service-areas page: miles fields, validation `freeRadius ≥ 0`, helper copy in miles; the quote endpoint returns `driveMiles` + `overMiles` for the admin suffix.
- Batch/cart path (`batch/route.ts:257-268`) charges the full amount in one line with no split — pre-existing divergence; align it to the same helper as part of this so team carts get the same fee as single orders.
- Marketing FAQ city list + contact county list updated to the new cities.

### Ship order
1. schema (additive, `db push`) → 2. Google mask + caches → 3. fee helper with unit tests against Ryan's examples → 4. resolver → 5. create/batch/edit → 6. copy + admin page → 7. seed the 11 centers + deactivate Bardstown (script run by Tanner) → 8. adversarial review (money) → 9. Slack.

## Questions for Ryan (asked 2026-09-08)
1. Per trip or once? (Today $25 install + $25 pickup.) A $45 example: $45 at install **and** $45 at pickup, or $45 total?
2. Hard "too far, call us" cutoff, or every address priced at $2/mile?
3. Middletown and Dayton as full service points (free radius) or just far-out markers priced from Cincinnati? Assumed full.

## Effort
≈2 days incl. review and a Railway check against real addresses (Ryan's list of past out-of-area orders as the fixture).
