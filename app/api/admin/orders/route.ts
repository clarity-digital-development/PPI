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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const customerId = searchParams.get('customer_id')
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const where = {
      ...(status ? { status: status as any } : {}),
      ...(customerId ? { userId: customerId } : {}),
      ...(startDate ? { createdAt: { gte: new Date(startDate) } } : {}),
      ...(endDate ? { createdAt: { lte: new Date(endDate) } } : {}),
    }

    // Total matching count so the admin UI can paginate through every order
    // (the list used to silently truncate at the first `limit` rows).
    const total = await prisma.order.count({ where })

    const orders = await prisma.order.findMany({
      where,
      include: {
        orderItems: true,
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })

    // Transform to match expected format (snake_case for frontend)
    const transformedOrders = orders.map((order) => ({
      id: order.id,
      order_number: order.orderNumber,
      status: order.status,
      payment_status: order.paymentStatus,
      property_address: order.propertyAddress,
      property_city: order.propertyCity,
      property_state: order.propertyState,
      property_zip: order.propertyZip,
      total: Number(order.total),
      created_at: order.createdAt.toISOString(),
      scheduled_date: order.scheduledDate?.toISOString() || null,
      is_expedited: order.isExpedited,
      profiles: {
        full_name: order.user.fullName,
        email: order.user.email,
        phone: order.user.phone,
      },
      order_items: order.orderItems.map((item) => ({
        id: item.id,
        item_type: item.itemType,
        description: item.description,
        quantity: item.quantity,
        total_price: Number(item.totalPrice),
      })),
    }))

    return NextResponse.json({ orders: transformedOrders, total })
  } catch (error) {
    console.error('Error fetching orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
