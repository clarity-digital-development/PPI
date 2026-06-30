/**
 * Pricing math for an order. The CANONICAL implementation — both
 * /api/orders POST (create), /api/orders/[id]/edit PATCH (edit), and the
 * client-side review-step display call these helpers so the math stays
 * identical across create / edit / display. Standardized 2026-06-30 after
 * a QA sweep caught 5 distinct money-drift bugs between the three sites
 * (Stripe Tax vs fallback, brochure-box-purchase discount-base, OOA
 * tax-base inclusion, etc.).
 *
 * Stripe Tax is still used in the create route as an optional override —
 * pass the resulting tax via `taxOverride` to swap it in for the 6%
 * fallback the helper computes by default. Edit route uses the helper's
 * fallback as authoritative (Stripe Tax is fire-and-forget at edit time
 * because the tax base hasn't moved much and the round-trip latency
 * blocks the PATCH).
 */

export const FUEL_SURCHARGE = 3.49
export const NO_POST_SURCHARGE = 40
export const FALLBACK_TAX_RATE = 0.06 // KY 6% fallback when Stripe Tax unavailable / returns 0
export const EXPEDITE_FEE = 50

// CR4 (Round 22): flat-fee accounts pay a fixed amount per order regardless of
// items selected: $60 base (taxable) + $3.49 fuel (untaxed) + 6% tax on the
// base = $67.09. Deterministic 6% (not Stripe Tax) so the total is always exact.
// (Fuel went 2.47 → 3.49 on 2026-06-27 per Ryan; he explicitly chose to let
// Semonin's per-order total move with the fuel change rather than back-calc
// the base — "fuel cost is real for their installs too.")
export const FLAT_FEE_BASE = 60

/**
 * Pure flat-fee breakdown. Tax is the 6% fallback on the base only (fuel is not
 * taxed, matching the standard pricing), yielding subtotal $60, tax $3.60, and
 * total $67.09 at the current $3.49 fuel rate. Real order items are persisted
 * separately for fulfillment.
 *
 * `fuelOverride` preserves a legacy order's locked fuel rate (matches the
 * non-flat-fee `fuelSurchargeOverride` semantic). Pre-2026-06-27 flat-fee
 * orders were placed at $2.47 fuel; without the override, every edit of one
 * of those orders would recompute to $3.49 and produce a $1.02 surprise diff-
 * charge on the broker's card. The edit route's own comment block at
 * app/api/orders/[id]/edit/route.ts:246-251 already documents this invariant.
 */
export function computeFlatFeePricing(fuelOverride?: number): ComputedOrderPricing {
  const fuel = fuelOverride !== undefined ? fuelOverride : FUEL_SURCHARGE
  const subtotal = FLAT_FEE_BASE
  const tax = Math.round(FLAT_FEE_BASE * FALLBACK_TAX_RATE * 100) / 100 // 3.60
  const total = subtotal + fuel + tax
  return { subtotal, discount: 0, fuelSurcharge: fuel, noPostSurcharge: 0, expediteFee: 0, tax, total }
}

export interface OrderItemForPricing {
  item_type: string
  item_category?: string
  total_price: number
}

export interface ComputedOrderPricing {
  subtotal: number
  discount: number
  fuelSurcharge: number
  noPostSurcharge: number
  expediteFee: number
  tax: number
  total: number
}

/**
 * Returns the subtotal eligible for promo-code discounts.
 *
 * Excludes brochure_box+purchase: Ryan's policy — brochure-box purchases are
 * fixed-cost retail items that shouldn't be discountable by % promos. Other
 * items, INCLUDING the out-of-area surcharge, are discountable (Ryan: agents
 * shopping with a promo expect their discount to apply to the whole bill).
 *
 * Call this BEFORE applying the promo percentage / fixed-amount; then pass
 * the resulting discount dollar amount to `computeOrderPricing` as `discount`.
 */
export function computeDiscountableSubtotal(items: OrderItemForPricing[]): number {
  return items
    .filter(i => !(i.item_type === 'brochure_box' && i.item_category === 'purchase'))
    .reduce((sum, i) => sum + i.total_price, 0)
}

/**
 * Pure function — no DB or API calls. Given an order body's items + flags,
 * return the full pricing breakdown.
 *
 * Tax base EXCLUDES any `item_type === 'surcharge'` line (the out-of-area
 * service fee). KY non-taxable rule: pure service charge with no physical
 * post — same rule we shipped for standalone service trips in commit a047770
 * and explicitly confirmed by Ryan 2026-06-29.
 *
 * Tax computation:
 *   - Default: 6% on the taxable base (items minus surcharge, plus expedite,
 *     plus no-post — discounted by `discount`)
 *   - With `taxOverride`: skips the fallback math and uses the override
 *     directly. Create route uses this to swap in Stripe Tax's result when
 *     it returns > 0.
 *
 * Fuel surcharge:
 *   - Default: `FUEL_SURCHARGE` constant (current $3.49)
 *   - With `fuelSurchargeWaived: true`: zero (promo-code-driven)
 *   - With `fuelSurchargeOverride`: explicit value — edit route uses this
 *     to preserve the LOCKED fuel rate from the order's original placement
 *     (so legacy orders don't pick up the post-creation fuel-rate bump).
 *     Overrides `fuelSurchargeWaived`.
 */
export function computeOrderPricing(params: {
  items: OrderItemForPricing[]
  hasPostType: boolean
  isExpedited?: boolean
  discount?: number
  fuelSurchargeWaived?: boolean
  fuelSurchargeOverride?: number
  taxOverride?: number
}): ComputedOrderPricing {
  const subtotal = params.items.reduce((sum, i) => sum + i.total_price, 0)
  const surchargeSum = params.items
    .filter(i => i.item_type === 'surcharge')
    .reduce((sum, i) => sum + i.total_price, 0)

  const discount = params.discount ?? 0
  const expediteFee = params.isExpedited ? EXPEDITE_FEE : 0
  const noPostSurcharge = params.hasPostType ? 0 : NO_POST_SURCHARGE
  const fuelSurcharge = params.fuelSurchargeOverride !== undefined
    ? params.fuelSurchargeOverride
    : (params.fuelSurchargeWaived ? 0 : FUEL_SURCHARGE)

  const discountedSubtotal = Math.max(0, subtotal - discount)
  const taxableAmount = Math.max(0, discountedSubtotal - surchargeSum) + expediteFee + noPostSurcharge
  const tax = params.taxOverride !== undefined
    ? params.taxOverride
    : Math.round(taxableAmount * FALLBACK_TAX_RATE * 100) / 100
  const total = discountedSubtotal + fuelSurcharge + expediteFee + noPostSurcharge + tax

  return { subtotal, discount, fuelSurcharge, noPostSurcharge, expediteFee, tax, total }
}
