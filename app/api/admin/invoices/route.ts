import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { sendInvoiceEmail } from '@/lib/email'

/**
 * Admin invoice bundler.
 *
 *   GET   ?customerId=…&startDate=…&endDate=…  preview matching orders + totals
 *   GET                                          list existing invoices
 *   POST  { customerId, startDate, endDate }    create + send an invoice
 *
 * Bundles every order in the given date range whose paymentStatus is
 * 'pending_invoice' onto a new Invoice row, then emails the customer a link
 * to /dashboard/invoices/[id] where they can pay the whole bundle.
 */

function parseInclusiveRange(startRaw: string | null, endRaw: string | null) {
  const startDate = startRaw && !isNaN(Date.parse(startRaw)) ? new Date(startRaw) : null
  const endDate = endRaw && !isNaN(Date.parse(endRaw)) ? new Date(endRaw) : null
  if (endDate) endDate.setHours(23, 59, 59, 999)
  return { startDate, endDate }
}

function generateInvoiceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `PPI-INV-${ts}-${rand}`
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get('customerId')
  const { startDate, endDate } = parseInclusiveRange(
    searchParams.get('startDate'),
    searchParams.get('endDate'),
  )
  const mode = searchParams.get('mode') // 'preview' | undefined (list)

  // Preview mode: return matching unpaid orders + totals so the admin can
  // verify before sending. Same filter the POST uses to create the invoice.
  if (mode === 'preview') {
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required for preview' }, { status: 400 })
    }
    const orders = await prisma.order.findMany({
      where: {
        userId: customerId,
        paymentStatus: 'pending_invoice',
        invoiceId: null,
        ...(startDate || endDate
          ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
          : {}),
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        total: true,
        subtotal: true,
        placedForAgentName: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    const subtotal = orders.reduce((s, o) => s + Number(o.subtotal || 0), 0)
    const total = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        order_number: o.orderNumber,
        created_at: o.createdAt.toISOString(),
        property: `${o.propertyAddress}, ${o.propertyCity}, ${o.propertyState} ${o.propertyZip}`,
        total: Number(o.total),
        placed_for_agent_name: o.placedForAgentName,
      })),
      subtotal,
      total,
      count: orders.length,
    })
  }

  // List mode: existing invoices, newest first.
  const status = searchParams.get('status')
  const invoices = await prisma.invoice.findMany({
    where: {
      ...(customerId ? { userId: customerId } : {}),
      ...(status ? { status: status as any } : {}),
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, company: true } },
      _count: { select: { orders: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({
    invoices: invoices.map((i) => ({
      id: i.id,
      invoice_number: i.invoiceNumber,
      customer_id: i.userId,
      customer_name: i.user.fullName || i.user.email,
      customer_company: i.user.company,
      customer_email: i.user.email,
      range_start: i.rangeStart.toISOString(),
      range_end: i.rangeEnd.toISOString(),
      subtotal: Number(i.subtotal),
      total: Number(i.total),
      status: i.status,
      sent_at: i.sentAt?.toISOString() ?? null,
      paid_at: i.paidAt?.toISOString() ?? null,
      order_count: i._count.orders,
      created_at: i.createdAt.toISOString(),
    })),
  })
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const customerId = typeof body.customerId === 'string' ? body.customerId : null
  if (!customerId) return NextResponse.json({ error: 'customerId is required' }, { status: 400 })

  const { startDate, endDate } = parseInclusiveRange(body.startDate ?? null, body.endDate ?? null)
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'startDate must be on or before endDate' }, { status: 400 })
  }

  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, email: true, fullName: true, name: true, company: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Find every unpaid invoice-billing order in range that isn't already on
  // an invoice. Locked in a transaction so two concurrent admin sends can't
  // double-bundle the same order.
  const result = await prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: {
        userId: customerId,
        paymentStatus: 'pending_invoice',
        invoiceId: null,
        createdAt: { gte: startDate, lte: endDate },
      },
      select: { id: true, subtotal: true, total: true, orderNumber: true },
      orderBy: { createdAt: 'asc' },
    })
    if (orders.length === 0) {
      return { invoice: null, ordersCount: 0, subtotal: 0, total: 0 }
    }

    const subtotal = orders.reduce((s, o) => s + Number(o.subtotal || 0), 0)
    const total = orders.reduce((s, o) => s + Number(o.total || 0), 0)

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        userId: customerId,
        rangeStart: startDate,
        rangeEnd: endDate,
        subtotal,
        total,
        status: 'sent',
        sentAt: new Date(),
      },
      select: { id: true, invoiceNumber: true, total: true, subtotal: true },
    })

    await tx.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { invoiceId: invoice.id },
    })

    return { invoice, ordersCount: orders.length, subtotal, total, orderNumbers: orders.map((o) => o.orderNumber) }
  })

  if (!result.invoice) {
    return NextResponse.json(
      { error: 'No pending-invoice orders found in this date range.' },
      { status: 400 },
    )
  }

  // Email the customer. Reservation flag stops a double-send if the admin
  // hits the button twice in quick succession.
  const reserved = await prisma.invoice.updateMany({
    where: { id: result.invoice.id, invoiceEmailSentAt: null },
    data: { invoiceEmailSentAt: new Date() },
  })
  if (reserved.count > 0) {
    try {
      await sendInvoiceEmail({
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        customerName: customer.fullName || customer.name || customer.email,
        customerEmail: customer.email,
        companyName: customer.company,
        rangeStart: startDate.toISOString().slice(0, 10),
        rangeEnd: endDate.toISOString().slice(0, 10),
        total: Number(result.invoice.total),
        orderCount: result.ordersCount,
        recipientUserId: customerId,
      })
    } catch (err) {
      console.error('Invoice email send failed:', err)
      await prisma.invoice
        .updateMany({
          where: { id: result.invoice.id, invoiceEmailSentAt: { not: null } },
          data: { invoiceEmailSentAt: null },
        })
        .catch(() => {})
    }
  }

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.InvoiceCreated,
    targetType: 'invoice',
    targetId: result.invoice.id,
    metadata: {
      customerId,
      customerEmail: customer.email,
      orderCount: result.ordersCount,
      orderNumbers: result.orderNumbers,
      total: result.total,
      rangeStart: startDate.toISOString(),
      rangeEnd: endDate.toISOString(),
    },
    request,
  })

  return NextResponse.json({
    invoice: {
      id: result.invoice.id,
      invoice_number: result.invoice.invoiceNumber,
      total: Number(result.invoice.total),
      order_count: result.ordersCount,
    },
  })
}
