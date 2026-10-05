/**
 * Server-side cross-check of a service centre's coordinates against its ZIP
 * (the ZIP dataset is too big to ship to the admin form). Catches a typo in
 * either one: the Lebanon OH centre was saved with ZIP 45306 (Celina, ~70
 * miles north) as well as a positive longitude. The ZIP itself isn't used for
 * pricing; it's only a check that the coordinates are where they say.
 */
import { haversineMiles } from '@/lib/service-area'
import { getZipCentroid } from './zip-centroid'
import { centerCoordinateProblem } from './center-coordinates'

// A rural ZIP can be big; this only has to catch a wrong digit or a wrong town.
const MAX_MILES_FROM_ZIP = 40

/** Why this centre's coordinates/ZIP don't add up, or null if they do. */
export function centerLocationProblem(lat: number, lng: number, zip: string): string | null {
  const coords = centerCoordinateProblem(lat, lng)
  if (coords) return coords
  const centroid = getZipCentroid(zip)
  if (!centroid) return null
  const miles = haversineMiles({ lat, lng }, centroid)
  if (miles > MAX_MILES_FROM_ZIP) {
    return `The coordinates are about ${Math.round(miles)} miles from ZIP ${zip}. Check that the ZIP and the coordinates are for the same place.`
  }
  return null
}
