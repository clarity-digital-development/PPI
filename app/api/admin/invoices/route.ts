import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { sendInvoiceEmail } from '@/lib/email'
import { buildInvoicePdfBytes } from '@/lib/invoices/invoice-pdf'
import { loadInvoiceDetailForPdf } from '@/lib/invoices/load-detail'
import { createInvoiceCheckoutSession } from '@/lib/stripe/server'

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

// 64-char hex token; unguessable so the emailed PDF URL is effectively
// capability-protected without forcing the customer to log in.
function generatePublicPdfToken(): string {
  return randomBytes(32).toString('hex')
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

  // Preview mode: return matching unpaid orders + SRs + totals so the admin
  // can verify before sending. Same filter the POST uses to create the invoice.
  if (mode === 'preview') {
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required for preview' }, { status: 400 })
    }
    const [orders, serviceRequests] = await Promise.all([
      prisma.order.findMany({
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
      }),
      // SRs are anchored to completedAt (when the work was done) so admin
      // bills for the billing period the trip actually happened in. SRs
      // without completedAt aren't bundle-ready even if amount is set.
      prisma.serviceRequest.findMany({
        where: {
          userId: customerId,
          invoiceId: null,
          invoiceStatus: 'pending_invoice',
          invoiceAmount: { not: null },
          ...(startDate || endDate
            ? { completedAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
            : {}),
        },
        include: { installation: { select: { propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true } } },
        orderBy: { completedAt: 'asc' },
      }),
    ])

    const ordersSubtotal = orders.reduce((s, o) => s + Number(o.subtotal || 0), 0)
    const ordersTotal = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const srTotal = serviceRequests.reduce((s, sr) => s + Number(sr.invoiceAmount || 0), 0)
    const subtotal = ordersSubtotal + srTotal
    const total = ordersTotal + srTotal
    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        order_number: o.orderNumber,
        created_at: o.createdAt.toISOString(),
        property: `${o.propertyAddress}, ${o.propertyCity}, ${o.propertyState} ${o.propertyZip}`,
        total: Number(o.total),
        placed_for_agent_name: o.placedForAgentName,
      })),
      service_requests: serviceRequests.map((sr) => ({
        id: sr.id,
        type: sr.type,
        description: sr.description,
        completed_at: sr.completedAt?.toISOString() ?? null,
        property: sr.installation
          ? `${sr.installation.propertyAddress}, ${sr.installation.propertyCity}, ${sr.installation.propertyState} ${sr.installation.propertyZip}`
          : sr.unlistedAddress
            ? `${sr.unlistedAddress}, ${sr.unlistedCity ?? ''} ${sr.unlistedState ?? ''} ${sr.unlistedZip ?? ''}`.trim()
            : '—',
        amount: Number(sr.invoiceAmount || 0),
      })),
      subtotal,
      total,
      count: orders.length + serviceRequests.length,
      order_count: orders.length,
      service_request_count: serviceRequests.length,
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
    select: { id: true, email: true, fullName: true, name: true, company: true, billingEmail: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Where the bundled-invoice email actually lands. Billing-contact email
  // (admin-set on /admin/customers/[id]) wins so accountants get the bill
  // directly; account email is the fallback.
  const recipientEmail = customer.billingEmail || customer.email

  // Find every unpaid invoice-billing order AND every completed pending-invoice
  // service-request in range that isn't already on another invoice. The
  // updateMany filters on `invoiceId: null` AND we verify the affected count
  // equals what we read so two concurrent admin sends can't double-bundle the
  // same rows (race fix — without the count check, READ COMMITTED isolation
  // allows two transactions to both bundle the same orders).
  const result = await prisma.$transaction(async (tx) => {
    const [orders, serviceRequests] = await Promise.all([
      tx.order.findMany({
        where: {
          userId: customerId,
          paymentStatus: 'pending_invoice',
          invoiceId: null,
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { id: true, subtotal: true, total: true, orderNumber: true },
        orderBy: { createdAt: 'asc' },
      }),
      tx.serviceRequest.findMany({
        where: {
          userId: customerId,
          invoiceId: null,
          invoiceStatus: 'pending_invoice',
          invoiceAmount: { not: null },
          completedAt: { gte: startDate, lte: endDate },
        },
        select: { id: true, invoiceAmount: true, type: true },
        orderBy: { completedAt: 'asc' },
      }),
    ])

    if (orders.length === 0 && serviceRequests.length === 0) {
      return { invoice: null, ordersCount: 0, serviceRequestsCount: 0, subtotal: 0, total: 0 }
    }

    const ordersSubtotal = orders.reduce((s, o) => s + Number(o.subtotal || 0), 0)
    const ordersTotal = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const srTotal = serviceRequests.reduce((s, sr) => s + Number(sr.invoiceAmount || 0), 0)
    const subtotal = ordersSubtotal + srTotal
    const total = ordersTotal + srTotal

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
        // Capability token for the public PDF viewer. Generated at bundler
        // time so the email link can include it directly.
        publicPdfToken: generatePublicPdfToken(),
      },
      select: { id: true, invoiceNumber: true, total: true, subtotal: true, publicPdfToken: true },
    })

    // Race guard: filter the UPDATE on `invoiceId: null` too, then verify
    // the affected count matches what we read. If a parallel admin send
    // grabbed any of these rows between the SELECT and the UPDATE, the
    // count won't match — we throw to roll back the whole transaction and
    // the second admin gets a 500 they can retry from a clean state.
    if (orders.length > 0) {
      const ordersUpdate = await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) }, invoiceId: null },
        data: { invoiceId: invoice.id },
      })
      if (ordersUpdate.count !== orders.length) {
        throw new Error(`Concurrent bundle race: expected to attach ${orders.length} orders, attached ${ordersUpdate.count}`)
      }
    }
    if (serviceRequests.length > 0) {
      const srUpdate = await tx.serviceRequest.updateMany({
        where: { id: { in: serviceRequests.map((sr) => sr.id) }, invoiceId: null },
        data: { invoiceId: invoice.id },
      })
      if (srUpdate.count !== serviceRequests.length) {
        throw new Error(`Concurrent bundle race: expected to attach ${serviceRequests.length} SRs, attached ${srUpdate.count}`)
      }
    }

    return {
      invoice,
      ordersCount: orders.length,
      serviceRequestsCount: serviceRequests.length,
      subtotal,
      total,
      orderNumbers: orders.map((o) => o.orderNumber),
      serviceRequestIds: serviceRequests.map((sr) => sr.id),
      publicPdfToken: invoice.publicPdfToken!,
    }
  })

  if (!result.invoice) {
    return NextResponse.json(
      { error: 'No pending-invoice orders or service trips found in this date range.' },
      { status: 400 },
    )
  }

  // Create the Stripe Checkout Session AFTER the transaction commits so the
  // invoice + bundled rows are definitely persisted before we point Stripe
  // at this invoice id. If session creation fails, we still let the email
  // send (without a Pay button) — admin can regenerate later.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://pinkposts.com'
  let checkoutUrl: string | null = null
  try {
    const session = await createInvoiceCheckoutSession({
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      amountInCents: Math.round(Number(result.invoice.total) * 100),
      customerEmail: customer.email,
      description: `${result.ordersCount} order(s) + ${result.serviceRequestsCount} service trip(s) — ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`,
      successUrl: `${baseUrl}/invoice-paid?invoice=${result.invoice.invoiceNumber}`,
      cancelUrl: `${baseUrl}/invoice-cancelled?invoice=${result.invoice.invoiceNumber}`,
    })
    checkoutUrl = session.url
    await prisma.invoice.update({
      where: { id: result.invoice.id },
      data: { checkoutSessionId: session.id, checkoutUrl: session.url },
    })
  } catch (stripeErr) {
    console.error('Invoice checkout-session create failed (email will still send without Pay button):', stripeErr)
  }

  // Email the customer. Reservation flag stops a double-send if the admin
  // hits the button twice in quick succession.
  const reserved = await prisma.invoice.updateMany({
    where: { id: result.invoice.id, invoiceEmailSentAt: null },
    data: { invoiceEmailSentAt: new Date() },
  })
  if (reserved.count > 0) {
    try {
      // Fetch the freshly-bundled invoice with everything the PDF needs, so
      // the customer gets the document attached and doesn't have to log in
      // to download it. PDF gen errors are non-fatal — fall back to sending
      // the email without an attachment so the customer still gets the link.
      let pdfBytes: Uint8Array | null = null
      try {
        const full = await loadInvoiceDetailForPdf(result.invoice.id)
        if (full) pdfBytes = buildInvoicePdfBytes(full)
      } catch (pdfErr) {
        console.error('Invoice PDF generation failed; sending email without attachment:', pdfErr)
      }
      await sendInvoiceEmail({
        invoiceId: result.invoice.id,
        invoiceNumber: result.invoice.invoiceNumber,
        customerName: customer.fullName || customer.name || customer.email,
        customerEmail: recipientEmail,
        companyName: customer.company,
        rangeStart: startDate.toISOString().slice(0, 10),
        rangeEnd: endDate.toISOString().slice(0, 10),
        total: Number(result.invoice.total),
        orderCount: result.ordersCount,
        serviceRequestCount: result.serviceRequestsCount,
        pdfBytes,
        pdfUrl: `${baseUrl}/api/invoices/${result.invoice.id}/pdf?token=${result.publicPdfToken}`,
        payUrl: checkoutUrl,
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
      // Where the email actually went — billing contact if set, else account.
      // Useful for debugging "the accountant says they never got the invoice."
      sentToEmail: recipientEmail,
      usedBillingEmailOverride: !!customer.billingEmail,
      orderCount: result.ordersCount,
      orderNumbers: result.orderNumbers,
      serviceRequestCount: result.serviceRequestsCount,
      serviceRequestIds: result.serviceRequestIds,
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
      service_request_count: result.serviceRequestsCount,
    },
  })
}
