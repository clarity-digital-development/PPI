import { prisma } from '@/lib/prisma'

export interface RefundRecipient {
  // Recipient userId — surfaced so callers can pass it to the email helper
  // for per-user preference gating (emailOrderConfirmations).
  id: string
  email: string
  fullName: string
  role: 'broker' | 'self' | 'customer'
}

interface OrderForRecipient {
  userId: string
  placedByUserId: string | null
  user: {
    id: string
    email: string
    fullName: string | null
    name: string | null
    role: string
    teamId: string | null
  }
}

/**
 * Resolve who should receive the refund-confirmation email for an order.
 *
 * Per locked decision (2026-06-02): brokers (team_admins) get the email,
 * not the agents who placed under them.
 *
 *   1. If order.placedByUserId is set, that user is the team_admin who
 *      placed the order on behalf of an agent → email them.
 *   2. Else if order.user is themselves a team_admin → email them.
 *   3. Else if order.user has a teamId, find the team_admin for that
 *      team and email them.
 *   4. Else (regular customer with no team) → email order.user directly.
 */
export async function resolveRefundRecipient(
  order: OrderForRecipient
): Promise<RefundRecipient> {
  // (1) placed-on-behalf-of: the placer IS the broker.
  if (order.placedByUserId) {
    const placer = await prisma.user.findUnique({
      where: { id: order.placedByUserId },
      select: { id: true, email: true, fullName: true, name: true },
    })
    if (placer) {
      return {
        id: placer.id,
        email: placer.email,
        fullName: placer.fullName || placer.name || placer.email,
        role: 'broker',
      }
    }
  }

  // (2) order.user is themselves a team_admin.
  if (order.user.role === 'team_admin') {
    return {
      id: order.user.id,
      email: order.user.email,
      fullName: order.user.fullName || order.user.name || order.user.email,
      role: 'self',
    }
  }

  // (3) order.user is an agent on a team — find their team_admin.
  if (order.user.teamId) {
    const teamAdmin = await prisma.user.findFirst({
      where: { teamId: order.user.teamId, role: 'team_admin' },
      select: { id: true, email: true, fullName: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
    if (teamAdmin) {
      return {
        id: teamAdmin.id,
        email: teamAdmin.email,
        fullName: teamAdmin.fullName || teamAdmin.name || teamAdmin.email,
        role: 'broker',
      }
    }
  }

  // (4) regular customer, no team association → email them directly.
  return {
    id: order.user.id,
    email: order.user.email,
    fullName: order.user.fullName || order.user.name || order.user.email,
    role: 'customer',
  }
}
