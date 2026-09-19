/**
 * Regression fixture for the out-of-area mileage rule (Ryan, Slack 2026-09-08).
 * Money rule — every case below is either Ryan's own worked example or a
 * boundary that decides whether a customer is charged. Run: npx tsx scripts/mileage-fee-check.ts
 */
import { computeMileageFee, DEFAULT_MILEAGE_CONFIG, describeMileageFee } from '../lib/service-area/mileage-fee'
let failed = false
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) failed = true }
const cfg = (freeRadiusMiles: number) => ({ freeRadiusMiles, ...DEFAULT_MILEAGE_CONFIG })
const $ = (c: number) => '$' + (c / 100).toFixed(2)

// ---- Tanner's worked examples posted to Ryan, which Ryan approved ----
// "Example from Lexington (20 free): a property 32 road miles out is 12 over -> $25."
let r = computeMileageFee(32, cfg(20))
ok(r.tripCents === 2500, `Lexington, 32mi: 12 over, within the included 20 -> ${$(r.tripCents)}/trip (expect $25.00)`)
ok(r.overMiles === 12, `  overMiles ${r.overMiles} (expect 12)`)
ok(r.billableMiles === 0, `  billableMiles ${r.billableMiles} (expect 0)`)

// "A property 50 miles out is 30 over -> $25 + 10 x $2 = $45."
r = computeMileageFee(50, cfg(20))
ok(r.tripCents === 4500, `Lexington, 50mi: 30 over, 10 billable -> ${$(r.tripCents)}/trip (expect $45.00)`)
ok(r.billableMiles === 10, `  billableMiles ${r.billableMiles} (expect 10)`)

// Ryan: "this is all per trip. So they'll be charged this fee again upon pickup"
ok(r.bothTripsCents === 9000, `  both trips ${$(r.bothTripsCents)} (expect $90.00 = 45 x 2)`)

// Ryan's own 100-mile sanity check: "at $2 a mile if we go 100 miles, that's $200"
// (his arithmetic is the per-mile band; from Lexington that's 100-20=80 over,
// 60 billable -> 25 + 120 = $145/trip. The point is only that it stays open-ended.)
r = computeMileageFee(100, cfg(20))
ok(r.tripCents === 14500, `Lexington, 100mi -> ${$(r.tripCents)}/trip, no cutoff applied`)

// ---- Boundaries ----
ok(computeMileageFee(20, cfg(20)).tripCents === 0, 'exactly at the radius -> free')
ok(computeMileageFee(19.9, cfg(20)).tripCents === 0, 'just inside the radius -> free')
r = computeMileageFee(20.1, cfg(20))
ok(r.tripCents === 2500, 'one tenth past the radius -> full $25 base kicks in immediately')
ok(computeMileageFee(40, cfg(20)).tripCents === 2500, 'exactly radius+20 -> still $25 (included band is inclusive)')
r = computeMileageFee(40.5, cfg(20))
ok(r.tripCents === 2600, `half a mile past the included band -> ${$(r.tripCents)} (expect $26.00, proportional)`)

// ---- Every city Ryan listed, just inside and just outside ----
const cities: Array<[string, number]> = [
  ['Louisville', 28], ['Elizabethtown', 10], ['Shelbyville', 5], ['Lexington', 20],
  ['Georgetown', 10], ['Frankfort', 9], ['Richmond', 10], ['Berea', 5],
  ['Cincinnati', 28], ['Middletown OH', 10], ['Dayton OH', 17],
]
for (const [name, radius] of cities) {
  const inside = computeMileageFee(radius, cfg(radius))
  const outside = computeMileageFee(radius + 25, cfg(radius))
  ok(inside.tripCents === 0 && outside.tripCents === 3500,
     `${name} (${radius}mi free): at radius free, +25 over -> ${$(outside.tripCents)}/trip (expect $35.00)`)
}

// ---- Degenerate input must never produce a negative or NaN fee ----
for (const bad of [NaN, -5, Infinity, -Infinity, 0]) {
  const b = computeMileageFee(bad as number, cfg(20))
  ok(b.tripCents === 0 && Number.isFinite(b.tripCents), `degenerate miles ${String(bad)} -> $0, finite`)
}
ok(computeMileageFee(50, { freeRadiusMiles: -10, includedOverageMiles: -5, perMileCents: -200, baseFeeCents: -2500 }).tripCents === 0,
   'negative config clamps to $0 rather than a negative fee')

// ---- Zero radius centre bills from mile zero ----
ok(computeMileageFee(5, cfg(0)).tripCents === 2500, 'radius 0: any distance triggers the base fee')

// ---- Copy ----
const desc = describeMileageFee('Lexington', 41, cfg(20), computeMileageFee(41, cfg(20)))
ok(desc === '41 road miles from Lexington (21 over the free 20)', `copy: "${desc}"`)
const inDesc = describeMileageFee('Lexington', 12, cfg(20), computeMileageFee(12, cfg(20)))
ok(inDesc.includes('inside the 20-mile service area'), `copy inside: "${inDesc}"`)
ok(!/\$/.test(desc) && !/\$/.test(inDesc), 'copy carries no dollar amount (dispatch money guard safe)')

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS'))
if (failed) process.exit(1)
