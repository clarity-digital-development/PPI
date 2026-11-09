import type { Prisma, User } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Who pays for an order (or a service request).
 *
 * Three ways an order gets a payer other than its owner (`order.userId`):
 *   - billedToUserId: the agent who placed it has "bill to broker" on
 *     (User.billToBrokerUserId), so it's billed to that broker — onto the
 *     broker's invoice or the broker's card. Stamped at creation, never
 *     changed (Ryan, 2026-11-05).
 *   - placedByUserId: a team_admin placed it on the agent's behalf, and was
 *     charged at checkout.
 *   - otherwise the owner pays.
 *
 * The rule everywhere is billedTo ?? placedBy ?? user. Use these helpers
 * instead of re-deriving it, so a new payer path can't drift.
 */
export function payerIdOf(o: {
  userId: string
  placedByUserId?: string | null
  billedToUserId?: string | null
}): string {
  return o.billedToUserId ?? o.placedByUserId ?? o.userId
}

/**
 * Prisma filter: orders whose payer is `payerId` — the same rule as
 * payerIdOf (billedTo ?? placedBy ?? user), as a query. Use it wherever
 * something is billed to "whoever pays for the order" (invoice sweeps,
 * bundling), so an order billed to a broker never lands on the agent's
 * invoice, and vice versa.
 */
export function orderPaidByWhere(payerId: string): Prisma.OrderWhereInput {
  return {
    OR: [
      { billedToUserId: payerId },
      { billedToUserId: null, placedByUserId: payerId },
      { billedToUserId: null, placedByUserId: null, userId: payerId },
    ],
  }
}

/**
 * Prisma filter: service requests whose payer is `payerId` (billedTo ??
 * requester). Service trips have no on-behalf placer.
 */
export function serviceRequestPaidByWhere(payerId: string): Prisma.ServiceRequestWhereInput {
  return {
    OR: [
      { billedToUserId: payerId },
      { billedToUserId: null, userId: payerId },
    ],
  }
}

/**
 * The broker an account's NEW orders / service trips are billed to, or null.
 * Used at creation (to stamp billedToUserId) and by checkout previews.
 *
 * Honors User.billToBrokerUserId only while it's still true that this agent
 * is the broker's: the broker is still a team_admin with a Team, and the
 * agent still has an active roster row on that Team. A broker who removed
 * the agent from their roster (or was demoted, or whose agent moved) must
 * not keep paying for them — the flag is cleared on those paths too, this is
 * the backstop. `rosterName` is the agent's name on that roster, stamped as
 * placedForAgentName so the broker's per-agent invoices include the order.
 */
export async function resolveActiveBillToBroker(user: {
  id: string
  billToBrokerUserId: string | null
}): Promise<{ broker: User; rosterName: string } | null> {
  if (!user.billToBrokerUserId) return null
  const broker = await prisma.user.findUnique({ where: { id: user.billToBrokerUserId } })
  if (!broker || broker.role !== 'team_admin' || !broker.teamId) return null
  const link = await prisma.teamMember.findFirst({
    where: { userId: user.id, teamId: broker.teamId, removedAt: null },
    select: { name: true },
  })
  if (!link) return null
  return { broker, rosterName: link.name }
}

/**
 * Contact details for the broker an order is billed to (billedToUserId), or
 * null. Used to copy the broker on confirmations/receipts (Ryan, 2026-11-09:
 * both the agent and the broker get them).
 */
export async function getBilledToContact(
  billedToUserId: string | null | undefined
): Promise<{ id: string; email: string; name: string } | null> {
  if (!billedToUserId) return null
  const b = await prisma.user.findUnique({
    where: { id: billedToUserId },
    select: { id: true, email: true, fullName: true, name: true },
  })
  return b ? { id: b.id, email: b.email, name: b.fullName || b.name || b.email } : null
}

export interface EffectivePayer {
  id: string
  email: string
  fullName: string
  // The Stripe Customer id that holds this payer's payment methods. Null when
  // the payer never paid with a card (e.g., invoice-billing customers never
  // ran through Stripe). Caller should fall through to a manual-collect outcome.
  stripeCustomerId: string | null
  // True when someone other than the order's owner pays (a broker billed via
  // billedTo, or a team_admin who placed it on behalf). Used by callers to
  // log + email under the correct identity.
  isBroker: boolean
}

interface OrderForPayer {
  userId: string
  placedByUserId: string | null
  billedToUserId?: string | null
}

export async function resolveEffectivePayer(
  order: OrderForPayer,
): Promise<EffectivePayer | null> {
  const targetId = payerIdOf(order)
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
    isBroker: targetId !== order.userId,
  }
}
