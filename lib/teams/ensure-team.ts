import { prisma } from '@/lib/prisma'
import { defaultTeamName } from './team-name'

class LostTeamClaim extends Error {}

/**
 * Give an account a Team if it has none, safely under concurrency.
 *
 * Two paths create one — adding the first roster member and saving a
 * team_admin that has no team — and both used to read `teamId`, then create
 * and write. At Postgres's READ COMMITTED that read takes no lock, so two
 * overlapping saves (two tabs, two staff, a save racing a roster add) each saw
 * null, each created a Team, and the last write won. The loser's Team was
 * orphaned, and on the roster path so was the member just added to it: gone
 * from the roster and from the brokerage pool.
 *
 * So the claim is the write itself: set teamId only WHERE it is still null.
 * If nothing matched, someone else got there first — roll back our Team and
 * use theirs.
 *
 * Call it only after reading teamId as null; it always creates a Team first.
 */
export async function ensureTeamFor(account: {
  id: string
  fullName?: string | null
  name?: string | null
  email: string
}): Promise<{ teamId: string; created: boolean }> {
  try {
    const teamId = await prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { name: defaultTeamName(account) } })
      const claimed = await tx.user.updateMany({
        where: { id: account.id, teamId: null },
        data: { teamId: team.id },
      })
      if (claimed.count === 0) throw new LostTeamClaim()
      return team.id
    })
    return { teamId, created: true }
  } catch (err) {
    if (!(err instanceof LostTeamClaim)) throw err
    const winner = await prisma.user.findUnique({
      where: { id: account.id },
      select: { teamId: true },
    })
    if (!winner?.teamId) throw new Error('Lost the team claim but the account still has no team')
    return { teamId: winner.teamId, created: false }
  }
}
