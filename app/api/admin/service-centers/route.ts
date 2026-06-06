import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

// WHY: shared shape — POST + (PATCH partial) reuse these field rules.
const centerCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  addressLine: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2).transform((v) => v.toUpperCase()),
  zip: z.string().trim().regex(/^\d{5}$/, 'ZIP must be 5 digits'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  standardMinutes: z.number().int().positive().max(600),
  surchargeMinutes: z.number().int().positive().max(600),
  surchargeCents: z.number().int().min(0).max(1_000_000).optional(),
  contactPhone: z.string().trim().min(7).max(20).optional(),
  isActive: z.boolean().optional(),
})

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const centers = await prisma.serviceCenter.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    })

    return NextResponse.json({ centers })
  } catch (error) {
    console.error('[admin/service-centers GET] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = centerCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.errors },
        { status: 400 }
      )
    }
    const data = parsed.data

    if (data.surchargeMinutes <= data.standardMinutes) {
      return NextResponse.json(
        { error: 'surchargeMinutes must be greater than standardMinutes' },
        { status: 400 }
      )
    }

    // WHY: name is @unique — surface a friendly 409 instead of a P2002 stack.
    const existing = await prisma.serviceCenter.findUnique({ where: { name: data.name } })
    if (existing) {
      return NextResponse.json(
        { error: `A service center named "${data.name}" already exists` },
        { status: 409 }
      )
    }

    const center = await prisma.serviceCenter.create({
      data: {
        name: data.name,
        addressLine: data.addressLine ?? null,
        city: data.city,
        state: data.state,
        zip: data.zip,
        lat: data.lat,
        lng: data.lng,
        standardMinutes: data.standardMinutes,
        surchargeMinutes: data.surchargeMinutes,
        ...(data.surchargeCents !== undefined ? { surchargeCents: data.surchargeCents } : {}),
        ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    })

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.ServiceCenterCreate,
      targetType: 'service_center',
      targetId: center.id,
      metadata: {
        name: center.name,
        city: center.city,
        state: center.state,
        standardMinutes: center.standardMinutes,
        surchargeMinutes: center.surchargeMinutes,
        surchargeCents: center.surchargeCents,
        contactPhone: center.contactPhone,
      },
      request,
    })

    return NextResponse.json({ center }, { status: 201 })
  } catch (error) {
    console.error('[admin/service-centers POST] error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
