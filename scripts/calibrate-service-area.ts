/**
 * Calibration check for lib/service-area drive-time model.
 *
 * Run: `npx tsx scripts/calibrate-service-area.ts`
 *
 * Validates that the haversine × ROAD_FACTOR / AVG_SPEED_MPH × 60 model
 * lands within ±10% of Ryan's reference drives. If any reference is off
 * by more than 10%, the script exits non-zero so CI/devs notice.
 *
 * Update the SERVICE_CENTERS coords here whenever Ryan sends a new shop
 * address — they must match what's seeded into the DB.
 */

import { haversineMiles, estDriveMinutes } from '../lib/service-area'

interface Place {
  name: string
  lat: number
  lng: number
}

const CENTERS: Record<string, Place> = {
  Lexington:     { name: 'Lexington',     lat: 38.0406, lng: -84.5037 },
  Cincinnati:    { name: 'Cincinnati',    lat: 39.1031, lng: -84.5120 },
  Elizabethtown: { name: 'Elizabethtown', lat: 37.6940, lng: -85.8591 },
  Louisville:    { name: 'Louisville',    lat: 38.2527, lng: -85.7585 },
  Bardstown:     { name: 'Bardstown',     lat: 37.8089, lng: -85.4669 },
}

interface Ref {
  from: keyof typeof CENTERS
  to: keyof typeof CENTERS
  expectedMinutes: number
  /** True = part of Ryan's stated benchmark, must pass tolerance. */
  mandatory: boolean
}

const REFERENCES: Ref[] = [
  // Ryan's 3 stated reference drives — these MUST land within tolerance.
  { from: 'Lexington', to: 'Cincinnati',    expectedMinutes: 80, mandatory: true },
  { from: 'Lexington', to: 'Louisville',    expectedMinutes: 75, mandatory: true },
  { from: 'Lexington', to: 'Bardstown',     expectedMinutes: 65, mandatory: true },
  // Extra well-known drives — informational, not part of the pass gate.
  { from: 'Louisville', to: 'Elizabethtown', expectedMinutes: 45, mandatory: false },
  { from: 'Louisville', to: 'Bardstown',     expectedMinutes: 45, mandatory: false },
]

const TOLERANCE = 0.10

let mandatoryFailed = 0
console.log('Calibration: haversine × 1.18 / 65 mph')
console.log('────────────────────────────────────────────────────────────────────')
console.log('Route                              miles   actual   expected   Δ')
for (const r of REFERENCES) {
  const a = CENTERS[r.from]
  const b = CENTERS[r.to]
  const miles = haversineMiles(a, b)
  const actual = estDriveMinutes(miles)
  const delta = (actual - r.expectedMinutes) / r.expectedMinutes
  const inTol = Math.abs(delta) <= TOLERANCE
  if (r.mandatory && !inTol) mandatoryFailed++
  const status = inTol ? 'OK' : r.mandatory ? 'OFF' : 'info'
  const pct = (delta * 100).toFixed(1).padStart(5)
  const route = `${r.from} → ${r.to}`.padEnd(34)
  const tag = r.mandatory ? '*' : ' '
  console.log(
    `${tag}${route} ${miles.toFixed(1).padStart(6)}  ${actual.toFixed(1).padStart(5)}m   ${String(r.expectedMinutes).padStart(5)}m   ${pct}%  ${status}`,
  )
}

console.log('────────────────────────────────────────────────────────────────────')
console.log("(* = Ryan's stated benchmark; others are informational)")
if (mandatoryFailed > 0) {
  console.error(`\n${mandatoryFailed} mandatory reference(s) outside ±${(TOLERANCE * 100).toFixed(0)}% tolerance.`)
  console.error('Tune ROAD_FACTOR or AVG_SPEED_MPH in lib/service-area.ts.')
  process.exit(1)
}
console.log('\nAll mandatory references within tolerance.')
