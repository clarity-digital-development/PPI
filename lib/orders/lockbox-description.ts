/**
 * Shared helper for appending a physical lockbox identifier suffix to an
 * OrderItem description so installers, admins, and customer emails all show
 * the box that will be (or was) installed.
 *
 * Used by:
 *  - components/order-flow/steps/review-step.tsx (live order creation/edit)
 *  - scripts/_backfill-lockbox-descriptions.ts (one-time backfill of rows
 *    written before this enrichment existed)
 *
 * Two DIFFERENT values matter here and they are easy to confuse, because the
 * admin UI calls both of them "code":
 *
 *  - the box's identity in inventory — the "Code" field on the customer's
 *    inventory record. Ryan puts the physical Sentrilock serial in here
 *    (e.g. "32828202"). This is how the crew knows WHICH box to pull from
 *    storage. Note `serialNumber` exists on the model but no screen writes
 *    it, so in practice the identity always lives in the inventory code.
 *  - the access code typed on THIS order — what opens the box, or a note
 *    for the crew ("1525", "no code - just place on porch unattached").
 *
 * These used to collapse into one `serial || code || typed` chain, so only
 * one of them ever reached the crew email and the inventory identity was the
 * one that got dropped — the crew could not tell which box to grab
 * (Ryan, 2026-09-23). Both are emitted now whenever they differ.
 */
export function lockboxDescriptionSuffix(input: {
  /** Inventory serial, if one was ever set. */
  serialNumber?: string | null
  /** The inventory record's "Code" field — where the box's identity lives. */
  code?: string | null
  /** The code/notes the admin typed on this specific order. */
  accessCode?: string | null
}): string {
  const serial = input.serialNumber?.trim() || null
  const inventoryCode = input.code?.trim() || null
  const typed = input.accessCode?.trim() || null

  const identity = serial || inventoryCode
  // Don't print the same string twice when the order's code is just a repeat
  // of the box's own (common on mechanical boxes, where they're the same number).
  const access = typed && typed !== identity ? typed : null

  const parts: string[] = []
  if (identity) parts.push(`Box: ${identity}`)
  if (access) parts.push(`Code: ${access}`)
  return parts.length ? ` — ${parts.join(' · ')}` : ''
}

/**
 * Recovers the box identity that a previous save wrote into a description.
 *
 * Needed on the edit path: placing an order flips the box to inStorage=false,
 * /api/inventory only returns in-storage boxes, so by the time anyone edits
 * the order the real inventory record is gone from the loaded list and the
 * description is the only place the identity still exists. Without this the
 * rebuild relabels the order's typed code as the box number and the crew is
 * sent after a box that does not exist.
 *
 * Reads the current "— Box: X · Code: Y" shape and the legacy
 * "— Serial: X · Code: Y" one. Returns null for a description that carries
 * only "Code: Y" (or legacy "code Y"), because that value is the code typed
 * on the order, not the box's identity — guessing there is what caused the
 * bug in the first place.
 */
export function lockboxIdentityFromDescription(description: string): string | null {
  // Bounded, and split/indexOf only — this runs on stored free text.
  const text = description.slice(0, 2000)
  const sep = text.indexOf(' — ')
  if (sep < 0) return null
  const suffix = text.slice(sep + 3)
  for (const label of ['Box:', 'Serial:']) {
    const at = suffix.indexOf(label)
    if (at < 0) continue
    const rest = suffix.slice(at + label.length)
    const end = rest.indexOf('·')
    return (end < 0 ? rest : rest.slice(0, end)).trim() || null
  }
  return null
}

/**
 * Detects whether a description already carries an identifier suffix so the
 * backfill can be idempotent (and so we don't double-append on re-runs).
 * Includes the legacy "Serial:" label that older rows were written with.
 */
export function hasLockboxIdentifier(description: string): boolean {
  return (
    description.includes('Box:') ||
    description.includes('Serial:') ||
    description.includes('Code:')
  )
}
