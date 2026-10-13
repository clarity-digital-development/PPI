import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendPasswordResetEmail } from '@/lib/email'
import crypto from 'crypto'
import { CODE_PREFIX, LINK_PREFIX, redirectedInbox } from '@/lib/passwords/code'

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
    message: 'Too many reset requests. Please try again in 15 minutes.',
  })
  if (limited) return limited

  try {
    const body = await request.json()
    const { email } = body

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()
    // admin@ / test@ have no mailbox; their link goes to the shop inbox.
    // Named whether or not the account exists, so it says nothing extra.
    const inbox = redirectedInbox(normalizedEmail)
    const reply = {
      message: inbox
        ? `If an account exists with this email, a password reset link is on its way to ${inbox}.`
        : 'If an account exists with this email, you will receive a password reset link.',
      ...(inbox ? { sentTo: inbox } : {}),
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json(reply)
    }

    // Delete any earlier emailed reset links for this email. Emailed sign-in
    // codes stay (their rows are what the per-day code limit counts), and so
    // does a link an admin texted: this email may never arrive.
    await prisma.passwordResetToken.deleteMany({
      where: {
        email: normalizedEmail,
        NOT: [{ token: { startsWith: CODE_PREFIX } }, { token: { startsWith: LINK_PREFIX } }],
      },
    })

    // Generate a secure token
    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now

    // Store the token
    await prisma.passwordResetToken.create({
      data: {
        email: normalizedEmail,
        token,
        expires,
      },
    })

    // Send the email
    await sendPasswordResetEmail(normalizedEmail, token)

    return NextResponse.json(reply)
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}
