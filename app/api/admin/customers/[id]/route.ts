import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isAdminOrTeamAdmin, canActOnBehalfOf } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

const ALLOWED_ROLES = ['customer', 'admin', 'team_admin'] as const
type AllowedRole = (typeof ALLOWED_ROLES)[number]

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

    if (!isAdminOrTeamAdmin(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Team admins can only view customers in their own team
    if (!(await canActOnBehalfOf(user, id))) {
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

    // Include the team roster for any team-member customer (admin OR agent)
    // so the per-agent inventory grouping works regardless of role.
    let team: { id: string; name: string; members: Array<{ id: string; name: string; email: string | null; hasLogin: boolean }> } | null = null
    if (customer.teamId) {
      const t = await prisma.team.findUnique({
        where: { id: customer.teamId },
        include: { teamMembers: { where: { removedAt: null }, orderBy: { createdAt: 'asc' } } },
      })
      if (t) {
        team = {
          id: t.id,
          name: t.name,
          members: t.teamMembers.map((m) => ({ id: m.id, name: m.name, email: m.email, hasLogin: !!m.userId })),
        }
      }
    }

    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
        company_name: customer.company,
        license_number: null,
        role: customer.role,
      },
      team,
      inventory: {
        signs,
        riders,
        lockboxes,
        brochureBoxes,
        // Per-row data for the per-agent grouped UI (additive — aggregated shapes above remain for other consumers)
        items: {
          signs: signsRaw.map(s => ({
            id: s.id,
            description: s.description,
            inStorage: s.inStorage,
            assignedToMemberId: s.assignedToMemberId,
          })),
          riders: ridersRaw.map(r => ({
            id: r.id,
            riderName: r.rider.name,
            inStorage: r.inStorage,
            assignedToMemberId: r.assignedToMemberId,
          })),
          lockboxes: lockboxesRaw.map(l => ({
            id: l.id,
            type: l.lockboxType.name,
            code: l.code,
            serialNumber: l.serialNumber,
            inStorage: l.inStorage,
            assignedToMemberId: l.assignedToMemberId,
          })),
          brochureBoxes: brochureBoxesRaw.map(b => ({
            id: b.id,
            description: b.description,
            inStorage: b.inStorage,
            assignedToMemberId: b.assignedToMemberId,
          })),
        },
        // Group duplicate descriptions onto one line with a quantity count
        otherItems: (() => {
          const grouped: Record<string, { id: string; description: string; quantity: number }> = {}
          for (const item of otherItemsRaw) {
            if (grouped[item.description]) {
              grouped[item.description].quantity += 1
            } else {
              grouped[item.description] = { id: item.id, description: item.description, quantity: 1 }
            }
          }
          return Object.values(grouped)
        })(),
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

    let roleChangeAudit: { from: string; to: AllowedRole } | null = null
    if (body.role !== undefined) {
      // Defense in depth: even though the route is already gated to admins
      // above, re-check at the sensitive operation so future refactors that
      // loosen the outer gate don't accidentally expose role changes.
      if (user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Only platform admins can change roles' },
          { status: 403 }
        )
      }
      if (!ALLOWED_ROLES.includes(body.role)) {
        return NextResponse.json(
          { error: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(', ')}` },
          { status: 400 }
        )
      }
      if (id === user.id) {
        return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
      }
      const current = await prisma.user.findUnique({ where: { id }, select: { role: true } })
      if (!current) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      if (current.role !== body.role) {
        // Prevent last-admin lockout: refuse to demote the only remaining admin.
        if (current.role === 'admin' && body.role !== 'admin') {
          const remainingAdmins = await prisma.user.count({
            where: { role: 'admin', id: { not: id } },
          })
          if (remainingAdmins === 0) {
            return NextResponse.json(
              { error: 'Cannot demote the last remaining admin. Promote another user to admin first.' },
              { status: 400 }
            )
          }
        }
        updateData.role = body.role
        roleChangeAudit = { from: current.role, to: body.role }
      }
    }

    const customer = await prisma.user.update({
      where: { id },
      data: updateData,
    })

    if (roleChangeAudit) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.UserRoleChange,
        targetType: 'user',
        targetId: customer.id,
        metadata: { email: customer.email, ...roleChangeAudit },
        request,
      })
    }

    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        full_name: customer.fullName,
        phone: customer.phone,
        company: customer.company,
        role: customer.role,
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
