/**
 * Service-area gating: decide whether a property ZIP is serviceable by
 * any active ServiceCenter and, if so, at what tier (standard / surcharge
 * / out_of_area). Exempt users (team_admin or admin-flagged exempt
 * customers) bypass the whole pipeline.
 *
 * Algorithm (Round 27 — retires the ZIP-override table per Tanner
 * 2026-07-06 after Ryan flagged 40475 Richmond falsely charging Andi
 * Kelley $50 on a 34-min drive):
 *  1. Exempt fast-path (no DB hit).
 *  2. Normalize ZIP (trim, slice 0..5, /^\d{5}$/).
 *  3. ZIP centroid lookup via `us-zips` dataset.
 *  4. Load all active ServiceCenters from DB.
 *  5. For each center: drive-time minutes via THIS PRECEDENCE:
 *     a. ZipDriveTimeCache row (Google Routes seed)        ← Round 25
 *     b. else haversine miles × ROAD_FACTOR / AVG_SPEED_MPH (estimate)
 *  6. Per-center tier from standard/surcharge bands (haversine baseline).
 *  7. Address-level upgrade: if input.address is supplied AND Google API
 *     key is configured — call Routes API with the address for every
 *     center, cache it, and re-tier. Every checkout with an address hits
 *     Google Routes now — no LOOKUP_FLOOR gate, because that gate was
 *     what let close-to-Lex properties in over-broad "far ZIPs"
 *     (40475 Richmond) get patched-in via override rather than measured.
 *  8. Best-tier wins (Standard > Surcharge > Out). Track winning center.
 *
 * Drive-time model fallback: haversine miles × 1.18 road-factor / 65 mph
 * × 60. Calibrated against Ryan's reference drives (Lex→Cincy 80m,
 * Lex→Lou 75m, Lex→Bardstown 65m). Underestimates back-road drives
 * (Berea 48m → ~36m estimate) — Google Routes API on top for every
 * addressed order covers this. When address is missing (cart-preview
 * quote endpoint) haversine is the only signal available.
 */

import { prisma } from '@/lib/prisma'
import { getZipCentroid, type LatLng } from '@/lib/service-area/zip-centroid'
import { fetchDriveMinutesByAddress } from '@/lib/service-area/google-routes'
import {
  hashAddress,
  readAddressDriveTime,
  readZipDriveTime,
  writeAddressDriveTime,
} from '@/lib/service-area/drive-time-cache'

export const DEFAULT_PHONE = '859-395-8188'

// Road-network factor and average highway speed. Tuned against Ryan's
// reference drives — landed within ±10% at 1.18 / 65 mph (see calibration
// check below). Change here and re-run calibration before redeploying.
const ROAD_FACTOR = 1.18
const AVG_SPEED_MPH = 65

// Round 27 (per Tanner, 2026-07-06): drop the LOOKUP_FLOOR gate. Every
// checkout with an address goes to Google Routes. The floor was Round
// 25's cost-control move (only upgrade when haversine ≥ 35 min), but it
// left close-to-Lex properties inside "far" ZIPs uncorrected — which was
// exactly the Andi Kelley failure mode. At PPI's ~200 orders/month
// unconditional upgrade sits inside Google's 10K/month free tier with
// two orders of magnitude of headroom.
// Constant kept exported for backwards compat with any external caller.
export const LOOKUP_FLOOR_MINUTES = 0

export type Tier = 'standard' | 'surcharge' | 'out_of_area' | 'exempt'

export type ResolveReason =
  | 'zip_required'
  | 'zip_invalid_format'
  | 'zip_not_in_centroid_dataset'
  | 'no_active_centers'
  | 'all_centers_out_of_area'

export interface ResolveAddress {
  street: string
  city: string
  state: string
  zip: string
}

export interface ResolveInput {
  zip: string | null | undefined
  user: { id: string; role: string; isServiceAreaExempt: boolean } | null
  /** Full property address — when provided, enables borderline upgrade
   *  to Google Routes API for back-road accuracy. Order/batch POST
   *  handlers pass this; the cart-preview quote endpoint omits it. */
  address?: ResolveAddress | null
}

export interface DecidedBy {
  centerId: string
  centerName: string
  driveTimeMinutes: number
  /** How the drive time was determined for the winning center.
   *  'haversine_estimate' is the fallback; 'zip_cache' is the seeded
   *  cache; 'address_lookup' is a fresh borderline upgrade. */
  driveTimeSource: 'haversine_estimate' | 'zip_cache' | 'address_lookup' | 'address_cache'
}

