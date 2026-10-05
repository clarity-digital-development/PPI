/**
 * Sanity checks for a service centre's hand-typed coordinates.
 *
 * Ryan types each centre's lat/lng in from Google Maps, which shows them as
 * "39.43357° N, 84.20835° W" — and the W becomes a minus sign only if you
 * remember to type it. Two centres were saved with a positive longitude
 * (Lebanon OH, Vine Grove KY), which puts them on the other side of the
 * world. Google found no route from them, so they priced off a capped
 * estimate, and one undercharged three out-of-area orders (2026-10-04).
 *
 * Pure: the admin form runs it too, so the mistake is caught before saving.
 */

// Continental US, with a little margin. Every centre is in KY/OH; this only
// has to be loose enough never to reject a real one.
const US = { minLat: 24, maxLat: 50, minLng: -125, maxLng: -66 }

const inUs = (lat: number, lng: number) =>
  lat >= US.minLat && lat <= US.maxLat && lng >= US.minLng && lng <= US.maxLng

/** Why these coordinates can't be a US service centre, or null if they can. */
export function centerCoordinateProblem(lat: number, lng: number): string | null {
  if (inUs(lat, lng)) return null
  if (inUs(lat, -lng)) {
    return `Longitude ${lng} is missing its minus sign. Google Maps shows it as "${lng}° W", which is ${-lng} — did you mean ${-lng}?`
  }
  if (inUs(lng, lat) || inUs(lng, -lat)) {
    return 'Latitude and longitude look swapped. Latitude comes first (about 37–40 here), then longitude (about -82 to -88).'
  }
  return 'Those coordinates aren’t in the US. In Google Maps, right-click the shop and click the numbers to copy them, then paste latitude first and longitude second.'
}
