/**
 * Take the out-of-area fee off an order — the admin "Remove out-of-area fee"
 * button (app/api/admin/orders/[id]/out-of-area/waive). What can come off is
 * decided by planOOAWaive (lib/orders/ooa-waive-rules.ts); this applies it.
 *
 * Install half: the 'surcharge' lines are deleted and the money columns are
 * re-priced without them (repriceWithoutFee — the edit route's own rules, so
 * a percentage promo gives back only what it took on the fee). Only ever on an
 * invoice order that isn't on an invoice yet. The write is conditional on
 * that and on the money columns being what was priced, so an edit or a bundle
 * that commits first makes this refuse; one that read the order before this
 * commits refuses on its side (the edit route guards serviceAreaFeeWaivedAt,
 * the bundlers attach only orders whose totals they summed).
 *
 * Pickup half: cancelled as cents 0 / status null. 0, not null: null/null on
 * an invoice-path order that still carries an install fee means "legacy order
 * that holds the WHOLE fee" (keepsUnsplitServiceAreaFee). Nothing collects a
 * zero half — the card charger needs 'pending', the invoice sweep
 * 'pending_invoice' with cents > 0. A half whose card charge is in flight
 * (serviceAreaSecondChargeClaimedAt) is refused rather than reported removed.
 *
 * serviceAreaFeeWaivedAt is stamped every time. Once the install half is gone
 * it locks the fee off through later address edits (keepsLockedServiceAreaFee);
 * when only the pickup half was cancelled, the edit route won't re-arm it.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { dollarsToCents, planOOAWaive, repriceWithoutFee, waiveRepriceProblem } from '@/lib/orders/ooa-waive-rules'

export class OOAWaiveError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export interface OOAWaiveResult {
  orderNumber: string
  installCents: number
  pickupCents: number
  before: { subtotal: number; discount: number; tax: number; total: number }
  after: { subtotal: number; discount: number; tax: number; total: number }
}

const centsToDecimal = (c: number) => (c / 100).toFixed(2)

// A card charge takes seconds; a claim older than this is a process that died
// mid-charge, and holding the half hostage to it forever helps nobody.
// Matches STALE_CLAIM_MS in lib/orders/out-of-area-charge.ts.
const STALE_CLAIM_MS = 10 * 60_000

const CHANGED = 'This order changed while the fee was being removed. Refresh and try again.'

export async function waiveOutOfAreaFee(orderId: string): Promise<OOAWaiveResult> {
  return prisma.$transaction((tx) => waiveOutOfAreaFeeTx(tx, orderId))
}

/** The same, inside a caller's transaction. */
export async function waiveOutOfAreaFeeTx(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<OOAWaiveResult> {
  const o = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      invoiceId: true,
      subtotal: true,
      discount: true,
      tax: true,
      total: true,
      fuelSurcharge: true,
      noPostSurcharge: true,
      isExpedited: true,
      flatFeeApplied: true,
      flatFeeBase: true,
      promoCode: { select: { isActive: true, discountType: true, discountValue: true } },
      orderItems: { select: { id: true, itemType: true, itemCategory: true, totalPrice: true } },
      serviceAreaSurchargeCents: true,
      serviceAreaSecondChargeCents: true,
      serviceAreaSecondChargeStatus: true,
      serviceAreaSecondChargeInvoiceId: true,
      serviceAreaSecondChargeClaimedAt: true,
    },
  })
  if (!o) throw new OOAWaiveError('Order not found', 404)

  const plan = planOOAWaive(o)
  if (!plan || (plan.installCents === 0 && plan.pickupCents === 0)) {
    throw new OOAWaiveError(
      plan?.installKept?.reason === 'on_invoice'
        ? 'The out-of-area fee on this order is already on an invoice, so it can’t be removed here.'
        : 'There’s no out-of-area fee on this order that can still be removed.',
      409
    )
  }

  const cents = (v: Prisma.Decimal) => dollarsToCents(v)
  const before = { subtotal: cents(o.subtotal), discount: cents(o.discount), tax: cents(o.tax), total: cents(o.total) }
  let after = before
  const where: Prisma.OrderWhereInput = { id: o.id, status: { not: 'cancelled' } }
  const data: Prisma.OrderUpdateManyMutationInput = { serviceAreaFeeWaivedAt: new Date() }
  const surchargeLines = o.orderItems.filter((i) => i.itemType === 'surcharge')

  if (plan.installCents > 0) {
    const lineCents = surchargeLines.reduce((s, i) => s + cents(i.totalPrice), 0)
    if (lineCents !== plan.installCents) {
      throw new OOAWaiveError(
        `The fee lines on this order ($${centsToDecimal(lineCents)}) don’t match its out-of-area fee ($${centsToDecimal(plan.installCents)}), so nothing was changed.`,
        409
      )
    }
    after = repriceWithoutFee(o, plan.installCents)
    const problem = waiveRepriceProblem(after)
    if (problem) throw new OOAWaiveError(problem, 409)
    Object.assign(where, {
      invoiceId: null,
      paymentStatus: 'pending_invoice',
      serviceAreaSurchargeCents: o.serviceAreaSurchargeCents,
      subtotal: o.subtotal,
      discount: o.discount,
      tax: o.tax,
      total: o.total,
    })
    Object.assign(data, {
      serviceAreaSurchargeCents: 0,
      subtotal: centsToDecimal(after.subtotal),
      discount: centsToDecimal(after.discount),
      tax: centsToDecimal(after.tax),
      total: centsToDecimal(after.total),
    })
  }

  if (plan.pickupCents > 0) {
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS)
    if (o.serviceAreaSecondChargeClaimedAt && o.serviceAreaSecondChargeClaimedAt > staleBefore) {
      throw new OOAWaiveError('The pickup fee is being charged to their card right now. Refresh in a moment to see how it went.', 409)
    }
    Object.assign(where, {
      serviceAreaSecondChargeStatus: o.serviceAreaSecondChargeStatus,
      serviceAreaSecondChargeCents: o.serviceAreaSecondChargeCents,
      serviceAreaSecondChargeInvoiceId: null,
      // Re-checked under the row lock: a charge that claimed the half after
      // our read wins, and this refuses.
      OR: [{ serviceAreaSecondChargeClaimedAt: null }, { serviceAreaSecondChargeClaimedAt: { lt: staleBefore } }],
    })
    Object.assign(data, {
      serviceAreaSecondChargeCents: 0,
      serviceAreaSecondChargeStatus: null,
      serviceAreaSecondChargeError: null,
      serviceAreaSecondChargeClaimedAt: null,
    })
  }

  if (plan.installCents > 0) {
    // Lines FIRST, then the order row — the same order the edit route takes
    // its locks in (it rewrites every line, then updates the order), so the
    // two can't deadlock. An edit that committed since our read replaced the
    // lines with new ids, so this deletes fewer than it read and refuses. One
    // still in flight holds those rows: this waits for it, then refuses the
    // same way. And one that starts after this blocks on these rows and then
    // fails its own serviceAreaFeeWaivedAt guard.
    const deleted = await tx.orderItem.deleteMany({
      where: { id: { in: surchargeLines.map((l) => l.id) }, orderId: o.id },
    })
    if (deleted.count !== surchargeLines.length) throw new OOAWaiveError(CHANGED, 409)
  }

  const updated = await tx.order.updateMany({ where, data })
  if (updated.count !== 1) throw new OOAWaiveError(CHANGED, 409)

  return {
    orderNumber: o.orderNumber,
    installCents: plan.installCents,
    pickupCents: plan.pickupCents,
    before,
    after,
  }
}
