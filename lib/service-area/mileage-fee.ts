/**
 * Out-of-area fee by ROAD MILES (Ryan, Slack 2026-09-08).
 *
 * Replaces the drive-TIME bands. Ryan's rule, verbatim:
 *   "Once the out of area fee triggers $25 out of area fee accommodates up to
 *    an additional 20 miles. Once beyond that out of area 20 miles it's $2 per
 *    mile."
 *
 * So, per service centre:
 *   over   = max(0, routeMiles − freeRadiusMiles)
 *   trip   = over === 0 ? 0 : baseFee + max(0, over − includedOverage) × perMile
 *
 * Charged PER TRIP. Ryan: "this is all per trip. So they'll be charged this
 * fee again upon pickup just like now." `bothTripsCents` is what the resolver
 * returns as surchargeCents, because the order route already splits that total
 * 50/50 — half on the order, half when removal is scheduled.
 *
 * There is deliberately NO distance cutoff. Ryan: "at $2 a mile if we go 100
 * miles, that's $200. Takes 3 hours … so labor is only $60-80. Profit! …
 * leave it open for now and let's let the agent decide how much they want us
 * to drive." Unserviceable ZIPs are still refused, but for "we can't price
 * this" reasons (unknown ZIP), never for distance.
 *
 * Pure — no DB, no I/O — so it can be unit-tested against Ryan's own worked
 * examples and reused by the admin quote endpoint.
 */

export interface MileageFeeConfig {
  /** Road miles covered at no charge. */
  freeRadiusMiles: number
  /** Extra miles the base fee already covers past the radius. */
  includedOverageMiles: number
  /** Charged for each mile beyond radius + included. */
  perMileCents: number
  /** Flat fee the moment the radius is exceeded at all. */
  baseFeeCents: number
}

export interface MileageFeeResult {
  /** Miles past the free radius. 0 when inside it. */
  overMiles: number
  /** Miles actually billed at the per-mile rate (over minus the included band). */
  billableMiles: number
  /** Fee for ONE trip. */
  tripCents: number
  /** Fee for install + pickup — what the order's surchargeCents becomes. */
  bothTripsCents: number
}

export const DEFAULT_MILEAGE_CONFIG: Omit<MileageFeeConfig, 'freeRadiusMiles'> = {
  includedOverageMiles: 20,
  perMileCents: 200,
  baseFeeCents: 2500,
}

/** Round to 1dp so a 41.049-mile route doesn't read as 41.05 on the review page. */
export function roundMiles(miles: number): number {
  return Math.round(miles * 10) / 10
}

export function computeMileageFee(routeMiles: number, cfg: MileageFeeConfig): MileageFeeResult {
  // Negative/NaN can only come from a corrupted cache row or a bad Google
  // parse. Treat as "at the centre" — never as a negative fee.
  const miles = Number.isFinite(routeMiles) && routeMiles > 0 ? roundMiles(routeMiles) : 0
  const radius = Math.max(0, cfg.freeRadiusMiles)
  const overMiles = roundMiles(Math.max(0, miles - radius))

  if (overMiles <= 0) {
    return { overMiles: 0, billableMiles: 0, tripCents: 0, bothTripsCents: 0 }
  }

  const included = Math.max(0, cfg.includedOverageMiles)
  const billableMiles = roundMiles(Math.max(0, overMiles - included))
  // Fractional miles are billed proportionally and rounded to the cent at the
  // end — a 10.4-mile overage is $20.80, not $20 or $22. The review page shows
  // the mileage alongside the fee so the number is always explainable.
  const tripCents = Math.max(0, cfg.baseFeeCents) + Math.round(billableMiles * Math.max(0, cfg.perMileCents))

  return { overMiles, billableMiles, tripCents, bothTripsCents: tripCents * 2 }
}

/** Human-readable reason shown on the review page, e.g. "41 road miles from Lexington (21 over the free 20)". */
export function describeMileageFee(
  centerName: string,
  routeMiles: number,
  cfg: MileageFeeConfig,
  result: MileageFeeResult
): string {
  const miles = roundMiles(routeMiles)
  if (result.overMiles <= 0) {
    return `${miles} road miles from ${centerName} — inside the ${cfg.freeRadiusMiles}-mile service area`
  }
  return `${miles} road miles from ${centerName} (${result.overMiles} over the free ${cfg.freeRadiusMiles})`
}
