/**
 * Singleton loader for the Google Maps JS API with the Places library.
 * Imported by AddressAutocomplete — and any future component that needs Maps.
 *
 * Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Railway env for the autocomplete to
 * activate. Without it the address inputs fall back to plain text entry.
 */

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          // Defining the constructor signature loosely keeps the file
          // dependency-free; the Maps script attaches at runtime.
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: Record<string, unknown>,
          ) => {
            addListener: (event: string, cb: () => void) => void
            getPlace: () => {
              address_components?: Array<{
                long_name: string
                short_name: string
                types: string[]
              }>
            }
          }
        }
      }
    }
  }
}

let scriptLoadPromise: Promise<void> | null = null

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject('not in browser')
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject('no api key')
  if (window.google?.maps?.places) return Promise.resolve()
  if (scriptLoadPromise) return scriptLoadPromise

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptLoadPromise = null
      reject('failed to load Google Maps script')
    }
    document.head.appendChild(script)
  })

  return scriptLoadPromise
}

export function isGoogleMapsConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
}

export interface ParsedAddress {
  street: string
  city: string
  state: string
  zip: string
}

/**
 * Parse a Google Places address_components array into our 4 form fields.
 * Returns empty strings for any missing parts so the caller can spread without
 * worrying about undefined.
 */
export function parseAddressComponents(
  components: Array<{ long_name: string; short_name: string; types: string[] }> | undefined,
): ParsedAddress {
  let streetNumber = ''
  let route = ''
  let city = ''
  let state = ''
  let zip = ''
  for (const c of components ?? []) {
    if (c.types.includes('street_number')) streetNumber = c.long_name
    else if (c.types.includes('route')) route = c.long_name
    else if (c.types.includes('locality')) city = c.long_name
    else if (!city && c.types.includes('sublocality_level_1')) city = c.long_name
    else if (!city && c.types.includes('postal_town')) city = c.long_name
    else if (c.types.includes('administrative_area_level_1')) state = c.short_name
    else if (c.types.includes('postal_code')) zip = c.long_name
  }
  return {
    street: [streetNumber, route].filter(Boolean).join(' '),
    city,
    state,
    zip,
  }
}
