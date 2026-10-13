import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { createWelcomeNotification } from '@/lib/notifications'
import { checkRateLimit, rateLimitPresets } from '@/lib/rate-limit'
import { validatePassword } from '@/lib/passwords/rules'

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export async function POST(request: NextRequest) {
  // Apply rate limiting - 5 registration attempts per 15 minutes
  const rateLimitResponse = checkRateLimit(request, rateLimitPresets.auth)
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  try {
    const body = await request.json()
    const { email, password, fullName, phone, company } = body

    // Validate required fields
    if (!email || !password || !fullName) {
      return NextResponse.json(
        { error: 'Email, password, and full name are required' },
        { status: 400 }
      )
    }

    // The crew calls agents from the dispatch sheet, so a phone is required.
    if (typeof phone !== 'string' || phone.replace(/\D/g, '').length < 10) {
      return NextResponse.json(
        { error: 'Please enter a phone number with area code.' },
        { status: 400 }
      )
    }

    // Validate email format
    if (!validateEmail(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      )
    }

    // Validate password strength
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.errors.join('. ') },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    })

    if (existingUser) {
      // Accounts carried over to the new site (October 2026) have no password
      // yet: send them to choose one instead of a dead-end "already exists".
      if (!existingUser.password) {
        return NextResponse.json(
          {
            error: 'You already have an account from before we moved to the new site. Choose a new password to sign in.',
            code: 'needs_new_password',
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 400 }
      )
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create user (store email in lowercase for consistency)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        fullName,
        name: fullName,
        phone,
        company,
        role: 'customer',
      },
    })

    // Create welcome notification
    try {
      await createWelcomeNotification(user.id, fullName)
    } catch (notifError) {
      console.error('Error creating welcome notification:', notifError)
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
