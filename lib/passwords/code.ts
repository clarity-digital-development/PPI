/**
 * Emailed 6-digit codes for choosing a new password right on the sign-in page.
 *
 * Every account rebuilt after the October 2026 move has no password, so the
 * sign-in page lets a customer pick one without a separate "Forgot password"
 * trip. The code is what proves they own the email: without it, anyone who
 * knew a customer's address could set the password and use their saved card.
 *
 * Codes reuse PasswordResetToken rows: the token column holds
 * "code:<sha256 of email:code>" (never the code itself), they expire after
 * CODE_TTL_MS, and MAX_ATTEMPTS wrong guesses kill one.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_TTL_MS = 15 * 60 * 1000
export const MAX_ATTEMPTS = 5
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

export function codeToken(email: string, code: string): string {
  return CODE_PREFIX + createHash('sha256').update(`${email}:${code}`).digest('hex')
}

export function codeMatches(storedToken: string, email: string, code: string): boolean {
  const expected = Buffer.from(codeToken(email, code))
  const actual = Buffer.from(storedToken)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
