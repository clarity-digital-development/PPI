import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendPasswordCodeEmail } from '@/lib/email'
import { CODE_PREFIX, CODE_TTL_MS, MAX_CODES_PER_DAY, RESEND_COOLDOWN_MS, codeToken, newCode, normalizeEmail } from '@/lib/passwords/code'

// POST /api/auth/password-code — email a 6-digit code for choosing a new
// password on the sign-in page (lib/passwords/code.ts).
//
// { email, firstSignIn: true } is sent after a failed sign-in: a code goes out
// only when the account exists and has no password yet (carried over to the
// new site), and the reply says whether one did, so the page knows to switch
// to "choose a new password". Without firstSignIn (the "New password" link)
// the reply never says whether the account exists.
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
    message: 'Too many code requests. Please try again in 15 minutes.',
  })
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({}))
    const email = normalizeEmail(body?.email)
    if (!email) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }
    const firstSignIn = body?.firstSignIn === true

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, password: true } })
    const eligible = !!user && (!firstSignIn || !user.password)
    if (!eligible) {
      return NextResponse.json(firstSignIn ? { codeSent: false } : { codeSent: true })
    }

    // One email a minute per address, and a daily cap: each code allows
    // MAX_ATTEMPTS guesses, so the cap is what bounds guessing against one
    // account (lib/passwords/code.ts). Checked and written under a per-email
    // lock so parallel requests can't each slip a live code past the limits.
    const code = newCode()
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'password-code:' + email}))`
      const codeRows = { email, token: { startsWith: CODE_PREFIX } }
      // Rows past the counting window are only clutter (and could collide
      // with a new code's token).
      await tx.passwordResetToken.deleteMany({
        where: { ...codeRows, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      })
      const recent = await tx.passwordResetToken.count({
        where: { ...codeRows, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
      })
      if (recent > 0) return { kind: 'cooldown' as const }
      const today = await tx.passwordResetToken.count({
        where: { ...codeRows, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      })
      if (today >= MAX_CODES_PER_DAY) return { kind: 'cap' as const }
      // Older codes stop working, but their rows stay for the daily count.
      await tx.passwordResetToken.updateMany({
        where: { ...codeRows, expires: { gt: new Date() } },
        data: { expires: new Date() },
      })
      const row = await tx.passwordResetToken.create({
        data: { email, token: codeToken(email, code), expires: new Date(Date.now() + CODE_TTL_MS) },
        select: { id: true },
      })
      return { kind: 'created' as const, id: row.id }
    })
    if (outcome.kind === 'cooldown') return NextResponse.json({ codeSent: true, alreadySent: true })
    if (outcome.kind === 'cap') {
      return NextResponse.json(
        { error: 'Too many codes were requested for this email today. Please try again tomorrow, or call or text 859-395-8188.' },
        { status: 429 },
      )
    }
    const row = { id: outcome.id }

    // Resend returns { error } instead of throwing on a rejected send.
    const result = await sendPasswordCodeEmail(email, code, !user!.password).catch((err) => ({ error: err }))
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      console.error('[password-code] email failed:', result.error)
      await prisma.passwordResetToken.deleteMany({ where: { id: row.id } })
      return NextResponse.json(
        { error: "We couldn't send the email just now. Please try again in a minute." },
        { status: 502 },
      )
    }

    return NextResponse.json({ codeSent: true })
  } catch (error) {
    console.error('[password-code] send failed:', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
