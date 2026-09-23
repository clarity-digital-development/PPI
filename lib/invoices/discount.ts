/**
 * Broker invoice discount — a flat percentage off a bundled invoice, shown as
 * a single line at the bottom rather than broken out per item.
 *
 * Ryan, 2026-09-23, for the four Keller Williams offices: they pay the
 * discounted amount and bill their own agent the full amount, so a per-item
 * breakdown would make their side harder, not easier.
 *
 * Taken off the PRE-TAX subtotal. Per-order tax was computed and charged at
 * full price when each order was placed; discounting the tax as well would
 * mean remitting tax that was never collected. So a $1,000 subtotal with $60
 * of tax and a 15% discount bills $910, not $901.
 *
 * Shared by both bundlers (admin send and broker self-serve) so the two can
 * never disagree about what an account owes.
 */

/** Percentage → a concrete discount on this invoice. */
export function invoiceDiscount(
  subtotal: number,
  percent: unknown,
): { percent: number; amount: number } {
  const pct = Number(percent ?? 0)
  if (!Number.isFinite(pct) || pct <= 0) return { percent: 0, amount: 0 }
  if (!Number.isFinite(subtotal) || subtotal <= 0) return { percent: 0, amount: 0 }

  // A percentage over 100 would invert the invoice; clamp rather than trust it.
  const capped = Math.min(pct, 100)

  // Integer arithmetic end to end. Doing this as `subtotal * capped / 100`
  // leaves the answer at the mercy of binary floating point, which lands a
  // touch under an exact half-cent and rounds it the wrong way. Cents ×
  // basis points is exact, and the half-up decision below is made on the
  // remainder rather than on a float.
  const subtotalCents = Math.round(subtotal * 100)
  const pctBasisPoints = Math.round(capped * 100)
  const scaled = subtotalCents * pctBasisPoints
  const whole = Math.floor(scaled / 10000)
  const remainder = scaled % 10000
  const amountCents = whole + (remainder * 2 >= 10000 ? 1 : 0)

  const amount = amountCents / 100
  return amount > 0 ? { percent: capped, amount } : { percent: 0, amount: 0 }
}
