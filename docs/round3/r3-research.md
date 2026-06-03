I have enough information to write the design doc. TodoWrite isn't relevant here since this is a single deliverable (a design memo).

---

# Rural-Area Surcharge — Design Doc

## 1. Problem

PPI installs yard signs across Kentucky and adjacent states. Crews lose 30-90 min of round-trip drive time for orders that fall outside the metro/suburban core, and that cost isn't currently priced in. Goal: flag "extreme rural" install addresses at checkout, add a flat **$20 rural surcharge**, show it transparently to the customer, and let admins waive it.

## 2. Approaches Considered

### A. USDA RUCA codes (ZIP-level lookup table)
- **Source:** USDA ERS Rural-Urban Commuting Area Codes, 2020 release (most recent update Dec 2025). Free, public-domain, downloadable XLSX with ~41k ZCTA rows. Primary codes 1-10: 1/4/7 are urban cores, 10 is the most isolated rural (commuting flow not to any urban area). Codes 8-10 broadly map to "rural enough that drive time hurts."
- **Integration:** One-time import into a `rural_zip` table. No runtime API call.
- **Update cadence:** Decennial (next refresh ~2032). A yearly ops task can re-import; the data essentially doesn't change.
- **Accuracy:** ZIP-level. ZCTAs in KY tend to be tight enough that the worst false-positive/negative is a few miles. Good enough for a $20 line item; not good enough for $200.
- **Cost to build:** ~2 hrs (download, import, helper).

### B. Census urbanized-area shapefile + point-in-polygon
- **Source:** Census Bureau 2020 TIGER/Line Urban Area Geodatabase. Also free. Address gets geocoded, lat/lon checked against urban polygons; "outside any urban area" == rural.
- **Integration:** Requires a geocoder call (Census Geocoder is free, batch up to 10k) plus GIS lib (PostGIS or Turf.js) to do point-in-polygon. Doable but adds an async dependency and infra weight.
- **Accuracy:** Highest — address-level, not ZIP-level. Catches the suburb-vs-corn-field boundary cleanly.
- **Cost to build:** ~1-2 days. PostGIS setup, polygon import (~100 MB), geocode-on-checkout flow, fallback if geocoder is down.

### C. Driving distance from a fixed origin (Louisville)
- **Source:** Google Maps Distance Matrix or Mapbox. Paid per call (~$5/1k).
- **Integration:** API call at checkout. Single number, simple threshold.
- **Accuracy:** Proxies drive time well — which is *what we actually care about* — but tied to one origin. If PPI adds a second crew base (Lexington, Nashville), the model breaks. Also: rural NE Kentucky is far from Louisville but PPI may not serve it at all; suburban Cincinnati is far from Louisville but is dense.
- **Cost to build:** ~3 hrs but ongoing per-order API cost and key management.

### D. Population density from ZIP-level Census ACS
- **Source:** Census ACS, free. Compute density = population / land area.
- **Integration:** ZIP lookup table.
- **Accuracy:** Crude. A ZIP with one dense town and lots of empty land averages out wrong. RUCA already encodes a smarter version of this signal (it accounts for commuting flows, not just density), so this is strictly worse than A.

## 3. Recommendation: **Approach A (RUCA ZIP lookup)**

**Why:**
- Free, public, no runtime dependency, no API key, no rate limit.
- ZIP-level accuracy is appropriate for a $20 surcharge — the failure mode of a borderline ZIP being miscategorized costs $20, not a refund.
- Maps onto the existing order flow (we already capture ship-to ZIP).
- Trivial to override: a single boolean on the order.

**Threshold:** classify a ZIP as `rural_surcharge_zip = true` when its primary RUCA code is in **{8, 9, 10}**. Rationale: codes 1-7 cover metropolitan cores, micropolitan cores (e.g., Bowling Green, Owensboro), their commuting suburbs, and small-town cores themselves. 8-10 are the tracts where a crew is genuinely driving past corn for the last 20 minutes. Tune by spot-checking ~20 KY ZIPs against Google Maps drive time from Louisville before launch.

**Upgrade path:** If ZIP-level proves too coarse (we hear complaints from suburban borderline customers), Approach B (Census urbanized polygons + geocode) is a drop-in replacement behind the same helper signature.

## 4. Schema Changes

```
-- New static lookup table, seeded once from USDA RUCA XLSX
CREATE TABLE rural_zip (
  zip            VARCHAR(5) PRIMARY KEY,
  ruca_primary   SMALLINT NOT NULL,
  is_surcharge   BOOLEAN  NOT NULL,        -- ruca_primary IN (8,9,10)
  loaded_at      TIMESTAMP NOT NULL DEFAULT now()
);

-- Order changes
ALTER TABLE orders ADD COLUMN rural_surcharge_cents   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN rural_surcharge_waived  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN rural_surcharge_reason  TEXT;   -- 'ruca_8' | 'manual_admin' | NULL
```

