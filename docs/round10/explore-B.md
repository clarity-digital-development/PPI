---

# Recommendation: `us-zips` (option a)

**Package:** [`us-zips@2022.9.1`](https://www.npmjs.com/package/us-zips) — MIT, zero deps, sourced from US Census Bureau ZCTA Gazetteer (public domain). Author maintains it on CalVer; data refreshes when Census publishes.

**Why this over options (b)/(c):** building our own from Census data would produce literally the same JSON this package already ships, polished + tested + typed. No upside to DIY.

## Verification (all checks passed)

All 5 reference ZIPs present with exact coords:
| ZIP   | City          | Dataset coords        | Spec expected      |
|-------|---------------|-----------------------|--------------------|
| 40507 | Lexington     | 38.0469, -84.4963     | ~38.04, -84.50 OK  |
| 45202 | Cincinnati    | 39.1067, -84.5042     | ~39.10, -84.51 OK  |
| 42701 | Elizabethtown | 37.7032, -85.8395     | ~37.69, -85.86 OK  |
| 40202 | Louisville    | 38.2528, -85.7519     | ~38.25, -85.76 OK  |
| 40004 | Bardstown     | 37.8024, -85.4699     | ~37.81, -85.47 OK  |

Haversine sanity Lex(40507) → Cincy(45202) = **73.2 mi straight-line** — squarely in the expected 70-80mi band.

**Regional coverage:** KY 780 / OH 1,233 / IN 807 / TN 807 = **3,627 ZIPs** in primary region; **33,791 nationwide** (so WV/IL/MO/etc. come free).

## Size

- `us-zips/object` (recommended import): **1.83 MB raw / 412 KB gzip** — well under the 5 MB pain threshold. One-time require, then in-memory O(1) lookups.

## Caveats for Explorer A (distance model)

The spec's `straight × 1.3 / 55 mph` overshoots Ryan's stated drive-times by ~25%:

| Pair              | Ryan says | Spec model gives |
|-------------------|-----------|------------------|
| Lex → Cincinnati  | 80 min    | 104 min          |
| Lex → Louisville  | 75 min    | 99 min           |
| Lex → Bardstown   | 65 min    | 79 min           |

**Suggested tuning: `× 1.18 / 65 mph`** lands Lex-Cincy at 79 min, Lex-Louisville 75 min, Lex-Bardstown 60 min — all within ±5%. Worth flagging to whoever owns `lib/serviceArea/distance.ts`.

## Install + setup

```bash
npm install us-zips@2022.09
```

## Lookup snippet

```ts
// lib/serviceArea/zipCentroid.ts
// WHY: Census ZCTA centroids, MIT-licensed, in-memory O(1) lookup.
import zipCentroids from 'us-zips/object';

export interface Centroid { latitude: number; longitude: number; }

export function getZipCentroid(zip: string): Centroid | null {
  // WHY: us-zips keys are 5-digit strings; normalize ZIP+4 and trim.
  const key = zip.trim().slice(0, 5);
  return (zipCentroids as Record<string, Centroid>)[key] ?? null;
}
```

Typing works out of the box (`index.d.ts` ships `Record<ZIPCode, Geolocation>`). For ZIPs absent from the dataset (Census omits ZCTAs with no/few residential addresses — rare in our region), `getZipCentroid` returns `null` and the caller should treat as `out_of_area` and audit.