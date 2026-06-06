/**
 * ZIP-centroid lookup. Wraps the `us-zips` npm package (default-export
 * object map of zip → { latitude, longitude }, sourced from public Census
 * data) so the rest of the app uses a single normalized shape.
 *
 * Returns null for any zip not present in the dataset — callers must
 * treat that as "out_of_area, reason=zip_not_in_centroid_dataset" and
 * log a warning so we can ship a patch dataset if a real customer ZIP
 * is missing.
 */

import zipMap from 'us-zips/object'

export interface LatLng {
  lat: number
  lng: number
}

export function getZipCentroid(zip: string): LatLng | null {
  const entry = zipMap[zip]
  if (!entry) return null
  return { lat: entry.latitude, lng: entry.longitude }
}
