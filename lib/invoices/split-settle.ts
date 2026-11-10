import { prisma } from '@/lib/prisma'

export interface SplitSettleResult {
  orderCount: number
  serviceRequestCount: number
  ooaPickupCount: number
  postRentalCount: number
}

/**
 * 50/50 split invoice: once every share is paid, flip the invoice and every
 * line on it to paid — the same tables a normal invoice payment flips.
 *
 * The share check, the sent→paid claim and the cascade run in ONE
 * transaction, so a failure part-way leaves nothing committed and the next
 * attempt (a Stripe retry, or an admin Mark paid) settles it cleanly. The
 * claim is conditional on status 'sent', so two shares landing at once settle
 * the invoice exactly once. Returns null when there's nothing to do (a share
 * is still unpaid, or the invoice is already settled/void).
 *
 * No payment intent is stamped on the orders/SRs: each share has its own PI,
 * and charge.refunded matches orders by PI — stamping one share's PI would
 * reconcile a refund of that share as a full refund of every order.
 */
export async function settleSplitInvoiceIfComplete(
  invoiceId: string,
  paidAt: Date,
): Promise<SplitSettleResult | null> {
  return prisma.$transaction(async (tx) => {
    const shares = await tx.invoicePayment.findMany({ where: { invoiceId }, select: { status: true, paidAt: true } })
    if (shares.length === 0 || shares.some((s) => s.status !== 'paid')) return null
    // Paid when the LAST share was paid — not when a retry or a close-out
    // click finally settled it.
    const lastShareAt = shares.reduce<Date | null>(
      (latest, s) => (s.paidAt && (!latest || s.paidAt > latest) ? s.paidAt : latest),
      null,
    )
    paidAt = lastShareAt ?? paidAt
    const claim = await tx.invoice.updateMany({
      where: { id: invoiceId, status: 'sent' },
      data: { status: 'paid', paidAt },
    })
    if (claim.count === 0) return null
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { orders: { select: { id: true } }, serviceRequests: { select: { id: true } } },
    })
    const orderIds = inv?.orders.map((o) => o.id) ?? []
    const srIds = inv?.serviceRequests.map((sr) => sr.id) ?? []
    await tx.order.updateMany({
      where: { id: { in: orderIds } },
      data: { paymentStatus: 'succeeded', paidAt },
    })
    await tx.serviceRequest.updateMany({
      where: { id: { in: srIds } },
      data: { invoiceStatus: 'paid', invoicePaidAt: paidAt },
    })
    const pickups = await tx.order.updateMany({
      where: { serviceAreaSecondChargeInvoiceId: invoiceId, serviceAreaSecondChargeStatus: 'pending_invoice' },
      data: { serviceAreaSecondChargeStatus: 'paid', serviceAreaSecondChargedAt: paidAt },
    })
    const rentals = await tx.postRentalCharge.updateMany({
      where: { invoiceId, status: 'pending_invoice' },
      data: { status: 'succeeded', succeededAt: paidAt },
    })
    return {
      orderCount: orderIds.length,
      serviceRequestCount: srIds.length,
      ooaPickupCount: pickups.count,
      postRentalCount: rentals.count,
    }
  })
}

/**
 * A share whose payment was refunded is owed again. Put it back to unpaid,
 * dropping its used-up link (that link's one checkout already happened, so
 * it can't take another payment) so the next send mints a fresh one. The
 * refunded payment stays on the audit trail (InvoiceShareRefunded).
 * Returns true when the share was reopened.
 */
export async function reopenRefundedShare(shareId: string): Promise<boolean> {
  const res = await prisma.invoicePayment.updateMany({
    where: { id: shareId, status: 'refunded' },
    data: {
      status: 'pending',
      paidAt: null,
      paymentIntentId: null,
      checkoutSessionId: null,
      checkoutUrl: null,
      emailStatus: null,
      emailError: null,
    },
  })
  return res.count > 0
}
