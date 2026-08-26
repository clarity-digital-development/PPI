/**
 * Installer dispatch email — data shapes + money guards.
 *
 * The whole point of this email is that installers never see what Pink Posts
 * charges (Ryan, 2026-08-25: an hourly installer saw the $80 line and decided
 * he was underpaid). Three independent allowlists make a leak structurally
 * impossible rather than merely unlikely:
 *
 *   1. lib/dispatch/load-jobs.ts selects ONLY the columns named there — no
 *      money column is ever fetched from the database.
 *   2. The DTOs below have no money fields. The only numeric field is
 *      `quantity`. lib/email.ts cannot type-check a price into the body.
 *   3. `assertNoMoney()` runs over the rendered subject/text/html and refuses
 *      the send if any dollar amount survived — a backstop for free text.
 *
 * Free text (notes, descriptions, gate codes, names — anything a human typed)
 * goes through `redactMoney()` first, so the backstop should never actually
 * fire; if it does, something new slipped past the DTO and the send is
 * refused rather than risked.
 *
 * The runtime guard deliberately checks for AMOUNTS only, not money words:
 * "Price Reduced" is a stock rider, an agent can be surnamed Price, and a
 * company can be called Total Realty. Word-level checks live in
 * scripts/dispatch-email-preview.ts, which scans the template's own static
 * copy, never customer data.
 */

export const INSTALLABLE_ITEM_TYPES = [
  'post',
  'sign',
  'rider',
  'lockbox',
  'brochure_box',
  'wire_frame_sign',
  'solar_lighting',
  'second_post',
  'trip',
] as const
// 'surcharge' is deliberately absent — that is the server-injected
// "Out of Area Service Fee" line (app/api/orders/route.ts) and must never
// reach the crew.

export interface DispatchLine {
  description: string
  quantity: number
}

export interface DispatchLockbox {
  type: string
  serialNumber: string | null
  code: string | null
}

export interface DispatchAddress {
  line1: string
  city: string
  state: string
  zip: string
}

export interface DispatchPhoto {
  filename: string
  content: Buffer
}

export interface DispatchOrderJob {
  kind: 'order'
  id: string
  orderNumber: string
  status: string
  address: DispatchAddress
  mapsUrl: string
  /** YYYY-MM-DD (UTC calendar day). null = "Next available". */
  scheduledDate: string | null
  isExpedited: boolean
  agent: { name: string; phone: string | null; company: string | null }
  /** Team account "sold by" agent, when the order was tagged to one. */
  soldBy: { name: string; phone: string | null } | null
  /** null = no post (service trip only). */
  postType: string | null
  propertyType: string
  installLocation: string | null
  /** Already labelled ("perpendicular", "corner", or the free-text other). */
  orientation: string | null
  isGated: boolean
  gateCode: string | null
  markerPlaced: boolean
  notes: string | null
  lines: DispatchLine[]
  photo: DispatchPhoto | null
  /** Set when a photo exists but could not be attached (too large). */
  photoNote: string | null
}

export interface DispatchServiceJob {
  kind: 'service_request'
  id: string
  status: string
  /** Already labelled via labelRequestType(). */
  type: string
  address: DispatchAddress & { unlisted: boolean; onFile: boolean }
  mapsUrl: string
  requestedDate: string | null
  agent: { name: string; phone: string | null; company: string | null }
  description: string | null
  notes: string | null
  installedHere: { orderNumber: string; lines: DispatchLine[] } | null
  ridersOnSite: string[]
  lockboxesOnSite: DispatchLockbox[]
}

export type DispatchJob = DispatchOrderJob | DispatchServiceJob

export interface DispatchSkipped {
  kind: 'order' | 'service_request'
  id: string
  label: string
  reason: 'cancelled' | 'not_found'
}

export interface InstallerDispatchEmailProps {
  recipients: string[]
  jobs: DispatchJob[]
  note?: string | null
  sentByName: string
  generatedAt: Date
}

// The patterns live in ./money (Buffer-free) so the admin modal can share them.
import { redactMoney } from './money'
export { REDACTED, redactMoney, containsMoney, assertNoMoney } from './money'

/**
 * Walk a DTO and redact every string field in place, recursing through plain
 * objects and arrays. Buffers (photo bytes) are left untouched.
 */
export function redactAllStrings<T>(value: T): T {
  if (typeof value === 'string') return redactMoney(value) as unknown as T
  if (Buffer.isBuffer(value)) return value
  if (Array.isArray(value)) return value.map((v) => redactAllStrings(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactAllStrings(v)
    return out as T
  }
  return value
}
