/**
 * Whether an order KEEPS its locked out-of-area fee when its address is edited,
 * instead of being re-priced from a fresh quote.
 *
 * One rule, read by both sides so they can't disagree: the edit route
 * (app/api/orders/[id]/edit/route.ts) to decide whether to re-resolve, and the
 * edit screen (via GET /api/orders/[id]) to decide which fee to preview. The
 * screen used to test only "did the address change?", so for the orders below
 * it previewed a re-priced fee the server never charged.
 *
 * Two cases keep the locked fee:
 *
 * 1. The payer is now exempt, and the order already carries a fee. Re-resolving
 *    would zero it and accrue a refund nobody asked for (adversarial review
 *    2026-07-06; Ryan's tight-refund pattern).
 *
 * 2. A flat-fee order placed before the out-of-area fee rode on top of the flat
 *    rate (Ryan, 2026-09-27) — identifiable by having no stored flatFeeBase.
 *    Back then the fee was swallowed, so its stored fee of 0 means "swallowed",
 *    not "in the free zone". Re-resolving would read a typo fix to the street
 *    as a move into a fee zone and bill the full fee after the fact. Orders keep
 *    the policy they were placed under, like every other rate change here.
 */
export function keepsLockedServiceAreaFee(
  order: {
    flatFeeApplied: boolean
    flatFeeBase?: unknown
    serviceAreaSurchargeCents?: number | null
  },
  payer: { isServiceAreaExempt?: boolean | null } | null,
): boolean {
  const exemptWithFee = !!payer?.isServiceAreaExempt && (order.serviceAreaSurchargeCents ?? 0) > 0
  const flatUnderOldPolicy =
    order.flatFeeApplied && (order.flatFeeBase === null || order.flatFeeBase === undefined)
  return exemptWithFee || flatUnderOldPolicy
}

/** The order is billed through a bundled Invoice rather than a card charge. */
export function isInvoicePathOrder(order: { invoiceId?: string | null; paymentStatus?: string | null }): boolean {
  return !!order.invoiceId || order.paymentStatus === 'pending_invoice'
}

/**
 * Whether an address edit re-prices this order's out-of-area fee as ONE
 * unsplit amount instead of half now + half at pickup.
 *
 * Invoice accounts used to carry the whole both-trips fee on the order, with
 * no pickup half. They split like card accounts now (Ryan, 2026-09-28): half
 * on the order, the pickup half added to their invoice when removal is
 * scheduled. An order placed before that keeps the policy it was placed under
 * — splitting it on a later edit would drop half the fee off an invoice the
 * customer may already have, then bill it again at pickup. Recognised by being
 * on the invoice path with a fee and no pickup half ever armed.
 *
 * Read by both the edit route and the edit screen (via GET /api/orders/[id]),
 * so the preview matches the save — same contract as keepsLockedServiceAreaFee.
 */
export function keepsUnsplitServiceAreaFee(order: {
  invoiceId?: string | null
  paymentStatus?: string | null
  serviceAreaSurchargeCents?: number | null
  serviceAreaSecondChargeCents?: number | null
  serviceAreaSecondChargeStatus?: string | null
}): boolean {
  return (
    isInvoicePathOrder(order) &&
    (order.serviceAreaSurchargeCents ?? 0) > 0 &&
    order.serviceAreaSecondChargeStatus == null &&
    order.serviceAreaSecondChargeCents == null
  )
}
