import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { processInvoiceSendJob } from '@/lib/invoices/send-invoice-job'

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
      // serviceRequests count needed so the admin list shows "N orders + M
      // service trips" alongside paid/sent dates instead of just orders.
      _count: { select: { orders: true, serviceRequests: true } },
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
      service_request_count: i._count.serviceRequests,
      created_at: i.createdAt.toISOString(),
      // Background-worker state for the email-status badge + Resend button.
      email_status: i.emailStatus,
      recipient_email: i.recipientEmail,
      email_error: i.emailError,
      sending_started_at: i.sendingStartedAt?.toISOString() ?? null,
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

  // Optional one-off recipient override (Round 21). When the admin types a
  // different address in the "Send to" field, this routes the bundled invoice
  // there for this send ONLY — without mutating User.billingEmail. Empty
  // string + null both fall back to the user's default. Validated minimally;
  // Resend rejects malformed addresses anyway.
  const recipientEmailOverrideRaw =
    typeof body.recipientEmailOverride === 'string' ? body.recipientEmailOverride.trim() : null
  const recipientEmailOverride = recipientEmailOverrideRaw || null
  if (recipientEmailOverride && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmailOverride)) {
    return NextResponse.json(
      { error: 'Recipient email is not a valid address.' },
      { status: 400 },
    )
  }

  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, email: true, fullName: true, name: true, company: true, billingEmail: true },
  })
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  // Recipient resolution — 3-tier fallback. Snapshotted onto the Invoice row
  // so the audit log + Resend retry know exactly where the email went, even
  // if User.billingEmail changes later.
  const resolvedRecipientEmail =
    recipientEmailOverride || customer.billingEmail || customer.email
  const recipientSource: 'override' | 'billing' | 'account' = recipientEmailOverride
    ? 'override'
    : customer.billingEmail
      ? 'billing'
      : 'account'

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
        // Email-send state — defaults to 'queued'; the background worker
        // flips it through 'sending' → 'sent' | 'failed' | 'skipped'.
        emailStatus: 'queued',
        // Snapshot: the exact address this invoice is targeted to. Trusted
        // by the worker over any later mutation of User.billingEmail so the
        // audit log stays honest.
        recipientEmail: resolvedRecipientEmail,
      },
      select: { id: true, invoiceNumber: true, total: true, subtotal: true, publicPdfToken: true, recipientEmail: true, emailStatus: true },
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

  // Audit log INTENT — which recipient the admin queued the invoice for.
  // The worker writes a SEPARATE outcome event (InvoiceEmailSent / Failed /
  // Skipped) at send time so the trail records both what was queued and
  // what the customer actually saw.
  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.InvoiceCreated,
    targetType: 'invoice',
    targetId: result.invoice.id,
    metadata: {
      customerId,
      customerEmail: customer.email,
      // Snapshotted recipient — what the admin TYPED (or the default).
      sentToEmail: resolvedRecipientEmail,
      recipientSource,
      recipientEmailOverride,
      usedBillingEmailOverride: recipientSource === 'billing',
      usedRecipientOverride: recipientSource === 'override',
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

  // Fire-and-forget the background worker. Railway runs a long-lived Node
  // process so the setImmediate'd promise continues to completion after
  // the HTTP response is sent (unlike serverless/edge runtimes which would
  // kill it). The whole reason we moved this out of the request handler:
  // doing Stripe Payment Link + PDF + Resend synchronously took 10-15s and
  // Safari (+ Railway's gateway) timed out the fetch, leaving Ryan with a
  // "Load failed" error even when the work succeeded server-side.
  setImmediate(() => {
    processInvoiceSendJob({
      invoiceId: result.invoice!.id,
      resolvedRecipientEmail,
      recipientSource,
      rangeStartIso: startDate.toISOString(),
      rangeEndIso: endDate.toISOString(),
    }).catch((err) => {
      console.error('Background invoice-send job crashed:', err)
      // Mark failed best-effort so the UI doesn't show "Queued" forever.
      prisma.invoice
        .update({
          where: { id: result.invoice!.id },
          data: {
            emailStatus: 'failed',
            emailError: String(err?.message ?? err).slice(0, 500),
            sendingStartedAt: null,
          },
        })
        .catch(() => {})
    })
  })

  return NextResponse.json({
    invoice: {
      id: result.invoice.id,
      invoice_number: result.invoice.invoiceNumber,
      total: Number(result.invoice.total),
      order_count: result.ordersCount,
      service_request_count: result.serviceRequestsCount,
      email_status: 'queued',
      recipient_email: resolvedRecipientEmail,
    },
  })
}
