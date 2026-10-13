import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { CODE_PREFIX } from '@/lib/passwords/code'
import { validatePassword } from '@/lib/passwords/rules'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, password } = body

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      )
    }

    // Emailed sign-in codes share this table but are only redeemable through
    // /api/auth/password-code/verify, which limits guesses; this route doesn't.
    if (typeof token !== 'string' || token.startsWith(CODE_PREFIX)) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link' },
        { status: 400 }
      )
    }

    // Same rules as sign-up and the sign-in page's new-password step.
    const rules = validatePassword(String(password))
    if (!rules.valid) {
      return NextResponse.json({ error: rules.errors.join('. ') }, { status: 400 })
    }

    // Find the token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
    })

    if (!resetToken) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link' },
        { status: 400 }
      )
    }

    // Check if token has expired
    if (resetToken.expires < new Date()) {
      // Delete the expired token
      await prisma.passwordResetToken.delete({
        where: { id: resetToken.id },
      })
      return NextResponse.json(
        { error: 'Reset link has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Update the user's password. The link is keyed by address, so if no
    // account has that address any more it's dead, not a 500.
    const updated = await prisma.user.updateMany({
      where: { email: resetToken.email },
      data: { password: hashedPassword },
    })
    if (updated.count !== 1) {
      await prisma.passwordResetToken.delete({ where: { id: resetToken.id } })
      return NextResponse.json(
        { error: 'Invalid or expired reset link' },
        { status: 400 }
      )
    }

    // One-time: this link and any other live link (texted or emailed) stop
    // working. Sign-in code rows stay for the per-day code limits.
    await prisma.passwordResetToken.deleteMany({
      where: { email: resetToken.email, NOT: { token: { startsWith: CODE_PREFIX } } },
    })

    return NextResponse.json({
      message: 'Password has been reset successfully',
    })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json(
      { error: 'Failed to reset password' },
      { status: 500 }
    )
  }
}
