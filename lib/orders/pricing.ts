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

/** The post type an agent picks when they supply the post themselves. */
export const BYO_POST_TYPE = 'My Own Post'

/**
 * Whether recurring post-rental billing applies to an order's post type.
 *
 * Post-rental charges for leaving OUR post in someone's yard for months. Three
 * cases leave no PPI post out there and must never accrue rent:
 *   - no post at all           (post_type undefined)
 *   - open house / wire frames (post_type 'open_house' — no post is planted)
 *   - the agent's own post     (post_type 'My Own Post' — we don't own it)
 *
 * The create/batch routes previously expressed this as `!post_type`, whose
 * comment already claimed to cover "agent's own post" but could not: both
 * 'open_house' and 'My Own Post' are truthy and would have switched rent ON
 * for a post PPI does not own. Billing is dormant today
 * (POST_RENTAL_BILLING_START_AT defaults to 2099) so no money moved, but the
 * flag is stamped at order-create time and would be wrong the day it's enabled.
 */
export function postRentalApplies(postType: string | null | undefined): boolean {
  return !!postType && postType !== BYO_POST_TYPE && postType !== 'open_house'
}
export const FALLBACK_TAX_RATE = 0.06 // KY 6% fallback when Stripe Tax unavailable / returns 0
export const EXPEDITE_FEE = 50
// Sign picked up from the agent's home/office instead of waiting at the
// listing (Ryan, 2026-09-15). Added per ORDER, not per sign — one trip covers
// both posts. Server-authoritative: see lib/orders/pickup-fee.ts.
export const PICKUP_FEE = 10

// Item lines that are pure service charges with no tangible good, so they stay
// OUT of the sales-tax base (KY rule Ryan confirmed 2026-06-29 for service
// trips). Every place that builds a tax base — computeOrderPricing below, the
// Stripe Tax line items in app/api/orders/route.ts, and the review step's tax
// preview — must read this one set, or the quote and the charge drift apart.
export const UNTAXED_ITEM_TYPES: ReadonlySet<string> = new Set(['surcharge', 'pickup_fee'])

// CR4 (Round 22): flat-fee accounts pay a fixed amount per order regardless of
// items selected: base (taxable) + $3.49 fuel (untaxed) + 6% tax on the base.
// Deterministic 6% (not Stripe Tax) so the total is always exact. Bumped
// $60 → $65 on 2026-07-15 per Ryan, for Semonin + all future fixed-price
// brokers — FUTURE orders only, not previous ones (see `baseOverride` below,
// mirrors the existing fuel-rate override so past orders don't silently
// reprice on edit). (Fuel went 2.47 → 3.49 on 2026-06-27 per Ryan; he
// explicitly chose to let the per-order total move with the fuel change
// rather than back-calc the base — "fuel cost is real for their installs too.")
export const FLAT_FEE_BASE = 65

/**
 * Pure flat-fee breakdown. Tax is the 6% fallback on the base only (fuel is not
 * taxed, matching the standard pricing). Real order items are persisted
 * separately for fulfillment.
 *
 * `fuelOverride` preserves a legacy order's locked fuel rate (matches the
 * non-flat-fee `fuelSurchargeOverride` semantic). Pre-2026-06-27 flat-fee
 * orders were placed at $2.47 fuel; without the override, every edit of one
 * of those orders would recompute to $3.49 and produce a $1.02 surprise diff-
 * charge on the broker's card. The edit route's own comment block at
 * app/api/orders/[id]/edit/route.ts:246-251 already documents this invariant.
 *
 * `baseOverride` is the same idea for the flat-fee base itself: an order
 * placed before the 2026-07-15 $60→$65 bump (or any future bump) preserves
 * its ORIGINAL base on edit instead of silently jumping to the current
 * constant — per Ryan, rate changes apply to future orders only.
 */
