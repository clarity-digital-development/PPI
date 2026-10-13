/**
 * Emailed 6-digit codes for choosing a new password right on the sign-in page.
 *
 * Every account rebuilt after the October 2026 move has no password, so the
 * sign-in page lets a customer pick one without a separate "Forgot password"
 * trip. The code is what proves they own the email: without it, anyone who
 * knew a customer's address could set the password and use their saved card.
 *
 * Codes reuse PasswordResetToken rows. The token column holds
 * "code:<HMAC of email:code>" keyed with the server secret, so it can't be
 * computed from an email and a guess; /api/auth/reset-password refuses these
 * rows (it has no try limit). One code is live per email at a time, issued
 * and checked under a per-email database lock. A code expires after
 * CODE_TTL_MS and takes MAX_ATTEMPTS wrong guesses; across all its codes an
 * email gets MAX_WRONG_PER_DAY wrong guesses a day (so asking for new codes
 * doesn't buy more) and MAX_CODES_PER_DAY emails. Old codes are expired, not
 * deleted, so those daily counts hold. Someone who hits a limit can still use
 * the reset-link flow (/forgot-password), which these limits don't touch.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_TTL_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5
export const MAX_CODES_PER_DAY = 10
export const MAX_WRONG_PER_DAY = 15
export const DAY_MS = 24 * 60 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000
export const CODE_PREFIX = 'code:'
// Reset links an admin texts to a customer (app/api/admin/customers/[id]/
// password-link). /reset-password redeems them; /forgot-password leaves them
// alone, so asking for an emailed link (which may bounce) doesn't cancel one.
export const LINK_PREFIX = 'link-'

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.toLowerCase().trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET is required to issue sign-in codes')
  return s
}

export function codeToken(email: string, code: string): string {
  return CODE_PREFIX + createHmac('sha256', secret()).update(`${email}:${code}`).digest('hex')
}

export function codeMatches(storedToken: string, email: string, code: string): boolean {
  const expected = Buffer.from(codeToken(email, code))
  const actual = Buffer.from(storedToken)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// Pink Posts' own logins with no mailbox behind them (admin@ is the original
// admin account, test@ the shop's test customer). Their codes and reset links
// go to the shop inbox instead, or nobody could ever receive them.
const SHOP_INBOX = 'contact@pinkposts.com'
const NO_MAILBOX = new Set(['admin@pinkposts.com', 'test@pinkposts.com'])

// Where sign-in mail for this login actually goes; null when it's the login
// itself.
export function redirectedInbox(email: string): string | null {
  return NO_MAILBOX.has(email.toLowerCase().trim()) ? SHOP_INBOX : null
}

// Advisory-lock key shared by issuing and checking codes for one email.
export function codeLockKey(email: string): string {
  return `password-code:${email}`
}
