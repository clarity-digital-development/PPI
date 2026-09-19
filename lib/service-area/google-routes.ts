/**
 * Google Routes API wrapper — single-element drive-time lookups for the
 * service-area resolver (Round 25). We use Compute Route Matrix with one
 * origin and one destination per call: the matrix endpoint accepts both
 * lat/lng waypoints and free-text address strings, so we cover both the
 * ZIP-centroid bulk seed and the on-demand address upgrade with the same
 * surface.
 *
 * Key design notes:
 *  - Server-side only. Reads GOOGLE_MAPS_SERVER_API_KEY (NEVER the
 *    NEXT_PUBLIC_* key, which is exposed to the browser).
 *  - Returns null on any failure (network, 4xx, 5xx, missing key) so the
 *    caller can transparently fall back to the haversine estimate.
 *  - No retries. The caller is a checkout-path resolver — we'd rather
 *    fall back fast than block the order on a slow Google response. The
 *    cache absorbs the cost on the next request anyway.
 *  - 5-second hard timeout via AbortSignal. Same reason.
 *  - Uses TRAFFIC_UNAWARE routing preference. We want a stable, billable
 *    "typical drive time" — not a snapshot of right-now-Friday-rush-hour
 *    that would flip pricing tier based on time of day.
 */

import type { LatLng } from './zip-centroid'

const ROUTES_API_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'
const REQUEST_TIMEOUT_MS = 5000

// Warn-once flag so a missing API key in prod doesn't flood logs with one
// warning per borderline order. The first call still emits the warning so
// it's visible; subsequent calls silently fall through to haversine.
let missingKeyWarned = false

export type WaypointInput =
  | { kind: 'latlng'; lat: number; lng: number }
  | { kind: 'address'; address: string }

function waypointBody(wp: WaypointInput) {
  if (wp.kind === 'latlng') {
    return { waypoint: { location: { latLng: { latitude: wp.lat, longitude: wp.lng } } } }
  }
  return { waypoint: { address: wp.address } }
}

/**
 * Fetches a single drive-time element. Returns drive minutes (rounded to
 * the nearest int) on success, or null on any failure.
 *
 * The Routes API responds with one element per (origin, destination)
 * pair. We always send 1x1, so we expect exactly one element back.
 */
export interface RouteMeasurement {
  /** Drive minutes, rounded to the nearest int (unchanged from Round 25). */
  minutes: number
  /** Road miles along the same route, 1dp. Null when Google omitted
   *  distanceMeters — callers must treat that as "unknown", never as 0. */
  miles: number | null
}

const METERS_PER_MILE = 1609.344

export async function fetchRoute(
  origin: WaypointInput,
  destination: WaypointInput
): Promise<RouteMeasurement | null> {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY
  if (!apiKey) {
    if (!missingKeyWarned) {
      missingKeyWarned = true
      console.warn('[google-routes] GOOGLE_MAPS_SERVER_API_KEY not set — falling back to haversine estimate for all borderline lookups')
    }
    return null
  }

  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(ROUTES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Field mask is REQUIRED by the Routes API — without it the call
        // 400s. We ask for duration + distanceMeters + status + condition to
        // distinguish a genuine ROUTE_NOT_FOUND (no road connects the points)
        // from a transport error, while keeping billing at the Essentials tier
        // (asking for traffic-aware or toll fields would bump us to the
        // Pro SKU at 2x price). distanceMeters is Essentials too — it is what
        // the mile-based out-of-area fee prices from (Ryan, 2026-09-08).
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
      },
      body: JSON.stringify({
        origins: [waypointBody(origin)],
        destinations: [waypointBody(destination)],
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
      signal: ac.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>')
      console.warn(`[google-routes] non-OK response ${res.status}: ${body.slice(0, 300)}`)
      return null
    }

    // The matrix endpoint streams a JSON array of elements. With a 1x1
    // request we get exactly one element back.
    const data = (await res.json()) as Array<{
      status?: { code?: number; message?: string }
      condition?: string // 'ROUTE_EXISTS' | 'ROUTE_NOT_FOUND'
      duration?: string // protobuf duration: "1234s"
      distanceMeters?: number
    }>

    const first = Array.isArray(data) ? data[0] : null
    if (!first || first.status?.code) {
      console.warn('[google-routes] element error', first?.status ?? data)
      return null
    }
    // ROUTE_NOT_FOUND is a real Google answer ("no road network connects
    // these points") and should be surfaced separately from transport
    // errors. The resolver treats null as "fall back to ZIP estimate" — a
    // genuine ROUTE_NOT_FOUND means the property is unreachable by car,
    // which the haversine ZIP estimate would also miss. Falling back is
    // still the right call; we just want this distinguishable in logs.
    if (first.condition === 'ROUTE_NOT_FOUND') {
      console.warn('[google-routes] ROUTE_NOT_FOUND for waypoints', { origin, destination })
      return null
    }

    const durationStr = first.duration
    if (typeof durationStr !== 'string' || !durationStr.endsWith('s')) {
      console.warn('[google-routes] missing or malformed duration', first)
      return null
    }
    const seconds = Number.parseFloat(durationStr.slice(0, -1))
    if (!Number.isFinite(seconds) || seconds < 0) return null

    // distanceMeters is absent on a zero-length route (origin == destination),
    // where 0 is the truthful answer. Only a non-numeric value is "unknown".
    const meters = first.distanceMeters
    const miles =
      typeof meters === 'number' && Number.isFinite(meters) && meters >= 0
        ? Math.round((meters / METERS_PER_MILE) * 10) / 10
        : null

    return { minutes: Math.round(seconds / 60), miles }
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    if (name === 'AbortError') {
      console.warn('[google-routes] timed out after', REQUEST_TIMEOUT_MS, 'ms')
    } else {
      console.warn('[google-routes] request failed', err)
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Convenience shims so the resolver and seed script don't have to think
// about waypoint shapes.

export function fetchRouteByLatLng(origin: LatLng, dest: LatLng): Promise<RouteMeasurement | null> {
  return fetchRoute(
    { kind: 'latlng', lat: origin.lat, lng: origin.lng },
    { kind: 'latlng', lat: dest.lat, lng: dest.lng }
  )
}

export function fetchRouteByAddress(address: string, dest: LatLng): Promise<RouteMeasurement | null> {
  return fetchRoute(
    { kind: 'address', address },
    { kind: 'latlng', lat: dest.lat, lng: dest.lng }
  )
}

// Minutes-only shims, kept so the Round 25 ZIP seed script and any external
// caller keep compiling. New code should use fetchRoute* and read .miles.
export async function fetchDriveMinutesByLatLng(origin: LatLng, dest: LatLng): Promise<number | null> {
  return (await fetchRouteByLatLng(origin, dest))?.minutes ?? null
}

export async function fetchDriveMinutesByAddress(address: string, dest: LatLng): Promise<number | null> {
  return (await fetchRouteByAddress(address, dest))?.minutes ?? null
}
