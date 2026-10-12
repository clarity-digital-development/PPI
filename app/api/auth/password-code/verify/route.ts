import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clearFailedLogins } from '@/lib/rate-limit'
import { validatePassword } from '@/lib/passwords/rules'
import { CODE_PREFIX, MAX_ATTEMPTS, codeMatches, normalizeEmail } from '@/lib/passwords/code'

// POST /api/auth/password-code/verify — { email, code, password }. Checks the
// emailed code and sets the new password; the page then signs in with it.
//
// Each guess first takes one of the code's MAX_ATTEMPTS (an atomic increment
// on rows still under the limit) and is only checked if it got one, so
// parallel guesses can't get past the limit. A matching code is consumed by
// deleting its row; only the request whose delete removed it sets the password.
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 20,
    message: 'Too many tries. Please wait 15 minutes and send a new code.',
  })
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({}))
    const email = normalizeEmail(body?.email)
    const code = typeof body?.code === 'string' ? body.code.replace(/\D/g, '') : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!email || code.length !== 6) {
      return NextResponse.json({ error: 'Enter the 6-digit code from the email.' }, { status: 400 })
    }
    const rules = validatePassword(password)
    if (!rules.valid) {
      return NextResponse.json({ error: rules.errors.join('. ') }, { status: 400 })
    }

    const now = new Date()
    const live = { email, token: { startsWith: CODE_PREFIX }, expires: { gt: now } }
    const took = await prisma.passwordResetToken.updateMany({
      where: { ...live, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    })
    if (took.count === 0) {
      const exhausted = await prisma.passwordResetToken.count({ where: live })
      return NextResponse.json(
        {
          error: exhausted
            ? 'Too many wrong tries for that code. Send a new code.'
            : 'That code has expired. Send a new code.',
        },
        { status: 400 },
      )
    }

    const rows = await prisma.passwordResetToken.findMany({
      where: { ...live, attempts: { lte: MAX_ATTEMPTS } },
      select: { id: true, token: true, attempts: true },
    })
    const match = rows.find((r) => codeMatches(r.token, email, code))
    if (!match) {
      const used = rows.length ? Math.max(...rows.map((r) => r.attempts)) : MAX_ATTEMPTS
      const left = Math.max(0, MAX_ATTEMPTS - used)
      return NextResponse.json(
        {
          error: left > 0
            ? `That code doesn't match. ${left} ${left === 1 ? 'try' : 'tries'} left.`
            : 'That code doesn’t match, and it has no tries left. Send a new code.',
        },
        { status: 400 },
      )
    }

    const consumed = await prisma.passwordResetToken.deleteMany({ where: { id: match.id } })
    if (consumed.count !== 1) {
      return NextResponse.json({ error: 'That code was already used. Send a new code.' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(password, 12)
    const updated = await prisma.user.updateMany({
      where: { email },
      data: { password: hashed, emailVerified: now },
    })
    if (updated.count !== 1) {
      return NextResponse.json({ error: 'No account was found for that email.' }, { status: 400 })
    }
    // Any other outstanding codes or reset links for this email are now moot.
    await prisma.passwordResetToken.deleteMany({ where: { email } })
    clearFailedLogins(email)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[password-code] verify failed:', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
