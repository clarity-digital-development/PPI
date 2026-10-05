/**
 * Crew areas an order can be tagged with on the admin orders list, so Ryan can
 * pull up every Cincinnati order the way he pulls up every pending one (Ryan,
 * 2026-10-05). Internal bookkeeping only: tagging never emails the customer.
 * Stored as a plain string on Order.area, so adding an area is a one-line
 * change here rather than a schema migration.
 */
export const ORDER_AREAS = [
  { value: 'louisville', label: 'Louisville' },
  { value: 'lexington', label: 'Lexington' },
  { value: 'cincinnati', label: 'Cincinnati' },
] as const

export type OrderArea = (typeof ORDER_AREAS)[number]['value']

export function isOrderArea(v: unknown): v is OrderArea {
  return typeof v === 'string' && ORDER_AREAS.some((a) => a.value === v)
}

export function orderAreaLabel(v: string | null | undefined): string | null {
  return ORDER_AREAS.find((a) => a.value === v)?.label ?? null
}
