# Out-of-area fee by route miles — design (APPROVED, building)

**Status:** approved, in build · **Requested:** Ryan, Slack 2026-09-08 ("Instead of drive time, let's go off miles… based on route, not straight line") · **Scouted:** 2026-09-08 · **Ryan answered:** 2026-09-08 · **Tanner go:** 2026-09-19

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

## Ryan's answers (2026-09-08) — LOCKED

1. **Per trip.** "This is all per trip. So they'll be charged this fee again upon pickup just like now." → `total = trip × 2`, keeping the existing 50/50 split and `serviceAreaSecondChargeCents`. The $45 example is $45 at install and $45 at pickup.
2. **No hard cutoff.** "At $2 a mile if we go 100 miles, that's $200… leave it open for now and let's let the agent decide how much they want us to drive." → **the distance-based `out_of_area` refusal is removed.** Every reachable address gets a price.
   - ⚠️ `out_of_area` must still be returned for the NON-distance reasons: `zip_required`, `zip_invalid_format`, `zip_not_in_centroid_dataset`. Those are "we can't price this", not "too far". Only `all_centers_out_of_area` goes away.
3. **Middletown and Dayton are full service points.** "Essentially we're going to be servicing Dayton and Cinci. Middletown is quite literally in the middle so it's a way to service those 'middle towns' without needing to expand Cinci and Dayton itself."
4. **No policy re-acceptance.** "I wouldn't worry about resigning or reaccepting… it'll confuse people potentially again especially w all the numbers and math. Let's keep it as is and I'll handle those that have questions."
   → **Do NOT bump `CURRENT_NOTICE_VERSION`** and do NOT reword `lib/policy-notices.ts`. Nobody re-accepts.
   → But the *dynamic* fee line on the review step still shows the real computed amount and mileage, otherwise an agent reads "$25" and gets charged $45. Static consent text stays as-is; only the live quote is accurate. Flagged to Ryan.

## Also in scope (Tanner, 2026-09-19)

**Drop the blanket `team_admin` out-of-area exemption.** `lib/service-area.ts:256-258` currently returns `tier: 'exempt'` for ANY `role === 'team_admin'`, so every broker order skips the distance math entirely — confirmed on order `PPI-MTSSKOFZ-AKCL` (309 West Main Street, Blanchester OH, Redfin): `serviceAreaSurchargeCents: 0`, `serviceAreaCenterId: null`, `serviceAreaDriveMinutes: null`. Ryan reported two of these (2026-09-14, 2026-09-15).

Of the 4 exempt accounts only **Semonin** has `isServiceAreaExempt: true` actually set; Redfin, Rock N' Realty and Test are exempt purely for being `team_admin`. The per-account flag is the intended mechanism, so:

```ts
// before
if (input.user && (input.user.role === 'team_admin' || input.user.isServiceAreaExempt))
// after
if (input.user && input.user.isServiceAreaExempt)
```

Result: Semonin stays exempt via its flag; Redfin and the other brokers start paying. No schema change. **This is a live billing change for 3 broker accounts — it goes in the same adversarial review as the fee rewrite.**

## Effort
≈2 days incl. review and a Railway check against real addresses (Ryan's list of past out-of-area orders as the fixture).
