import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clearFailedLogins } from '@/lib/rate-limit'
import { validatePassword } from '@/lib/passwords/rules'
import { CODE_PREFIX, DAY_MS, MAX_ATTEMPTS, MAX_WRONG_PER_DAY, codeLockKey, codeMatches, normalizeEmail } from '@/lib/passwords/code'

// POST /api/auth/password-code/verify — { email, code, password }. Checks the
// emailed code and sets the new password; the page then signs in with it.
//
// The guess is checked under the same per-email lock that issues codes:
// against the one live code, after taking one of its MAX_ATTEMPTS, and only
// while the email has wrong guesses left for the day (MAX_WRONG_PER_DAY across
// every code, so asking for new codes doesn't buy more guesses). A match
// consumes the code inside the lock.
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 30,
    message: 'Too many tries. Please wait 15 minutes and try again.',
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

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${codeLockKey(email)}))`
      const now = new Date()
      const codeRows = { email, token: { startsWith: CODE_PREFIX } }
      const spent = await tx.passwordResetToken.aggregate({
        where: { ...codeRows, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
        _sum: { attempts: true },
      })
      if ((spent._sum.attempts ?? 0) >= MAX_WRONG_PER_DAY) return { kind: 'budget' as const }

      const current = await tx.passwordResetToken.findFirst({
        where: { ...codeRows, expires: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, token: true, attempts: true },
      })
      if (!current) return { kind: 'expired' as const }
      if (current.attempts >= MAX_ATTEMPTS) return { kind: 'exhausted' as const }

      if (codeMatches(current.token, email, code)) {
        await tx.passwordResetToken.delete({ where: { id: current.id } })
        return { kind: 'match' as const }
      }
      await tx.passwordResetToken.update({ where: { id: current.id }, data: { attempts: { increment: 1 } } })
      return { kind: 'wrong' as const, left: MAX_ATTEMPTS - (current.attempts + 1) }
    })

    switch (outcome.kind) {
      case 'budget':
        return NextResponse.json(
          { error: 'Too many wrong codes for this email today. Use "Email me a reset link instead" below, or try again tomorrow.' },
          { status: 429 },
        )
      case 'expired':
        return NextResponse.json({ error: 'That code has expired. Send a new code.' }, { status: 400 })
      case 'exhausted':
        return NextResponse.json({ error: 'Too many wrong tries for that code. Send a new code.' }, { status: 400 })
      case 'wrong':
        return NextResponse.json(
          {
            error: outcome.left > 0
              ? `That code doesn't match. ${outcome.left} ${outcome.left === 1 ? 'try' : 'tries'} left.`
              : 'That code doesn’t match, and it has no tries left. Send a new code.',
          },
          { status: 400 },
        )
    }

    const hashed = await bcrypt.hash(password, 12)
    const updated = await prisma.user.updateMany({
      where: { email },
      data: { password: hashed, emailVerified: new Date() },
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
