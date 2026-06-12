import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

/**
 * Customer-facing invoice detail. Returns enough to render the pay page:
 * invoice metadata + every order bundled on the invoice + a property summary.
 *
 * Authz: invoice owner OR admin. Team admins can NOT view another team
 * admin's invoice — the field belongs to a single billable account.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, name: true, email: true, company: true } },
      orders: {
        include: { orderItems: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (invoice.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      status: invoice.status,
      range_start: invoice.rangeStart.toISOString(),
      range_end: invoice.rangeEnd.toISOString(),
      subtotal: Number(invoice.subtotal),
      total: Number(invoice.total),
      sent_at: invoice.sentAt?.toISOString() ?? null,
      paid_at: invoice.paidAt?.toISOString() ?? null,
      customer: {
        id: invoice.user.id,
        name: invoice.user.fullName || invoice.user.name || invoice.user.email,
        email: invoice.user.email,
        company: invoice.user.company,
      },
      orders: invoice.orders.map((o) => ({
        id: o.id,
        order_number: o.orderNumber,
        created_at: o.createdAt.toISOString(),
        property_address: o.propertyAddress,
        property_city: o.propertyCity,
        property_state: o.propertyState,
        property_zip: o.propertyZip,
        total: Number(o.total),
        placed_for_agent_name: o.placedForAgentName,
        items: o.orderItems.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          total_price: Number(it.totalPrice),
        })),
      })),
    },
  })
}
