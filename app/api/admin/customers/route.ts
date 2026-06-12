import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, isAdminOrTeamAdmin } from '@/lib/auth-utils'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isAdminOrTeamAdmin(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const roleParam = searchParams.get('role')
    const invoiceBillingOnly = searchParams.get('invoiceBillingOnly') === '1'
    const limit = parseInt(searchParams.get('limit') || '500')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Team admins see only the customers in their team. Pink Posts internal
    // admins see all customers AND team_admin accounts (so they can manage
    // teams + tag them).
    // Internal admins can additionally narrow via ?role=customer|team_admin.
    const isInternalAdmin = user.role !== 'team_admin'
    const narrowRole =
      isInternalAdmin && (roleParam === 'customer' || roleParam === 'team_admin')
        ? (roleParam as 'customer' | 'team_admin')
        : null
    const roleScope =
      user.role === 'team_admin'
        ? { role: 'customer' as const, teamId: user.teamId ?? '__no-team__' }
        : narrowRole
          ? { role: narrowRole }
          : { role: { in: ['customer', 'team_admin'] as ('customer' | 'team_admin')[] } }

    const where = {
      ...roleScope,
      ...(invoiceBillingOnly ? { invoiceBilling: true } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { company: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const [customers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          _count: {
            select: {
              customerSigns: true,
              customerRiders: true,
              customerLockboxes: true,
              orders: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ])

    const customersWithCounts = customers.map((customer) => ({
      id: customer.id,
      email: customer.email,
      full_name: customer.fullName,
      phone: customer.phone,
      company: customer.company,
      role: customer.role,
      created_at: customer.createdAt,
      sign_count: customer._count.customerSigns,
      rider_count: customer._count.customerRiders,
      lockbox_count: customer._count.customerLockboxes,
      order_count: customer._count.orders,
    }))

    return NextResponse.json({ customers: customersWithCounts, total })
  } catch (error) {
    console.error('Error fetching customers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
