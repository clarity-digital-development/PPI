/**
 * Where a customer-supplied sign is coming from (Ryan, 2026-09-15). Picked from
 * the dropdown under "Sign will be at the property or pickup from another
 * location" on the Sign step (and the same choice on the Second Post step).
 *
 * Pure and dependency-free: imported by the wizard (client), the order routes
 * (server) and orderToFormData, which must all agree on the same strings.
 *
 * Persisted on the order's `sign` OrderItem, NOT as a new column:
 *   - itemCategory carries the choice ('pickup' / 'delivered'; the listing
 *     choice keeps the legacy 'owned' — or 'install' on the second post — so
 *     every order placed before this change reads back as "listing")
 *   - customValue carries the pickup address
 *   - description spells it out, because the description is what the install
 *     crew's dispatch email and every order screen actually show.
 */
export type SignLocation = 'listing' | 'ppi_storage' | 'pickup'

export const PICKUP_FEE_DESCRIPTION = 'Sign pickup fee'

const MAX_PICKUP_ADDRESS = 300

/**
 * Normalise a typed pickup address. Currency symbols are stripped because the
 * address rides in the sign line's description into the crew dispatch email,
 * whose money guard redacts anything that looks like an amount.
 */
export function sanitizePickupAddress(raw: unknown): string {
  // Bounded before any regex runs: the cart checkout route has no schema
  // validation, so this can be handed anything.
  return (typeof raw === 'string' ? raw.slice(0, 4 * MAX_PICKUP_ADDRESS) : '')
    .replace(/[$＄€£]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PICKUP_ADDRESS)
}

export function signLocationToCategory(location: SignLocation, secondPost: boolean): string {
  if (location === 'pickup') return 'pickup'
  if (location === 'ppi_storage') return 'delivered'
  // Legacy categories, byte-identical to what the builder emitted before the
  // sub-choice existed.
  return secondPost ? 'install' : 'owned'
}

export function categoryToSignLocation(category: string | null | undefined): SignLocation {
  if (category === 'pickup') return 'pickup'
  if (category === 'delivered') return 'ppi_storage'
  return 'listing'
}

/**
 * The sign line's description. The listing wording is byte-identical to the
 * pre-2026-09 builder output ('Sign Install' / 'Second Post Sign Install (at
 * property)') so old and new orders read the same.
 */
export function signInstallDescription(
  location: SignLocation,
  address: string | null | undefined,
  secondPost: boolean,
): string {
  const head = secondPost ? 'Second Post Sign Install' : 'Sign Install'
  if (location === 'pickup') {
    return `${head} (pickup from another location: ${sanitizePickupAddress(address)})`
  }
  if (location === 'ppi_storage') return `${head} (sign delivered to Pink Posts storage)`
  return secondPost ? `${head} (at property)` : head
}

const PICKUP_MARKER = '(pickup from another location:'

/**
 * Recover the address from a description, for rows missing customValue. Only
 * used when READING an order back into the edit form — never on the server,
 * which takes the address from custom_value alone.
 *
 * Plain string scanning, deliberately not a regex: the obvious pattern
 * (`\(pickup from another location:\s*(.+)\)\s*$`) backtracks quadratically on
 * a long run of spaces, and descriptions are client-supplied text.
 */
export function pickupAddressFromDescription(description: string): string {
  const text = description.slice(0, 2000)
  const start = text.toLowerCase().indexOf(PICKUP_MARKER)
  if (start < 0) return ''
  const end = text.lastIndexOf(')')
  if (end <= start) return ''
  return text.slice(start + PICKUP_MARKER.length, end).trim()
}