export interface ResolveResult {
  tier: Tier
  surchargeCents: number
  contactPhone?: string
  decidedBy?: DecidedBy
  reason?: ResolveReason
}

// Minimal shape we need off ServiceCenter. Accepts plain numbers OR
// Prisma Decimal objects (which expose .toNumber()) so this stays
// decoupled from the Prisma client type that may not be generated yet.
interface ServiceCenterRow {
  id: string
  name: string
  lat: number | { toNumber(): number }
  lng: number | { toNumber(): number }
  standardMinutes: number
  surchargeMinutes: number
  surchargeCents: number
  contactPhone: string
  isActive: boolean
}

function toNum(v: number | { toNumber(): number }): number {
  return typeof v === 'number' ? v : v.toNumber()
}

/** Trim, slice 0..5, validate ^\d{5}$. Returns null on any failure. */
export function normalizeZip(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const z = String(raw).trim().slice(0, 5)
  if (!/^\d{5}$/.test(z)) return null
  return z
}

const EARTH_RADIUS_MI = 3958.7613

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Straight-line miles → estimated drive minutes using ROAD_FACTOR / AVG_SPEED_MPH. */
export function estDriveMinutes(miles: number): number {
  return (miles * ROAD_FACTOR) / AVG_SPEED_MPH * 60
}

type CenterTier = 'standard' | 'surcharge' | 'out_of_area'

function tierForCenter(minutes: number, center: ServiceCenterRow): CenterTier {
  if (minutes <= center.standardMinutes) return 'standard'
  if (minutes <= center.surchargeMinutes) return 'surcharge'
  return 'out_of_area'
}

/** Retained for backwards compat — Round 27 always upgrades when an
 *  address is provided (LOOKUP_FLOOR_MINUTES = 0), so this is now a
 *  no-op filter. Kept as a hook in case a future gate needs to skip
 *  centers on other criteria (e.g. per-center opt-out). */
function shouldUpgrade(minutes: number): boolean {
  return minutes >= LOOKUP_FLOOR_MINUTES
}

// Rank used to pick the BEST tier across multiple centers. Lower = better.
const TIER_RANK: Record<CenterTier, number> = {
  standard: 0,
  surcharge: 1,
  out_of_area: 2,
}

interface ScoredCenter {
  center: ServiceCenterRow
  minutes: number
  tier: CenterTier
  source: DecidedBy['driveTimeSource']
}

/**
 * Score one center: prefer cached ZIP drive time, fall back to haversine
 * estimate. Address-level upgrade happens later in resolveServiceArea
 * once we know which centers are borderline.
 */
async function scoreCenterFromZip(
  center: ServiceCenterRow,
  zip: string,
  zipLL: LatLng
): Promise<ScoredCenter> {
  const cached = await readZipDriveTime(zip, center.id)
  if (cached) {
    return {
      center,
      minutes: cached.driveMinutes,
      tier: tierForCenter(cached.driveMinutes, center),
      source: 'zip_cache',
    }
  }
  const centerLL: LatLng = { lat: toNum(center.lat), lng: toNum(center.lng) }
  const minutes = estDriveMinutes(haversineMiles(zipLL, centerLL))
  return {
    center,
    minutes,
    tier: tierForCenter(minutes, center),
    source: 'haversine_estimate',
  }
}

/**
 * Upgrade a borderline center's score to address-level precision via
 * cache or Google Routes. Returns the original score unchanged on any
 * failure (cache miss + no API key, API timeout, etc.) so the resolver
 * always returns a meaningful answer.
 */
async function upgradeWithAddress(
  scored: ScoredCenter,
  address: ResolveAddress,
  addressHashValue: string
): Promise<ScoredCenter> {
  const cached = await readAddressDriveTime(addressHashValue, scored.center.id)
  if (cached) {
    return {
      ...scored,
      minutes: cached.driveMinutes,
      tier: tierForCenter(cached.driveMinutes, scored.center),
      source: 'address_cache',
    }
  }
  const addressLine = `${address.street}, ${address.city}, ${address.state} ${address.zip}`
  const centerLL: LatLng = { lat: toNum(scored.center.lat), lng: toNum(scored.center.lng) }
  const live = await fetchDriveMinutesByAddress(addressLine, centerLL)
  if (live == null) return scored
  await writeAddressDriveTime(addressHashValue, scored.center.id, addressLine, live)
  return {
    ...scored,
    minutes: live,
    tier: tierForCenter(live, scored.center),
    source: 'address_lookup',
  }
}

