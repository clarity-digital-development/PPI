import { prisma } from '@/lib/prisma'
import { chargePaymentMethod } from '@/lib/stripe'
import { getStripeErrorMessage } from '@/lib/stripe/server'

// A card charge takes seconds. A claim older than this belongs to a request
// that died mid-charge; it may be charged (or removed) again — the Stripe
// idempotency key below returns the same payment for 24h, so a re-charge of
// one that did go through records it instead of charging twice.
const STALE_CLAIM_MS = 10 * 60_000

/**
 * Collects the second half of a split out-of-area fee when removal gets
 * scheduled for an order that has one pending (Ryan, 2026-07-09/12).
 * No-ops silently for every other order — no split fee on this order, the
 * order was cancelled, or the second half already moved on (paid, failed, or
 * queued for an invoice) from an earlier call.
 *
 * How it's collected depends on how the payer is billed TODAY: an
 * invoice-billing payer's card is never charged automatically — the rule
 * order completion, the admin charge button and the post-rental cron all
 * enforce on the payer's current flag too.
 *
 * - Invoice payer (Ryan, 2026-09-28: "add to invoice instead of charge
 *   card"): the half is queued as 'pending_invoice' and the next bundled
 *   Invoice picks it up as an "Out-of-area pickup" line — see
 *   lib/invoices/ooa-pickups.ts. Nothing touches Stripe.
 * - Everyone else: the payer's default saved card is charged off-session, the
 *   same way the admin service-request invoice route does. Per Ryan: a failed
 *   charge must NEVER block removal from being scheduled — it just gets
 *   flagged on the order for admin to retry or invoice manually ("I'll send
 *   invoice worst case").
 *
 * This function never throws; callers can fire-and-forget it after the
 * removal-scheduling write succeeds.
 *
 * `retryAttempt` is set by the admin retry of a FAILED charge. Stripe saves
 * the first response for an idempotency key — declines included — for 24h,
 * so re-using the removal-time key would just replay the decline (or, with a
 * new card, be rejected as a different request). Each admin retry is its own
 * attempt with its own key; the removal-time call and anything re-running it
 * keep the original key, so a charge that went through is never taken twice.
 */
export async function chargeSecondOutOfAreaFee(
  orderId: string,
  opts?: { retryAttempt?: string }
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        placedByUserId: true,
        status: true,
        serviceAreaSecondChargeCents: true,
        serviceAreaSecondChargeStatus: true,
      },
    })

    if (
      !order ||
      order.serviceAreaSecondChargeStatus !== 'pending' ||
      !order.serviceAreaSecondChargeCents ||
      order.serviceAreaSecondChargeCents <= 0
    ) {
      return
    }
    // A cancelled (or refunded — refunds cancel) order owes no pickup fee.
    if (order.status === 'cancelled') return

    // Payer mirrors app/api/orders/route.ts's resolution at order-creation
    // time: placedByUserId (team_admin on-behalf-of) if set, else the
    // order's own userId — always whoever was billed for the order.
    const payer = await prisma.user.findUnique({
      where: { id: order.placedByUserId ?? order.userId },
      select: { id: true, stripeCustomerId: true, invoiceBilling: true },
    })

    if (payer?.invoiceBilling) {
      // Conditional so two removal requests racing each other queue it once.
      await prisma.order.updateMany({
        where: { id: orderId, serviceAreaSecondChargeStatus: 'pending' },
        data: { serviceAreaSecondChargeStatus: 'pending_invoice', serviceAreaSecondChargeError: null },
      })
      return
    }

    const paymentMethod = payer?.stripeCustomerId
      ? (await prisma.paymentMethod.findFirst({ where: { userId: payer.id, isDefault: true } })) ||
        (await prisma.paymentMethod.findFirst({ where: { userId: payer.id } }))
      : null

    // Failure writes are conditional on 'pending', like the catch below: an
    // admin can cancel the half ("Remove out-of-area fee") while this runs,
    // and a 'failed' written over that would offer a retry of a $0 charge.
    if (!payer?.stripeCustomerId || !paymentMethod) {
      await prisma.order.updateMany({
        where: { id: orderId, serviceAreaSecondChargeStatus: 'pending' },
        data: {
          serviceAreaSecondChargeStatus: 'failed',
          serviceAreaSecondChargeError: 'No payment method on file to charge.',
        },
      })
      return
    }

    // Claim the half before calling Stripe. "Remove out-of-area fee" refuses a
    // claimed half, so the two can't both win: if the removal landed first
    // this matches nothing and the card is never touched; if this lands
    // first the removal tells the admin a charge is in progress. Also keeps
    // two removal requests racing each other from both reaching Stripe.
    const claimed = await prisma.order.updateMany({
      where: {
        id: orderId,
        serviceAreaSecondChargeStatus: 'pending',
        serviceAreaSecondChargeCents: order.serviceAreaSecondChargeCents,
        OR: [
          { serviceAreaSecondChargeClaimedAt: null },
          { serviceAreaSecondChargeClaimedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
        ],
      },
      data: { serviceAreaSecondChargeClaimedAt: new Date() },
    })
    if (claimed.count !== 1) return

    const paymentIntent = await chargePaymentMethod(
      payer.stripeCustomerId,
      paymentMethod.stripePaymentMethodId,
      order.serviceAreaSecondChargeCents,
      'Out of Area Service Fee — pickup',
      { orderId: order.id, kind: 'service_area_second_charge' },
      `oa-second-charge:${order.id}${opts?.retryAttempt ? `:retry-${opts.retryAttempt}` : ''}`,
    )

    if (paymentIntent.status !== 'succeeded') {
      await prisma.order.updateMany({
        where: { id: orderId, serviceAreaSecondChargeStatus: 'pending' },
        data: {
          serviceAreaSecondChargeStatus: 'failed',
          serviceAreaSecondChargeError: 'Card requires authentication and could not be charged automatically.',
          serviceAreaSecondChargeClaimedAt: null,
        },
      })
      return
    }

    // Unconditional: the card WAS charged, so it gets recorded whatever else
    // happened meanwhile — including the amount, in case a removal slipped in
    // after a claim went stale.
    await prisma.order.update({
      where: { id: orderId },
      data: {
        serviceAreaSecondChargeCents: order.serviceAreaSecondChargeCents,
        serviceAreaSecondChargeStatus: 'paid',
        serviceAreaSecondChargePaymentIntentId: paymentIntent.id,
        serviceAreaSecondChargedAt: new Date(),
        serviceAreaSecondChargeClaimedAt: null,
      },
    })
  } catch (err) {
    console.error(`[out-of-area-charge] second charge failed for order ${orderId}:`, err)
    // Only a still-pending charge is marked failed: an error after the
    // invoice-queue write must not knock a queued half back to 'failed'.
    await prisma.order
      .updateMany({
        where: { id: orderId, serviceAreaSecondChargeStatus: 'pending' },
        data: {
          serviceAreaSecondChargeStatus: 'failed',
          serviceAreaSecondChargeError: getStripeErrorMessage(err) || 'The charge could not be processed.',
          serviceAreaSecondChargeClaimedAt: null,
        },
      })
      .catch(() => {})
  }
}
