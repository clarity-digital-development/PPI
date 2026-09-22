/**
 * SERVER ONLY — imports prisma. The pure fee policy is in ./pickup-fee.
 */
import { prisma } from '@/lib/prisma'

/**
 * Whether the account PAYING for the order belongs to a team with the
 * sign-pickup waiver. Only brokerage logins carry User.teamId (agents linked to
 * a brokerage for inventory deliberately do not — see
 * app/api/admin/customers/[id]/brokerage), so this is exactly "the broker is
 * paying".
 */
export async function isPickupFeeWaivedForPayer(payerUserId: string | null | undefined): Promise<boolean> {
  if (!payerUserId) return false
  const payer = await prisma.user.findUnique({
    where: { id: payerUserId },
    select: { team: { select: { pickupFeeWaived: true } } },
  })
  return !!payer?.team?.pickupFeeWaived
}
