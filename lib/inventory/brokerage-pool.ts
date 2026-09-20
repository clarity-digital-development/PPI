/**
 * Which brokerage inventory pool, if any, an agent may order from
 * (Ryan, Slack 2026-09-08).
 *
 * Ryan's description: *"Agent logs on and goes to order their sign install.
 * When they do, they select 1 brokerage sign from the admin inventory and one
 * name riders. The system takes the brokerage sign from the admin inventory and
 * the rider from their personal inventory."*
 *
 * The link is carried by the ROSTER ROW (`TeamMember.userId`), never by
 * `User.teamId` — see `app/api/admin/customers/[id]/brokerage/route.ts` for why
 * that distinction matters (teamId is the authority field and would make the
 * brokerage a payer and an act-as principal). So the pool is resolved here:
 *
 *     agent login -> their active roster row -> that row's team
 *                 -> the team_admin account that physically holds the inventory
 *
 * Inventory is stored under the team_admin's `userId`, which is why the owner
 * id, not the team id, is what every consumer actually needs.
 *
 * Returns null for the overwhelming majority of users, who have no roster row.
 */
import { prisma } from '@/lib/prisma'

export interface BrokeragePool {
  /** The Team the agent is rostered on. */
  teamId: string
  /** The team_admin account whose `userId` owns the pool's inventory rows. */
  ownerUserId: string
  /** Brokerage name, for labelling items in the picker. */
  name: string
}

/**
 * Resolve the pool for one agent. Null when they are not linked, when the
 * roster row was removed, or when the team has no team_admin account holding
 * inventory.
 */
export async function resolveBrokeragePool(userId: string): Promise<BrokeragePool | null> {
  if (!userId) return null

  // removedAt matters: taking an agent off the roster is how a brokerage
  // revokes pool access, so a soft-removed row must not resolve.
  const link = await prisma.teamMember.findFirst({
    where: { userId, removedAt: null },
    select: { teamId: true, team: { select: { id: true, name: true } } },
  })
  if (!link?.team) return null

  // The account the inventory actually hangs off. A team can in principle have
  // more than one team_admin login; order by createdAt so the pool owner is
  // stable rather than whichever row Postgres returns first.
  const owner = await prisma.user.findFirst({
    where: { teamId: link.teamId, role: 'team_admin' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!owner) return null

  // An agent who is somehow their own pool owner would otherwise get their own
  // inventory listed twice, once per source.
  if (owner.id === userId) return null

  return { teamId: link.teamId, ownerUserId: owner.id, name: link.team.name }
}

/**
 * Every user id whose inventory `userId` may legitimately draw from: their own,
 * plus the brokerage pool when linked. Used both to build the picker query and
 * to authorise the ids that come back on the order.
 */
export async function inventoryOwnerIdsFor(userId: string): Promise<string[]> {
  const pool = await resolveBrokeragePool(userId)
  return pool ? [userId, pool.ownerUserId] : [userId]
}
