import { prisma } from '@/lib/prisma'

/**
 * Resolves the "assigned agent" label on an order for inclusion in admin emails.
 *
 * Source of truth is `Order.placedForAgentName` — the free-text label captured
 * at checkout when a team_admin (Peggy & similar) places an order tagged to one
 * of their team agents. The matching TeamMember row carries the phone number.
 *
 * Returns null when no agent was tagged. Returns `{ name, phone: null }` when
 * a name was tagged but no TeamMember row matches (free-text fallback).
 */
export async function resolveAssignedAgent(opts: {
  placedForAgentName: string | null
  teamId: string | null
}): Promise<{ name: string; phone: string | null } | null> {
  const name = opts.placedForAgentName?.trim()
  if (!name) return null
  if (!opts.teamId) return { name, phone: null }
  const member = await prisma.teamMember.findFirst({
    where: {
      teamId: opts.teamId,
      name: { equals: name, mode: 'insensitive' },
      removedAt: null,
    },
    select: { phone: true },
  })
  return { name, phone: member?.phone ?? null }
}
