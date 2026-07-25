import { prisma } from '@/lib/prisma'
import { chargePaymentMethod } from '@/lib/stripe'
import { getStripeErrorMessage } from '@/lib/stripe/server'

/**
 * Fires the second half of a split out-of-area fee when removal gets
 * scheduled for an order that has one pending (Ryan, 2026-07-09/12).
 * No-ops silently for every other order — no split fee on this order, or
 * the second charge already resolved (paid/failed) from an earlier call.
 *
 * Auto-charges the payer's default saved card off-session, the same way
 * the admin service-request invoice route does. Per Ryan: a failed charge
 * must NEVER block removal from being scheduled — it just gets flagged on
 * the order for admin to retry or invoice manually ("I'll send invoice
 * worst case"). This function never throws; callers can fire-and-forget it
 * after the removal-scheduling write succeeds.
 */
export async function chargeSecondOutOfAreaFee(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        placedByUserId: true,
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

    // Payer mirrors app/api/orders/route.ts's resolution at order-creation
    // time: placedByUserId (team_admin on-behalf-of) if set, else the
    // order's own userId — always whoever's card was charged originally.
    const payer = await prisma.user.findUnique({
      where: { id: order.placedByUserId ?? order.userId },
      select: { id: true, stripeCustomerId: true },
    })

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
    await prisma.order
      .update({
        where: { id: orderId },
        data: {
          serviceAreaSecondChargeStatus: 'failed',
          serviceAreaSecondChargeError: getStripeErrorMessage(err) || 'The charge could not be processed.',
        },
      })
      .catch(() => {})
  }
}
