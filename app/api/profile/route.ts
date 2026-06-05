import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { z } from 'zod'

const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
})

// Notification preferences — partial update; at least one field required
const PrefsSchema = z
  .object({
    emailOrderConfirmations: z.boolean().optional(),
    emailServiceRequests: z.boolean().optional(),
    emailMarketing: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields provided' })

export async function GET() {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        company: true,
        role: true,
        teamId: true,
        // Notification preference flags (default-true for transactional, default-false for marketing)
        emailOrderConfirmations: true,
        emailServiceRequests: true,
        emailMarketing: true,
        notificationPrefsUpdatedAt: true,
      },
    })

    // `user` mirrors `profile` for callers that want either shape
    return NextResponse.json({ profile, user: profile })
  } catch (error) {
    console.error('Error fetching profile:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validationResult = updateProfileSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const { fullName, phone, company } = validationResult.data

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(phone !== undefined && { phone }),
        ...(company !== undefined && { company }),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        company: true,
      },
    })

    return NextResponse.json({ profile: updatedUser })
  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — notification preferences only; separate from PUT so a regression in one path can't break the other
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let raw: unknown
    try {
      raw = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = PrefsSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.errors },
        { status: 400 }
      )
    }
    const body = parsed.data

    // Load current values so we can diff for the audit row
    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        emailOrderConfirmations: true,
        emailServiceRequests: true,
        emailMarketing: true,
      },
    })

    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const changes: Record<string, { from: boolean; to: boolean }> = {}
    for (const k of Object.keys(body) as (keyof typeof body)[]) {
      const next = body[k]
      if (next !== undefined && next !== current[k]) {
        changes[k] = { from: current[k], to: next }
      }
    }

    // No-op short-circuit — don't write a preference-change audit row for a non-change
    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ ok: true, noop: true, prefs: current })
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...body,
        notificationPrefsUpdatedAt: new Date(),
      },
      select: {
        emailOrderConfirmations: true,
        emailServiceRequests: true,
        emailMarketing: true,
        notificationPrefsUpdatedAt: true,
      },
    })

    // Fire-and-forget audit — must NEVER block the user-facing response
    await prisma.userPreferenceChange
      .create({
        data: {
          userId: user.id,
          changedBy: user.id,
          changes,
          ipAddress:
            request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
          userAgent: request.headers.get('user-agent') ?? null,
        },
      })
      .catch((err: unknown) => console.error('[prefs] audit failed', err))

    return NextResponse.json({ ok: true, prefs: updated })
  } catch (error) {
    console.error('Error updating notification preferences:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
