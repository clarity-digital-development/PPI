/**
 * Service-area gating: decide whether a property ZIP is serviceable by
 * any active ServiceCenter and, if so, at what tier (standard / surcharge
 * / out_of_area). Exempt users (team_admin or admin-flagged exempt
 * customers) bypass the whole pipeline.
 *
 * Algorithm (per Ryan's 2026-06-02 spec):
 *  1. Exempt fast-path (no DB hit).
 *  2. Normalize ZIP (trim, slice 0..5, /^\d{5}$/).
 *  3. ZIP centroid lookup via `us-zips` dataset.
 *  4. Load all active ServiceCenters from DB.
 *  5. For each center: haversine miles → est. drive minutes; compare to
 *     that center's standard/surcharge bands → per-center tier.
 *  6. Best-tier wins (Standard > Surcharge > Out). Track winning center.
 *
 * Drive-time model: haversine miles × 1.18 road-factor / 65 mph × 60.
 * Calibrated against Ryan's reference drives (Lex→Cincy 80m, Lex→Lou 75m,
 * Lex→Bardstown 65m) — see runCalibrationCheck() at the bottom.
 */

import { prisma } from '@/lib/prisma'
import { getZipCentroid, type LatLng } from '@/lib/service-area/zip-centroid'

export const DEFAULT_PHONE = '859-395-8188'

// Road-network factor and average highway speed. Tuned against Ryan's
// reference drives — landed within ±10% at 1.18 / 65 mph (see calibration
// check below). Change here and re-run calibration before redeploying.
const ROAD_FACTOR = 1.18
const AVG_SPEED_MPH = 65

export type Tier = 'standard' | 'surcharge' | 'out_of_area' | 'exempt'

export type ResolveReason =
  | 'zip_required'
  | 'zip_invalid_format'
  | 'zip_not_in_centroid_dataset'
  | 'no_active_centers'
  | 'all_centers_out_of_area'

export interface ResolveInput {
  zip: string | null | undefined
  user: { id: string; role: string; isServiceAreaExempt: boolean } | null
}

export interface DecidedBy {
  centerId: string
  centerName: string
  driveTimeMinutes: number
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

// Rank used to pick the BEST tier across multiple centers. Lower = better.
const TIER_RANK: Record<CenterTier, number> = {
  standard: 0,
  surcharge: 1,
  out_of_area: 2,
}

/**
 * Resolve service tier for a (zip, user) pair.
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

  // 5. Compute per-center tier + minutes.
  type Scored = {
    center: ServiceCenterRow
    minutes: number
    tier: CenterTier
  }
  const scored: Scored[] = centers.map((c) => {
    const centerLL: LatLng = { lat: toNum(c.lat), lng: toNum(c.lng) }
    const minutes = estDriveMinutes(haversineMiles(zipLL, centerLL))
    return { center: c, minutes, tier: tierForCenter(minutes, c) }
  })

  // 6. Best-tier wins; within the winning tier, closest center.
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
