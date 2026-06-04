/**
 * Shared helper for appending a physical lockbox identifier suffix to an
 * OrderItem description so installers, admins, and customer emails all show
 * the serial/code of the box that will be (or was) installed.
 *
 * Used by:
 *  - components/order-flow/steps/review-step.tsx (live order creation/edit)
 *  - scripts/_backfill-lockbox-descriptions.ts (one-time backfill of rows
 *    written before this enrichment existed)
 *
 * Prefer-order: "Serial: X · Code: Y" → "Serial: X" → "Code: Y" → "".
 * Returns the suffix beginning with " — " (em-dash space) so the caller can
 * append it directly to a base description (e.g. "Sentrilock/Supra Install").
 */
export function lockboxDescriptionSuffix(input: {
  serialNumber?: string | null
  code?: string | null
}): string {
  const serial = input.serialNumber?.trim() || null
  const code = input.code?.trim() || null
  if (serial && code) return ` — Serial: ${serial} · Code: ${code}`
  if (serial) return ` — Serial: ${serial}`
  if (code) return ` — Code: ${code}`
  return ''
}

/**
 * Detects whether a description already carries a serial/code suffix so the
 * backfill can be idempotent (and so we don't double-append on re-runs).
 */
export function hasLockboxIdentifier(description: string): boolean {
  return description.includes('Serial:') || description.includes('Code:')
}
