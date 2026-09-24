/**
 * Default name for a Team created on an account's behalf.
 *
 * Shared by the two places that create one — adding the first roster member
 * (app/api/admin/customers/[id]/team-members) and promoting an account to
 * team_admin (app/api/admin/customers/[id]) — so the brokerage picker never
 * shows the same kind of account named two different ways. It's the name Ryan
 * sees in the "Brokerage inventory" dropdown, and he finds brokerages by the
 * person ("Rebecca Steele's Team"), so it leads with the person.
 */
export function defaultTeamName(account: {
  fullName?: string | null
  name?: string | null
  email: string
}): string {
  return `${account.fullName || account.name || account.email}'s Team`
}