/**
 * Resolve service tier for a (zip, user, address?) tuple.
 *
 * Exempt users skip ZIP validation entirely — Ryan's rule: "we're always
 * going to try to accommodate them" (team_admins and admin-flagged
 * relationship customers).
 *
 * Fails OPEN if no active centers exist (treat as standard, no fee) so a
 * misconfigured admin dashboard never bricks the order pipeline. Logs a
 * loud warning when that happens.
 */
export async function resolveServiceArea(input: ResolveInput): Promise<ResolveResult> {
  // 1. Exempt fast-path — no DB hit. Per Ryan, team_admins always pass.
  if (input.user && (input.user.role === 'team_admin' || input.user.isServiceAreaExempt)) {
    return { tier: 'exempt', surchargeCents: 0 }
  }

  // 2. ZIP presence + shape.
  if (input.zip == null || String(input.zip).trim() === '') {
    return { tier: 'out_of_area', surchargeCents: 0, contactPhone: DEFAULT_PHONE, reason: 'zip_required' }
  }
  const zip = normalizeZip(input.zip)
  if (!zip) {
    return { tier: 'out_of_area', surchargeCents: 0, contactPhone: DEFAULT_PHONE, reason: 'zip_invalid_format' }
  }

  // Round 27: ZIP override lookup retired per Tanner 2026-07-06 — the
  // override rows were patches for haversine's back-road underestimate
  // (Danville 40422 ~53min real vs ~34min est), but they were too coarse
  // (Richmond 40475 covers 34-min-close addresses too). Address-level
  // Google Routes upgrade below now handles both cases correctly for
  // every checkout that has an address. Cart-preview quote (no address)
  // still uses haversine only — accepted per Tanner 2026-07-06.

  // 3. ZIP centroid lookup.
  const zipLL = getZipCentroid(zip)
  if (!zipLL) {
    // WHY: real customer ZIPs missing from our dataset need a patch — log loud.
    console.warn('[service-area] zip not in centroid dataset', { zip })
    return { tier: 'out_of_area', surchargeCents: 0, contactPhone: DEFAULT_PHONE, reason: 'zip_not_in_centroid_dataset' }
  }

  // 4. Active centers.
  const centers = (await prisma.serviceCenter.findMany({
    where: { isActive: true },
  })) as unknown as ServiceCenterRow[]

  if (centers.length === 0) {
    // WHY: fail-OPEN so a misconfigured admin dashboard never bricks orders.
    console.warn('[service-area] no active centers — failing OPEN')
    return { tier: 'standard', surchargeCents: 0, reason: 'no_active_centers' }
  }

  // 5. Score each center using ZIP cache (preferred) or haversine (fallback).
  let scored: ScoredCenter[] = await Promise.all(
    centers.map((c) => scoreCenterFromZip(c, zip, zipLL))
  )

  // 6. Address-level upgrade — when we have the address AND the ZIP
  // estimate is at-or-above LOOKUP_FLOOR_MINUTES, upgrade to a precise
  // Google Routes lookup. Skips clearly-in-area properties (under-floor)
  // to save API calls, but verifies everything else so a haversine error
  // can't silently undercharge a Berea-type property OR over-block a
  // serviceable one with an over-estimate.
  const candidates = input.address
    ? scored
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => shouldUpgrade(s.minutes))
    : []
  if (candidates.length > 0 && input.address) {
    const addr = input.address
    const addressHashValue = hashAddress(addr)
    const upgrades = await Promise.all(
      candidates.map(({ s }) => upgradeWithAddress(s, addr, addressHashValue))
    )
    scored = [...scored]
    upgrades.forEach((upgraded, i) => {
      scored[candidates[i].idx] = upgraded
    })
  }

  // 7. Best-tier wins; within the winning tier, closest center.
  scored.sort((a, b) => {
    const r = TIER_RANK[a.tier] - TIER_RANK[b.tier]
    return r !== 0 ? r : a.minutes - b.minutes
  })
  const winner = scored[0]

  if (winner.tier === 'out_of_area') {
    return {
      tier: 'out_of_area',
      surchargeCents: 0,
      contactPhone: centers[0].contactPhone || DEFAULT_PHONE,
      reason: 'all_centers_out_of_area',
    }
  }

  const decidedBy: DecidedBy = {
    centerId: winner.center.id,
    centerName: winner.center.name,
    driveTimeMinutes: Math.round(winner.minutes),
    driveTimeSource: winner.source,
  }

  if (winner.tier === 'surcharge') {
    return {
      tier: 'surcharge',
      surchargeCents: winner.center.surchargeCents,
      decidedBy,
    }
  }

  return { tier: 'standard', surchargeCents: 0, decidedBy }
}
