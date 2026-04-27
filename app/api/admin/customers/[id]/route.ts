import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function GET(
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

    // Get customer profile
    const customer = await prisma.user.findUnique({
      where: { id },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Get all inventory and related data
    const [signsAll, ridersAll, lockboxesAll, brochureBoxesAll, otherItemsRaw, ordersRaw, installationsRaw] =
      await Promise.all([
        prisma.customerSign.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.customerRider.findMany({
          where: { userId: id },
          include: { rider: true },
        }),
        prisma.customerLockbox.findMany({
          where: { userId: id },
          include: { lockboxType: true },
        }),
        prisma.customerBrochureBox.findMany({
          where: { userId: id },
        }),
        prisma.customerOtherItem.findMany({
          where: { userId: id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.order.findMany({
          where: { userId: id },
          include: { orderItems: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.installation.findMany({
          where: { userId: id },
          include: {
            riders: { include: { rider: true } },
            lockboxes: { include: { lockboxType: true } },
          },
          orderBy: { installedAt: 'desc' },
        }),
      ])

    // Split items by inStorage status — only in-storage items appear in main inventory,
    // out-of-storage items appear in a separate "deployed" section so admin can return them
    const signsRaw = signsAll.filter(s => s.inStorage)
    const signsOutOfStorage = signsAll.filter(s => !s.inStorage)
    const ridersRaw = ridersAll.filter(r => r.inStorage)
    const ridersOutOfStorage = ridersAll.filter(r => !r.inStorage)
    const lockboxesRaw = lockboxesAll.filter(lb => lb.inStorage)
    const lockboxesOutOfStorage = lockboxesAll.filter(lb => !lb.inStorage)
    const brochureBoxesRaw = brochureBoxesAll.filter(b => b.inStorage)
    const brochureBoxesOutOfStorage = brochureBoxesAll.filter(b => !b.inStorage)

    // Transform data to match frontend expectations
    // Aggregate signs by description with quantity counts
    const signMap: Record<string, { id: string; description: string; size: null; quantity: number }> = {}
    for (const sign of signsRaw) {
      if (signMap[sign.description]) {
        signMap[sign.description].quantity += 1
      } else {
        signMap[sign.description] = { id: sign.id, description: sign.description, size: null, quantity: 1 }
      }
    }
    const signs = Object.values(signMap)

    // Aggregate riders by type with quantity counts
    const riderMap: Record<string, { id: string; rider_id: string; rider_type: string; quantity: number }> = {}
    for (const r of ridersRaw) {
      const key = r.riderId
      if (riderMap[key]) {
        riderMap[key].quantity += 1
      } else {
        riderMap[key] = {
          id: r.id,
          rider_id: r.riderId,
          rider_type: r.rider.name,
          quantity: 1,
        }
      }
    }
    const riders = Object.values(riderMap)

    // Return each lockbox individually (each has a different code)
    const lockboxes = lockboxesRaw.map((lb) => ({
      id: lb.id,
      lockbox_type_id: lb.lockboxTypeId,
      lockbox_type: lb.lockboxType.name,
      lockbox_code: lb.code,
    }))

    // Aggregate brochure boxes into a single count
    const brochureBoxes = brochureBoxesRaw.length > 0
      ? { id: brochureBoxesRaw[0].id, quantity: brochureBoxesRaw.length }
      : null

    // Build deployed list — flat per-item so admin can mark each one back to storage
    const deployed = {
      signs: signsOutOfStorage.map(s => ({ id: s.id, description: s.description })),
      riders: ridersOutOfStorage.map(r => ({ id: r.id, rider_type: r.rider.name })),
      lockboxes: lockboxesOutOfStorage.map(lb => ({ id: lb.id, lockbox_type: lb.lockboxType.name, lockbox_code: lb.code })),
      brochureBoxes: brochureBoxesOutOfStorage.map(b => ({ id: b.id, description: b.description })),
    }

    // Transform orders to match frontend expectations
    const orders = ordersRaw.map((order) => ({
      id: order.id,
      order_number: order.orderNumber,
      status: order.status,
      total: Number(order.total),
      created_at: order.createdAt.toISOString(),
    }))

    // Transform installations
    const installations = installationsRaw.map((inst) => ({
      id: inst.id,
      address: inst.propertyAddress,
      city: inst.propertyCity,
      post_type: 'Standard',
      status: inst.status,
      installation_date: inst.installedAt.toISOString(),
    }))

    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
        company_name: customer.company,
        license_number: null,
      },
      inventory: {
        signs,
        riders,
        lockboxes,
        brochureBoxes,
        otherItems: otherItemsRaw.map((item) => ({ id: item.id, description: item.description })),
        deployed,
      },
      orders,
      installations,
    })
  } catch (error) {
    console.error('Error fetching customer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
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
    const updateData: Record<string, unknown> = {}

    if (body.full_name !== undefined) updateData.fullName = body.full_name
    if (body.email !== undefined) updateData.email = body.email
    if (body.phone !== undefined) updateData.phone = body.phone
    if (body.company !== undefined) updateData.company = body.company

    const customer = await prisma.user.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
        company: customer.company,
      },
    })
  } catch (error) {
    console.error('Error updating customer:', error)
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

    // Prevent deleting yourself
    if (id === user.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
    }

    await prisma.user.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting customer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
