/**
 * Admin "Active Posts" list (Ryan, Slack 2026-09-19).
 *
 *   "I need a way to see our active posts. Too many agents are forgetting to
 *    ever schedule removal. If there's a way to see active posts out there and
 *    search by both street name as well as filter oldest/newest please."
 *
 * Cross-customer, so internal admins ONLY -- never isAdminOrTeamAdmin. A
 * team_admin must not see other brokerages' installs.
 *
 * "Active" here is exactly the app's canonical predicate, `status: 'active'`:
 * the overview tile (admin/stats), the post-rental cron and
 * lib/post-rental-billing all use it. Every writer that sets `active` also
 * nulls removalDate, and every writer that sets removalDate also flips status
 * to removal_scheduled, so adding `removalDate: null` would change no row and
 * would only let this page silently disagree with the tile. Verified against
 * production 2026-09-22: 327 active, 0 of them carrying a removal date.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

// Whitelisted. Never `status as any` from a user string -- the enum is
// active | removal_scheduled | removed, and 'out' is the ScheduleTripModal
// definition of "still in the ground".
const STATUS_FILTERS = {
  active: { status: 'active' as const },
  removal_scheduled: { status: 'removal_scheduled' as const },
  out: { status: { in: ['active', 'removal_scheduled'] as Array<'active' | 'removal_scheduled'> } },
}
type StatusFilterKey = keyof typeof STATUS_FILTERS

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusParam = (searchParams.get('status') ?? 'active') as StatusFilterKey
    const statusWhere = STATUS_FILTERS[statusParam] ?? STATUS_FILTERS.active
    const search = searchParams.get('search')?.trim() || ''
    // Oldest first by default: the whole point is surfacing the ones nobody
    // scheduled a pickup for, and those are the oldest.
    const sort = searchParams.get('sort') === 'newest' ? ('desc' as const) : ('asc' as const)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25') || 25))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0') || 0)

    const where = {
      ...statusWhere,
      ...(search
        ? {
            OR: [
              { propertyAddress: { contains: search, mode: 'insensitive' as const } },
              { propertyCity: { contains: search, mode: 'insensitive' as const } },
              { propertyZip: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const [installations, total] = await Promise.all([
      prisma.installation.findMany({
        where,
        orderBy: { installedAt: sort },
        take: limit,
        skip: offset,
        select: {
          id: true,
          propertyAddress: true,
          propertyCity: true,
          propertyState: true,
          propertyZip: true,
          installedAt: true,
          status: true,
          removalDate: true,
          userId: true,
          user: {
            select: {
              fullName: true,
              name: true,
              email: true,
              phone: true,
              company: true,
              team: { select: { name: true } },
            },
          },
          // Non-null in practice: Installation -> Order is ON DELETE RESTRICT.
          order: { select: { id: true, orderNumber: true, placedForAgentName: true } },
          // A removal request filed WITHOUT a date does not flip the install to
          // removal_scheduled, so an 'active' row can still have a pickup in
          // flight. Surface it rather than let Ryan chase an agent who already
          // asked.
          serviceRequests: {
            where: { type: 'removal', status: { notIn: ['completed', 'cancelled'] } },
            select: { id: true, status: true, requestedDate: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.installation.count({ where }),
    ])

    return NextResponse.json({ installations, total })
  } catch (error) {
    console.error('Error fetching installations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