export function computeFlatFeePricing(
  fuelOverride?: number,
  baseOverride?: number,
  /**
   * The out-of-area fee, in dollars, charged ON TOP of the flat rate. It used
   * to be swallowed: the flat total ignored every item, so an out-of-area
   * order billed exactly the same $72.39 as one next door (Ryan, 2026-09-27,
   * the first two Semonin orders after he turned their exemption off lost
   * $165.20). Accounts that shouldn't pay it are exempted per-account, not by
   * the flat rate. Sits in the subtotal and stays OUT of the tax base, exactly
   * like the surcharge line on a normal order (UNTAXED_ITEM_TYPES).
   */
  serviceAreaFee = 0,
): ComputedOrderPricing {
  const fuel = fuelOverride !== undefined ? fuelOverride : FUEL_SURCHARGE
  const base = baseOverride !== undefined ? baseOverride : FLAT_FEE_BASE
  const tax = Math.round(base * FALLBACK_TAX_RATE * 100) / 100
  const fee = serviceAreaFee > 0 ? Math.round(serviceAreaFee * 100) / 100 : 0
  const subtotal = Math.round((base + fee) * 100) / 100
  const total = Math.round((subtotal + fuel + tax) * 100) / 100
  return { subtotal, discount: 0, fuelSurcharge: fuel, noPostSurcharge: 0, expediteFee: 0, tax, total }
}

/**
 * The flat rate an existing flat-fee order was placed at.
 *
 * Read from Order.flatFeeBase, which is stored outright. It can't be read off
 * the subtotal any more — that carries the out-of-area fee too (so the order
 * reads like any other: subtotal includes the surcharge line, tax excludes
 * it). And it can't be derived as subtotal − serviceAreaSurchargeCents: on an
 * INVOICED order an address edit rewrites that fee column but leaves subtotal
 * frozen, so the difference drifts, the next edit re-prices from a wrong rate,
 * and a phantom adjustment lands on the broker's next invoice.
 *
 * Anything that re-prices or displays a flat order — the edit route, the edit
 * screens, invoices — must use this, never the raw subtotal, or it treats the
 * fee as part of the rate: taxing it and then adding it a second time.
 *
 * Null flatFeeBase means the order predates the column, when the fee was
 * always swallowed, so its subtotal IS the rate — and stays so: such an order
 * never re-prices its fee on edit (lib/orders/service-area-lock.ts), so nothing
 * can ever put a fee into its subtotal. That null is also how the lock tells an
 * old-policy order apart, which is why the edit route must not back-fill it.
 */
export function lockedFlatBase(order: {
  subtotal: unknown
  flatFeeBase?: unknown
}): number {
  const stored = order.flatFeeBase
  const rate = stored !== null && stored !== undefined ? Number(stored) : Number(order.subtotal)
  return Math.round(rate * 100) / 100
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
 * An EXISTING order's promo discount for a set of items — how the edit route
 * re-derives it on every edit, and how removing an order's out-of-area fee
 * re-prices it (lib/orders/ooa-waive-rules.ts). One rule, so a later edit
 * lands on the same discount instead of quietly moving the total.
 *
 * Promo-deactivation policy: if the original promo is no longer active but
 * the order has a saved discount, preserve the dollar amount (clamped to the
 * current eligible subtotal). Without this, a customer who edits after admin
 * deactivates their code silently loses the discount and gets re-charged —
 * Ryan's preference is "customer keeps the promo they got".
 */
export function discountForExistingOrder(
  items: OrderItemForPricing[],
  order: {
    isFlatFee: boolean
    promoCode: { isActive: boolean; discountType: string; discountValue: unknown } | null
    savedDiscount: number
  },
): number {
  if (order.isFlatFee) return 0
  const base = computeDiscountableSubtotal(items)
  let d = 0
  if (order.promoCode && order.promoCode.isActive) {
    if (order.promoCode.discountType === 'percentage') {
      d = base * (Number(order.promoCode.discountValue) / 100)
    } else {
      d = Math.min(Number(order.promoCode.discountValue), base)
    }
  } else if (order.promoCode && order.savedDiscount > 0) {
    d = Math.min(order.savedDiscount, base)
  }
  return Math.round(d * 100) / 100
}

/**
 * Pure function — no DB or API calls. Given an order body's items + flags,
 * return the full pricing breakdown.
 *
 * Tax base EXCLUDES every UNTAXED_ITEM_TYPES line: the out-of-area service
 * fee ('surcharge') and the sign-pickup fee ('pickup_fee'). KY non-taxable
 * rule: pure service charge with no physical post — same rule we shipped for
 * standalone service trips in commit a047770 and explicitly confirmed by Ryan
 * 2026-06-29.
 *
 * Tax computation:
 *   - Default: 6% on the taxable base (items minus untaxed lines, plus
 *     expedite, plus no-post — discounted by `discount`)
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
    .filter(i => UNTAXED_ITEM_TYPES.has(i.item_type))
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
