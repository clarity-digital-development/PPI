import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

// WHY: PATCH is partial — every field optional but with the same validation rules as create.
const centerPatchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  addressLine: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1).max(100).optional(),
  state: z.string().trim().length(2).transform((v) => v.toUpperCase()).optional(),
  zip: z.string().trim().regex(/^\d{5}$/, 'ZIP must be 5 digits').optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  standardMinutes: z.number().int().positive().max(600).optional(),
  surchargeMinutes: z.number().int().positive().max(600).optional(),
  surchargeCents: z.number().int().min(0).max(1_000_000).optional(),
  contactPhone: z.string().trim().min(7).max(20).optional(),
  isActive: z.boolean().optional(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const center = await prisma.serviceCenter.findUnique({ where: { id } })
    if (!center) {
      return NextResponse.json({ error: 'Service center not found' }, { status: 404 })
    }
    return NextResponse.json({ center })
  } catch (error) {
    console.error('[admin/service-centers/[id] GET] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = centerPatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.errors },
        { status: 400 }
      )
    }
    const data = parsed.data

    const before = await prisma.serviceCenter.findUnique({ where: { id } })
    if (!before) {
      return NextResponse.json({ error: 'Service center not found' }, { status: 404 })
    }

    // Use submitted bands when present, otherwise fall back to current — so a partial PATCH still gets validated.
    const effectiveStandard = data.standardMinutes ?? before.standardMinutes
    const effectiveSurcharge = data.surchargeMinutes ?? before.surchargeMinutes
    if (effectiveSurcharge <= effectiveStandard) {
      return NextResponse.json(
        { error: 'surchargeMinutes must be greater than standardMinutes' },
        { status: 400 }
      )
    }

    // WHY: name uniqueness — surface friendly 409 if renaming to a taken name.
    if (data.name && data.name !== before.name) {
      const clash = await prisma.serviceCenter.findUnique({ where: { name: data.name } })
      if (clash) {
        return NextResponse.json(
          { error: `A service center named "${data.name}" already exists` },
          { status: 409 }
        )
      }
    }

    const after = await prisma.serviceCenter.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.addressLine !== undefined ? { addressLine: data.addressLine } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.state !== undefined ? { state: data.state } : {}),
        ...(data.zip !== undefined ? { zip: data.zip } : {}),
        ...(data.lat !== undefined ? { lat: data.lat } : {}),
        ...(data.lng !== undefined ? { lng: data.lng } : {}),
        ...(data.standardMinutes !== undefined ? { standardMinutes: data.standardMinutes } : {}),
        ...(data.surchargeMinutes !== undefined ? { surchargeMinutes: data.surchargeMinutes } : {}),
        ...(data.surchargeCents !== undefined ? { surchargeCents: data.surchargeCents } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    })

    // Build a minimal {before,after} diff of changed fields only, for cleaner audit metadata.
    const diff: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of Object.keys(data) as Array<keyof typeof data>) {
      const b = (before as unknown as Record<string, unknown>)[key as string]
      const a = (after as unknown as Record<string, unknown>)[key as string]
      // Decimal columns come back as Prisma Decimal — stringify for stable comparison/serialization.
      const bv = b && typeof b === 'object' && 'toString' in b ? String(b) : b
      const av = a && typeof a === 'object' && 'toString' in a ? String(a) : a
      if (bv !== av) diff[key as string] = { from: bv, to: av }
    }

    if (Object.keys(diff).length > 0) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.ServiceCenterUpdate,
        targetType: 'service_center',
        targetId: after.id,
        metadata: { name: after.name, diff },
        request,
      })
    }

    return NextResponse.json({ center: after })
  } catch (error) {
    console.error('[admin/service-centers/[id] PATCH] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const before = await prisma.serviceCenter.findUnique({ where: { id } })
    if (!before) {
      return NextResponse.json({ error: 'Service center not found' }, { status: 404 })
    }
    if (!before.isActive) {
      // Already soft-deleted; idempotent success so the UI can be optimistic.
      return NextResponse.json({ success: true, alreadyInactive: true })
    }

    // WHY: soft-delete via isActive=false so historical Order.serviceAreaCenterId FKs keep working.
    const after = await prisma.serviceCenter.update({
      where: { id },
      data: { isActive: false },
    })

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.ServiceCenterDelete,
      targetType: 'service_center',
      targetId: after.id,
      metadata: { name: after.name, city: after.city, state: after.state },
      request,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin/service-centers/[id] DELETE] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
