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
 * rows (it has no try limit). A code expires after CODE_TTL_MS, MAX_ATTEMPTS
 * wrong guesses kill it, and an email gets at most MAX_CODES_PER_DAY codes,
 * so one account can take at most MAX_ATTEMPTS * MAX_CODES_PER_DAY guesses a
 * day against a million possible codes. Old codes are expired, not deleted,
 * so the daily count holds.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_TTL_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5
export const MAX_CODES_PER_DAY = 5
export const RESEND_COOLDOWN_MS = 60 * 1000
export const CODE_PREFIX = 'code:'

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
