import { prisma } from '@/lib/prisma'
import { chargePaymentMethod } from '@/lib/stripe'
import { getStripeErrorMessage } from '@/lib/stripe/server'

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
 */
export async function chargeSecondOutOfAreaFee(orderId: string): Promise<void> {
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

    if (!payer?.stripeCustomerId || !paymentMethod) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          serviceAreaSecondChargeStatus: 'failed',
          serviceAreaSecondChargeError: 'No payment method on file to charge.',
        },
      })
      return
    }

    const paymentIntent = await chargePaymentMethod(
      payer.stripeCustomerId,
      paymentMethod.stripePaymentMethodId,
      order.serviceAreaSecondChargeCents,
      'Out of Area Service Fee — pickup',
      { orderId: order.id, kind: 'service_area_second_charge' },
      `oa-second-charge:${order.id}`,
    )

    if (paymentIntent.status !== 'succeeded') {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          serviceAreaSecondChargeStatus: 'failed',
          serviceAreaSecondChargeError: 'Card requires authentication and could not be charged automatically.',
        },
      })
      return
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        serviceAreaSecondChargeStatus: 'paid',
        serviceAreaSecondChargePaymentIntentId: paymentIntent.id,
        serviceAreaSecondChargedAt: new Date(),
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
        },
      })
      .catch(() => {})
  }
}
