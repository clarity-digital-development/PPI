/**
 * Where the crew collects a rider the agent chose as "Pickup/At property"
 * (Ryan, 2026-10-29). Agents kept picking riders on that tab when they meant
 * to rent ours, so picking one now asks where it is. The answer rides on each
 * pickup rider line, which is what the crew reads:
 *
 *   "Rider Install: Pending (pickup) — pick up at: 123 Main St"
 *
 * The edit wizard reads it back off with splitPickupLocation.
 */
const MARKER = ' — pick up at: '

export function withPickupLocation(description: string, location?: string | null): string {
  const where = (location ?? '').replace(/\s+/g, ' ').trim()
  return where ? `${description}${MARKER}${where}` : description
}

export function splitPickupLocation(description: string): { description: string; location?: string } {
  const at = description.indexOf(MARKER)
  if (at < 0) return { description }
  const location = description.slice(at + MARKER.length).trim()
  return { description: description.slice(0, at), location: location || undefined }
}
