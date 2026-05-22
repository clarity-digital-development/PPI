import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function getCurrentUser() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  })

  return user
}

export async function requireAuth() {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

export async function requireAdmin() {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  if (user.role !== 'admin') {
    throw new Error('Forbidden')
  }

  return user
}

/**
 * True for Pink Posts internal admins AND for RE team admins (who manage a
 * team of agents and place orders on their behalf). Use this for admin
 * pages/endpoints that a team_admin should ALSO have access to — but be aware
 * a team_admin is scoped to their own team and you must enforce that yourself.
 */
export function isAdminOrTeamAdmin(user: { role: string }): boolean {
  return user.role === 'admin' || user.role === 'team_admin'
}

/**
 * Whether `actor` can act on behalf of `targetUserId`:
 *  - Pink Posts admins can act for any customer
 *  - Team admins can only act for customers in their own team
 *  - Regular customers can only act for themselves
 */
export async function canActOnBehalfOf(
  actor: { id: string; role: string; teamId: string | null },
  targetUserId: string
): Promise<boolean> {
  if (actor.id === targetUserId) return true
  if (actor.role === 'admin') return true
  if (actor.role === 'team_admin' && actor.teamId) {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { teamId: true },
    })
    return !!target && target.teamId === actor.teamId
  }
  return false
}

export function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `PPI-${timestamp}-${random}`
}
