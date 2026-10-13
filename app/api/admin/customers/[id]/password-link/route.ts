import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { CODE_PREFIX, LINK_PREFIX } from '@/lib/passwords/code'

// Lasts longer than an emailed reset link (1 hour): it goes through a person,
// who texts it to the customer.
const LINK_TTL_MS = 3 * 24 * 60 * 60 * 1000

// POST /api/admin/customers/[id]/password-link — a one-time "choose your
// password" link for a customer whose inbox never gets our email (Redfin's
// deal-coordinators address bounces everything from outside Redfin). The
// admin copies it and texts it to the customer. It's the same kind of link
// /forgot-password emails, redeemed once by /reset-password. A new link
// replaces any earlier one. Not for admin accounts: one admin shouldn't be
// able to take over another's login.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const admin = await getCurrentUser()
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const customer = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    })
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    if (customer.role === 'admin') {
      return NextResponse.json(
        { error: 'Admin logins sign in with an emailed code, not a link.' },
        { status: 400 }
      )
    }

    const token = LINK_PREFIX + crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + LINK_TTL_MS)
    await prisma.$transaction([
      // Older links (texted or emailed) stop working; emailed sign-in codes
      // stay (their rows are what the per-day code limit counts).
      prisma.passwordResetToken.deleteMany({
        where: { email: customer.email, NOT: { token: { startsWith: CODE_PREFIX } } },
      }),
      prisma.passwordResetToken.create({ data: { email: customer.email, token, expires } }),
    ])

    await audit({
      actor: { id: admin.id, email: admin.email, role: admin.role },
      action: AuditAction.PasswordLinkCreate,
      targetType: 'user',
      targetId: customer.id,
      metadata: { email: customer.email, expires: expires.toISOString() },
      request,
    })

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://pinkposts.com'
    return NextResponse.json({
      url: `${baseUrl}/reset-password?token=${token}`,
      expiresAt: expires.toISOString(),
    })
  } catch (error) {
    console.error('[admin password-link] failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