Surcharge amount lives on the order (not just computed on the fly) so historical orders stay correct if the rate ever changes.

**Settings:** a single row in the existing `app_settings` table (or env var if no such table exists):
```
rural_surcharge_cents   = 2000
rural_surcharge_enabled = true
```

## 5. Helper Signature

```ts
// server/lib/ruralSurcharge.ts
type RuralSurchargeResult = {
  applies: boolean;
  amount_cents: number;     // 0 if !applies
  reason: 'ruca_8' | 'ruca_9' | 'ruca_10' | null;
};

export async function classifyAddress(
  zip: string,
  opts?: { adminWaive?: boolean }
): Promise<RuralSurchargeResult>;
```

Called from:
- Order pricing recalculation (whenever address or items change in the wizard).
- Cart total computation.
- Admin order-edit page.

Pure read of `rural_zip` + `app_settings`. No network, no async I/O beyond the DB.

## 6. UI

**Checkout pricing summary** — add a line item between subtotal and tax:

```
Subtotal                $145.00
Rural delivery fee       $20.00  (?)
Tax                       $9.90
─────────────────────────────────
Total                   $174.90
```

The `(?)` is a tooltip / popover: *"Your install address is in a rural area where round-trip drive time is significantly longer. This $20 fee covers the extra travel. Contact us if you think this was applied in error."*

Line item only renders when `rural_surcharge_cents > 0`. If `rural_surcharge_waived`, render struck-through with "Waived" label so the customer sees the goodwill.

**Address-entry feedback** — show the surcharge *as soon as* the ZIP validates in the wizard, not as a surprise at the final review step. Same pattern as showing shipping cost early in e-commerce.

## 7. Admin Override

On the admin order detail page, beneath the totals block:

```
[ Rural surcharge: $20.00 applied (RUCA 9) ]
  [ Waive surcharge ]  ← button
  Note: __________________________
```

Clicking Waive sets `rural_surcharge_waived = true`, zeroes `rural_surcharge_cents`, records the admin user + timestamp + note in an audit row (`order_adjustments` if it exists, else a simple `order_audit_log`). Re-totaling the order recomputes tax on the new subtotal.

Admins should also be able to **add** the surcharge on an order that didn't auto-flag (edge case: a ZIP we miscategorized, or a job we know is going to a back road). Same UI, inverted button: "Apply rural surcharge".

## 8. Rollout Plan

1. Import RUCA ZIP file into `rural_zip`. Seed migration.
2. Ship the helper + schema behind `rural_surcharge_enabled = false`. No customer-facing change.
3. Backfill: dry-run against last 90 days of orders. Spot-check the flagged ZIPs against Google Maps drive time from PPI's HQ. Adjust threshold (maybe codes 9-10 only) if too aggressive.
4. Enable flag. Watch support tickets for one week.
5. If complaints cluster on a specific ZIP, just flip its `is_surcharge` flag manually — no code deploy needed.

## 9. Edge Cases / Open Questions

- **PO boxes and military APO ZIPs** — exclude from rural classification (these aren't install addresses anyway, but defense in depth).
- **ZIPs split across rural/urban** — RUCA assigns one primary code per ZIP based on majority population. Accepting that as our truth.
- **Multi-state expansion** — RUCA covers all US ZIPs, so no work needed if PPI starts serving TN/IN/OH.
- **Drive time vs distance** — RUCA correlates with drive time better than pure distance does (it weights commuting flows). Good enough proxy.
- **Should the surcharge scale?** Out of scope. Single flat $20 per the brief. Future tiered version (`$20` for codes 8-9, `$40` for 10) is a one-line config change.

## 10. Estimate

- Schema + migration: 1 hr
- RUCA import script: 1 hr
- Helper + tests: 1.5 hr
- Wizard pricing integration + tooltip: 1.5 hr
- Admin override UI + audit: 2 hr
- QA + spot-check tuning: 1 hr

**Total: ~8 hr / 1 day of focused work.**

---

## Sources

- [USDA ERS — Rural-Urban Commuting Area Codes (2020, updated Dec 2025)](https://www.ers.usda.gov/data-products/rural-urban-commuting-area-codes)
- [USDA ERS — RUCA Documentation (primary code definitions)](https://www.ers.usda.gov/data-products/rural-urban-commuting-area-codes/documentation)
- [US Census Bureau — 2020 Urban-Rural Classification](https://www.census.gov/programs-surveys/geography/guidance/geo-areas/urban-rural.html)
- [US Census Geocoding Services API (free, batch up to 10k)](https://geocoding.geo.science.gov/geocoder/Geocoding_Services_API.html)
- [WWAMI RHRC — RUCA reference and rural definitions](https://familymedicine.uw.edu/rhrc/ruca/)
- [WA DOH — Guidelines for Using Rural-Urban Classification Systems (threshold guidance)](https://doh.wa.gov/sites/default/files/legacy/Documents/1500/RUCAGuide.pdf)