import { prisma } from '@/lib/prisma'

/**
 * For team_admin-on-behalf-of-agent orders, the agent (`order.userId`) is the
 * "order owner" but the team_admin (`order.placedByUserId`) is the human whose
 * Stripe customer was charged at checkout and whose card on file we must hit
 * for any subsequent edit-time diff charges. This helper centralizes that
 * resolution so the edit route and any future re-charge surface don't drift.
 *
 * Mirrors the pattern in app/api/orders/route.ts (lines 108-123): there
 * `payer = actor` and the original PaymentIntent is created against
 * `payer.stripeCustomerId`. We back into the same answer post-hoc by
 * preferring `placedByUserId` then falling back to `userId`.
 *
 * Returns null on lookup failure (orphaned ids), in which case the caller
 * should treat it as a "no_payment_method" outcome — no card to charge.
 */
export interface EffectivePayer {
  id: string
  email: string
  fullName: string
  // The Stripe Customer id that holds this payer's payment methods. Null when
  // the payer never paid with a card (e.g., invoice-billing customers never
  // ran through Stripe). Caller should fall through to a manual-collect outcome.
  stripeCustomerId: string | null
  // True when the payer is the placedByUserId (i.e., a team_admin paid on
  // behalf). Used by callers to log + email under the correct identity.
  isBroker: boolean
}

interface OrderForPayer {
  userId: string
  placedByUserId: string | null
}

export async function resolveEffectivePayer(
  order: OrderForPayer,
): Promise<EffectivePayer | null> {
  const targetId = order.placedByUserId ?? order.userId
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, email: true, fullName: true, name: true, stripeCustomerId: true },
  })
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName || user.name || user.email,
    stripeCustomerId: user.stripeCustomerId,
    isBroker: !!order.placedByUserId,
  }
}
