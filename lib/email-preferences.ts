import { prisma } from '@/lib/prisma'

// The 3 persisted notification flags on User. Keep in sync with prisma schema.
export type EmailPrefFlag =
  | 'emailOrderConfirmations'
  | 'emailServiceRequests'
  | 'emailMarketing'

// Minimal shape callers can pass to avoid an extra DB roundtrip per send.
export interface UserEmailPrefs {
  id?: string | null
  emailOrderConfirmations?: boolean | null
  emailServiceRequests?: boolean | null
  emailMarketing?: boolean | null
}

/**
 * Returns true if a transactional email matching `flag` should be sent to
 * `userId` (or the inline `userPrefs` if provided to skip the DB lookup).
 *
 * Fail-open semantics: an unknown recipient, missing user, or DB error all
 * return true. Transactional email should never be silently dropped because
 * of a preference-lookup hiccup — that's a worse failure mode than over-
 * emailing. The opt-out is an opinion, not a contract.
 *
 * Admin notifications (ADMIN_EMAIL) and security-critical mail (password
 * reset) MUST NOT call this — they bypass prefs entirely.
 */
export async function shouldSendEmail(
  userId: string | null | undefined,
  flag: EmailPrefFlag,
  userPrefs?: UserEmailPrefs | null,
): Promise<boolean> {
  // Inline shortcut — caller already loaded the user, no need for a 2nd query.
  if (userPrefs && typeof userPrefs[flag] === 'boolean') {
    return userPrefs[flag] as boolean
  }

  if (!userId) return true // unknown recipient — fail open

  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        emailOrderConfirmations: true,
        emailServiceRequests: true,
        emailMarketing: true,
      },
    })
    if (!u) return true // user vanished mid-flight — fail open
    return Boolean(u[flag])
  } catch (err) {
    console.error('[email-prefs] lookup failed, failing open', err)
    return true // DB hiccup must not block transactional email
  }
}

// Console-only suppression line so Railway logs show real-time opt-outs
// without bloating the AuditLog table.
export function logSuppressed(helper: string, userId: string | null | undefined, flag: EmailPrefFlag) {
  console.log(`[email] EMAIL_SUPPRESSED_BY_PREFERENCE helper=${helper} userId=${userId ?? 'unknown'} flag=${flag}`)
}
