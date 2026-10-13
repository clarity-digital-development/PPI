import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendPasswordCodeEmail } from '@/lib/email'
import {
  CODE_PREFIX,
  CODE_TTL_MS,
  DAY_MS,
  MAX_ATTEMPTS,
  MAX_CODES_PER_DAY,
  RESEND_COOLDOWN_MS,
  codeLockKey,
  codeToken,
  newCode,
  normalizeEmail,
  redirectedInbox,
} from '@/lib/passwords/code'

// POST /api/auth/password-code — email a 6-digit code for choosing a new
// password on the sign-in page (lib/passwords/code.ts).
//
// { email, firstSignIn: true } is sent after a failed sign-in: a code goes out
// only when the account exists and has no password yet (carried over to the
// new site), and the reply says whether one did, so the page knows to switch
// to "choose a new password". Without firstSignIn (the "Choose a new
// password" link) the reply never says whether the account exists.
//
// A code still in the customer's inbox is kept: only { resend: true } (the
// "Send a new code" button) replaces it, at most once a minute, and the old
// code stops working only once the new email has gone out.
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 30,
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
    const resend = body?.resend === true
    // Named whether or not the account exists, so it says nothing extra.
    const inbox = redirectedInbox(email)
    const sentTo = inbox ? { sentTo: inbox } : {}

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, password: true } })
    const eligible = !!user && (!firstSignIn || !user.password)
    if (!eligible) {
      return NextResponse.json(firstSignIn ? { codeSent: false } : { codeSent: true, ...sentTo })
    }

    const code = newCode()
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${codeLockKey(email)}))`
      const now = Date.now()
      const codeRows = { email, token: { startsWith: CODE_PREFIX } }
      // Rows past the counting window are only clutter (and could collide
      // with a new code's token).
      await tx.passwordResetToken.deleteMany({ where: { ...codeRows, createdAt: { lt: new Date(now - DAY_MS) } } })

      const live = await tx.passwordResetToken.findFirst({
        where: { ...codeRows, expires: { gt: new Date(now) }, attempts: { lt: MAX_ATTEMPTS } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      if (live && !resend) return { kind: 'kept' as const }
      if (live && live.createdAt.getTime() > now - RESEND_COOLDOWN_MS) return { kind: 'cooldown' as const }

      const today = await tx.passwordResetToken.count({ where: { ...codeRows, createdAt: { gt: new Date(now - DAY_MS) } } })
      if (today >= MAX_CODES_PER_DAY) return { kind: 'cap' as const }

      const row = await tx.passwordResetToken.create({
        data: { email, token: codeToken(email, code), expires: new Date(now + CODE_TTL_MS) },
        select: { id: true },
      })
      return { kind: 'created' as const, id: row.id }
    })

    if (outcome.kind === 'kept' || outcome.kind === 'cooldown') {
      return NextResponse.json({ codeSent: true, alreadySent: true, ...sentTo })
    }
    if (outcome.kind === 'cap') {
      return NextResponse.json(
        { error: 'Too many codes were sent to this email today. Use "Email me a reset link instead" below, or try again tomorrow.' },
        { status: 429 },
      )
    }

    // Resend returns { error } instead of throwing on a rejected send.
    const result = await sendPasswordCodeEmail(email, code, !user!.password).catch((err) => ({ error: err }))
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      console.error('[password-code] email failed:', result.error)
      await prisma.passwordResetToken.deleteMany({ where: { id: outcome.id } })
      return NextResponse.json(
        { error: "We couldn't send the email just now. Please try again in a minute." },
        { status: 502 },
      )
    }

    // The new code is out: older ones stop working (their rows stay for the
    // daily counts).
    await prisma.passwordResetToken.updateMany({
      where: { email, token: { startsWith: CODE_PREFIX }, id: { not: outcome.id }, expires: { gt: new Date() } },
      data: { expires: new Date() },
    })

    return NextResponse.json({ codeSent: true, ...sentTo })
  } catch (error) {
    console.error('[password-code] send failed:', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
