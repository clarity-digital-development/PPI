/**
 * Pricing math for an order, extracted from the per-order POST handler so
 * the batch endpoint can compute each cart row's total without creating
 * Stripe payment intents N times.
 */

export const FUEL_SURCHARGE = 2.47
export const NO_POST_SURCHARGE = 40
export const FALLBACK_TAX_RATE = 0.06 // KY 6% fallback when Stripe Tax unavailable / returns 0
export const EXPEDITE_FEE = 50

// CR4 (Round 22): flat-fee accounts pay a fixed amount per order regardless of
// items selected: $60 base (taxable) + $2.47 fuel (untaxed) + 6% tax on the
// base = $66.07. Deterministic 6% (not Stripe Tax) so the total is always exact.
export const FLAT_FEE_BASE = 60

/**
 * Pure flat-fee breakdown. Tax is the 6% fallback on the base only (fuel is not
 * taxed, matching the standard pricing), yielding subtotal $60, tax $3.60, and
 * total $66.07. Real order items are persisted separately for fulfillment.
 */
export function computeFlatFeePricing(): ComputedOrderPricing {
  const subtotal = FLAT_FEE_BASE
  const tax = Math.round(FLAT_FEE_BASE * FALLBACK_TAX_RATE * 100) / 100 // 3.60
  const total = subtotal + FUEL_SURCHARGE + tax // 66.07
  return { subtotal, discount: 0, fuelSurcharge: FUEL_SURCHARGE, noPostSurcharge: 0, expediteFee: 0, tax, total }
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
 * Pure function — no DB or API calls. Given an order body's items + flags,
 * return the breakdown. Tax uses the 6% fallback (the per-order POST hits
 * Stripe Tax for a more accurate quote, but batch checkout doesn't need that
 * per row since the user already saw an estimated total at add-to-cart time).
 */
export function computeOrderPricing(params: {
  items: OrderItemForPricing[]
  hasPostType: boolean
  isExpedited?: boolean
  discount?: number
  fuelSurchargeWaived?: boolean
}): ComputedOrderPricing {
  const subtotal = params.items.reduce((sum, i) => sum + i.total_price, 0)
  const discount = params.discount ?? 0
  const expediteFee = params.isExpedited ? EXPEDITE_FEE : 0
  const noPostSurcharge = params.hasPostType ? 0 : NO_POST_SURCHARGE
  const fuelSurcharge = params.fuelSurchargeWaived ? 0 : FUEL_SURCHARGE

  const discountedSubtotal = Math.max(0, subtotal - discount)
  const taxableAmount = discountedSubtotal + expediteFee + noPostSurcharge
  const tax = Math.round(taxableAmount * FALLBACK_TAX_RATE * 100) / 100
  const total = discountedSubtotal + fuelSurcharge + expediteFee + noPostSurcharge + tax

  return { subtotal, discount, fuelSurcharge, noPostSurcharge, expediteFee, tax, total }
}
