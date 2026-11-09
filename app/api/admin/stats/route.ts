import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const startOfWeek = new Date(today)
    startOfWeek.setDate(today.getDate() - today.getDay())

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

    // Get all stats in parallel
    const [
      totalCustomers,
      ordersToday,
      ordersThisWeek,
      ordersThisMonth,
      pendingOrders,
      activeInstallations,
      revenueToday,
      revenueThisWeek,
      revenueThisMonth,
    ] = await Promise.all([
      prisma.user.count({
        where: { role: 'customer' },
      }),
      prisma.order.count({
        where: { createdAt: { gte: today } },
      }),
      prisma.order.count({
        where: { createdAt: { gte: startOfWeek } },
      }),
      prisma.order.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      prisma.order.count({
        where: { status: { in: ['pending', 'confirmed'] } },
      }),
      prisma.installation.count({
        where: { status: 'active' },
      }),
      prisma.order.findMany({
        where: {
          createdAt: { gte: today },
          paymentStatus: 'succeeded',
        },
        select: { total: true, refundedAmount: true, refundInitiatedAt: true },
      }),
      prisma.order.findMany({
        where: {
          createdAt: { gte: startOfWeek },
          paymentStatus: 'succeeded',
        },
        select: { total: true, refundedAmount: true, refundInitiatedAt: true },
      }),
      prisma.order.findMany({
        where: {
          createdAt: { gte: startOfMonth },
          paymentStatus: 'succeeded',
        },
        select: { total: true, refundedAmount: true, refundInitiatedAt: true },
      }),
    ])

    // Service requests query - handle gracefully if table doesn't exist yet
    let pendingServiceRequests = 0
    try {
      pendingServiceRequests = await prisma.serviceRequest.count({
        where: { status: { in: ['pending', 'acknowledged'] } },
      })
    } catch {
      // Table may not exist yet if migration hasn't run
      pendingServiceRequests = 0
    }

    // A partial refund issued from the app (admin Cancel/Refund box) leaves
    // paymentStatus='succeeded', so subtract it. Only those (refundInitiatedAt
    // set): refundedAmount is the Stripe charge's cumulative refund, and a
    // refund of an edit-down credit is already reflected in the lowered
    // order.total — subtracting it again would undercount.
    const calculateRevenue = (
      orders: { total: any; refundedAmount: any; refundInitiatedAt: Date | null }[]
    ) =>
      orders.reduce(
        (sum, order) =>
          sum +
          Number(order.total || 0) -
          (order.refundInitiatedAt ? Number(order.refundedAmount || 0) : 0),
        0
      )

    return NextResponse.json({
      totalCustomers,
      orders: {
        today: ordersToday,
        thisWeek: ordersThisWeek,
        thisMonth: ordersThisMonth,
        pending: pendingOrders,
      },
      activeInstallations,
      revenue: {
        today: calculateRevenue(revenueToday),
        thisWeek: calculateRevenue(revenueThisWeek),
        thisMonth: calculateRevenue(revenueThisMonth),
      },
      pendingServiceRequests,
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
