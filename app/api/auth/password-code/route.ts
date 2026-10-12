import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendPasswordCodeEmail } from '@/lib/email'
import { CODE_PREFIX, CODE_TTL_MS, RESEND_COOLDOWN_MS, codeToken, newCode, normalizeEmail } from '@/lib/passwords/code'

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

    // One email a minute per address: a repeat inside the window reuses the
    // code already sent.
    const recent = await prisma.passwordResetToken.findFirst({
      where: {
        email,
        token: { startsWith: CODE_PREFIX },
        createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) },
      },
      select: { id: true },
    })
    if (recent) return NextResponse.json({ codeSent: true, alreadySent: true })

    const code = newCode()
    const row = await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { email, token: { startsWith: CODE_PREFIX } } })
      return tx.passwordResetToken.create({
        data: { email, token: codeToken(email, code), expires: new Date(Date.now() + CODE_TTL_MS) },
        select: { id: true },
      })
    })

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
