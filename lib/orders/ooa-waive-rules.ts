/**
 * What "Remove out-of-area fee" can take off an order (Ryan, 2026-09-30: an
 * invoice account was charged the fee on an address right on the edge of the
 * service area — "how do I adjust this order to not have an out of area fee?
 * It's an invoiced account so can't just remove/credit their card on file").
 *
 * Pure — no DB — so the admin order page shows exactly what
 * lib/orders/waive-out-of-area.ts will do.
 *
 * The fee has two halves (see lib/orders/out-of-area-charge.ts): the install
 * half, inside the order's total as a 'surcharge' line, and the pickup half,
 * collected when removal is scheduled. Each comes off only while nothing has
 * been collected or billed:
 *  - Install half: only on an invoice-account order that isn't on an invoice
 *    yet. A card order paid it at checkout (refund that in Stripe), and a sent
 *    invoice re-reads its orders' totals live, so an invoiced order's money
 *    must not change underneath it.
 *  - Pickup half: while it is still waiting for removal ('pending'), queued for
 *    an invoice it isn't on yet ('pending_invoice'), or failed. Once charged or
 *    on an invoice it stays.
 */
import {
  computeFlatFeePricing,
  computeOrderPricing,
  discountForExistingOrder,
  lockedFlatBase,
  type OrderItemForPricing,
} from '@/lib/orders/pricing'

export type InstallKeptReason = 'card_paid' | 'on_invoice' | 'not_billable_here'

export interface OOAWaiveOrder {
  status: string
  paymentStatus: string
  invoiceId: string | null
  serviceAreaSurchargeCents: number | null
  serviceAreaSecondChargeCents: number | null
  serviceAreaSecondChargeStatus: string | null
  serviceAreaSecondChargeInvoiceId: string | null
}

export interface OOAWaivePlan {
  /** Install half that comes off the order's total. 0 = none. */
  installCents: number
  /** Pickup half that gets cancelled. 0 = none. */
  pickupCents: number
  /** An install half that stays, and why. */
  installKept: { cents: number; reason: InstallKeptReason } | null
}

const WAIVABLE_PICKUP_STATUSES = new Set(['pending', 'pending_invoice', 'failed'])

/** Null when the order has no out-of-area fee to talk about (or is cancelled — nothing is owed). */
export function planOOAWaive(o: OOAWaiveOrder): OOAWaivePlan | null {
  if (o.status === 'cancelled') return null
  const install = Math.max(0, o.serviceAreaSurchargeCents ?? 0)
  const pickup = Math.max(0, o.serviceAreaSecondChargeCents ?? 0)
  if (install === 0 && pickup === 0) return null

  const installRemovable = install > 0 && !o.invoiceId && o.paymentStatus === 'pending_invoice'
  const pickupRemovable =
    pickup > 0 &&
    !o.serviceAreaSecondChargeInvoiceId &&
    WAIVABLE_PICKUP_STATUSES.has(o.serviceAreaSecondChargeStatus ?? '')

  let installKept: OOAWaivePlan['installKept'] = null
  if (install > 0 && !installRemovable) {
    installKept = {
      cents: install,
      reason: o.invoiceId ? 'on_invoice' : o.paymentStatus === 'succeeded' ? 'card_paid' : 'not_billable_here',
    }
  }

  return {
    installCents: installRemovable ? install : 0,
    pickupCents: pickupRemovable ? pickup : 0,
    installKept,
  }
}

type Money = number | string | { toString(): string }

/**
 * Why a re-priced order can't be written, or null. The discount can only go
 * negative when the order's promo was changed after it was placed (the
 * current rate is applied to the stored discount) — an edit re-prices the
 * whole discount at the new rate, which clears it.
 */
export function waiveRepriceProblem(after: { subtotal: number; discount: number; tax: number; total: number }): string | null {
  if (after.discount < 0) {
    return 'This order’s promo code has changed since it was placed, so the fee can’t be taken off automatically. Open Edit order and save it once (that re-prices the promo), then try again.'
  }
  if (after.subtotal < 0 || after.tax < 0 || after.total < 0) {
    return 'Removing the fee would take this order below $0, so nothing was changed.'
  }
  return null
}

/** Decimal / string / number dollars → integer cents. */
export function dollarsToCents(v: Money): number {
  return Math.round(Number(v.toString()) * 100)
}

export interface WaivePricingOrder {
  subtotal: Money
  discount: Money
  tax: Money
  total: Money
  fuelSurcharge: Money
  noPostSurcharge: Money
  isExpedited: boolean
  flatFeeApplied: boolean
  flatFeeBase?: Money | null
  promoCode: { isActive: boolean; discountType: string; discountValue: Money } | null
  orderItems: { itemType: string; itemCategory: string | null; totalPrice: Money }[]
}

/**
 * The order's money columns once `installCents` of fee comes off, in cents.
 *
 * Priced the way the edit route prices, so a later edit lands on the same
 * numbers instead of quietly moving the total: the items WITH the fee lines
 * and WITHOUT them both go through the same pipeline (same promo rule, locked
 * fuel, flat-fee rate), and the difference is applied to the stored columns.
 * A delta rather than the fresh recompute, like the edit route's post-invoice
 * adjustment, so Stripe-Tax cents from checkout aren't overwritten with the
 * flat 6%.
 *
 * With no promo the fee is untaxed and nothing else moves: the total drops by
 * exactly the fee. With a percentage promo the discount also shrinks by the
 * part of it that was taken on the fee, and tax follows the discount.
 */
export function repriceWithoutFee(
  o: WaivePricingOrder,
  installCents: number
): { subtotal: number; discount: number; tax: number; total: number } {
  const all: OrderItemForPricing[] = o.orderItems.map((i) => ({
    item_type: i.itemType,
    item_category: i.itemCategory ?? undefined,
    total_price: Number(i.totalPrice.toString()),
  }))
  const kept = all.filter((i) => i.item_type !== 'surcharge')
  const fuel = Number(o.fuelSurcharge.toString())
  const price = (items: OrderItemForPricing[], feeDollars: number) =>
    o.flatFeeApplied
      ? computeFlatFeePricing(fuel, lockedFlatBase(o), feeDollars)
      : computeOrderPricing({
          items,
          // The stored noPostSurcharge records how the order was priced — the
          // edit route's own baseline reads it the same way.
          hasPostType: Number(o.noPostSurcharge.toString()) === 0,
          isExpedited: o.isExpedited,
          discount: discountForExistingOrder(items, {
            isFlatFee: false,
            promoCode: o.promoCode,
            savedDiscount: Number(o.discount.toString()),
          }),
          fuelSurchargeOverride: fuel,
        })
  const before = price(all, installCents / 100)
  const after = price(kept, 0)
  const delta = (k: 'subtotal' | 'discount' | 'tax' | 'total') => dollarsToCents(after[k]) - dollarsToCents(before[k])
  return {
    subtotal: dollarsToCents(o.subtotal) + delta('subtotal'),
    discount: dollarsToCents(o.discount) + delta('discount'),
    tax: dollarsToCents(o.tax) + delta('tax'),
    total: dollarsToCents(o.total) + delta('total'),
  }
}
