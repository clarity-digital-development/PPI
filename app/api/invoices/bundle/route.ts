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
 * Broker self-serve bundler.
 *
 *   POST { startDate, endDate, minPrice?, maxPrice?, agent?, accountantEmail?,
 *          rememberEmail?, sendEmail }
 *
 * The signed-in user must have invoiceBilling=true. They can only bundle
 * orders THEY own (or, for team_admin, orders placed on their behalf
 * via placedByUserId) plus their own service requests — never another
 * customer's. Same race-safe transaction + Stripe Payment Link + email path
 * as /api/admin/invoices so the resulting invoice is indistinguishable from
 * an admin-generated one.
 *
 * Two action modes:
 *   sendEmail=false → create Invoice + Stripe link, return the public PDF
 *                     URL so the browser can download/preview. No email.
 *   sendEmail=true  → all of the above PLUS send the invoice email to
 *                     accountantEmail (or billingEmail / account email
 *                     fallback). If rememberEmail is set, the accountant
 *                     email is persisted to User.billingEmail for next time.
 */

function generateInvoiceNumber(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `PPI-INV-${ts}-${rand}`
}

function generatePublicPdfToken(): string {
  return randomBytes(32).toString('hex')
}

function parseInclusiveRange(startRaw: unknown, endRaw: unknown) {
  const start = typeof startRaw === 'string' && !isNaN(Date.parse(startRaw)) ? new Date(startRaw) : null
  const end = typeof endRaw === 'string' && !isNaN(Date.parse(endRaw)) ? new Date(endRaw) : null
  if (end) end.setHours(23, 59, 59, 999)
  return { startDate: start, endDate: end }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true, email: true, fullName: true, name: true, company: true,
      invoiceBilling: true, billingEmail: true, role: true,
    },
  })
  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!profile.invoiceBilling) {
    return NextResponse.json(
      { error: 'Invoice billing isn\'t set up on your account. Contact Pink Posts to enable.' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { startDate, endDate } = parseInclusiveRange(body.startDate, body.endDate)
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'startDate must be on or before endDate' }, { status: 400 })
  }

  const minPrice = typeof body.minPrice === 'number' && Number.isFinite(body.minPrice) ? body.minPrice : null
  const maxPrice = typeof body.maxPrice === 'number' && Number.isFinite(body.maxPrice) ? body.maxPrice : null
  const agent = typeof body.agent === 'string' && body.agent.trim() ? body.agent.trim() : null
  const accountantEmailRaw = typeof body.accountantEmail === 'string' ? body.accountantEmail.trim() : ''
  const accountantEmail = accountantEmailRaw || null
  const rememberEmail = !!body.rememberEmail
  const sendEmail = !!body.sendEmail

  if (accountantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountantEmail)) {
    return NextResponse.json({ error: 'Accountant email is not a valid address.' }, { status: 400 })
  }
  if (sendEmail && !accountantEmail && !profile.billingEmail && !profile.email) {
    return NextResponse.json({ error: 'No recipient email available to send to.' }, { status: 400 })
  }

  // team_admin owns both orders they placed themselves AND orders they
  // placed on behalf of an agent (the agent is `userId`, the team_admin is
  // `placedByUserId`). Customers only see their own.
  const orderOwnership = profile.role === 'team_admin'
    ? { OR: [{ userId: user.id }, { placedByUserId: user.id }] }
    : { userId: user.id }

  // SRs have no placedByUserId column — broker only bundles SRs they own
  // directly. Their team members' SRs aren't bundled here (would need an
  // agent-level filter that doesn't exist on SR today).
  const result = await prisma.$transaction(async (tx) => {
    const orderWhere: Record<string, unknown> = {
      ...orderOwnership,
      paymentStatus: 'pending_invoice' as const,
      invoiceId: null,
      createdAt: { gte: startDate, lte: endDate },
    }
    if (agent) orderWhere.placedForAgentName = agent
    if (minPrice !== null || maxPrice !== null) {
      orderWhere.total = {
        ...(minPrice !== null ? { gte: minPrice } : {}),
        ...(maxPrice !== null ? { lte: maxPrice } : {}),
      }
    }

    const orders = await tx.order.findMany({
      where: orderWhere as any,
      select: { id: true, subtotal: true, total: true, orderNumber: true },
      orderBy: { createdAt: 'asc' },
    })

    const srWhere: Record<string, unknown> = {
      userId: user.id,
      invoiceId: null,
      invoiceStatus: 'pending_invoice' as const,
      completedAt: { gte: startDate, lte: endDate },
    }
    // Min/max apply to invoiceAmount for SRs; if either is set, also enforce
    // that invoiceAmount is non-null (otherwise the filter is a no-op).
    if (minPrice !== null || maxPrice !== null) {
      srWhere.invoiceAmount = {
        not: null,
        ...(minPrice !== null ? { gte: minPrice } : {}),
        ...(maxPrice !== null ? { lte: maxPrice } : {}),
      }
    } else {
      srWhere.invoiceAmount = { not: null }
    }

    const serviceRequests = await tx.serviceRequest.findMany({
      where: srWhere as any,
      select: { id: true, invoiceAmount: true },
      orderBy: { completedAt: 'asc' },
    })

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
        userId: user.id,
        rangeStart: startDate,
        rangeEnd: endDate,
        subtotal,
        total,
        status: 'sent',
        sentAt: new Date(),
        publicPdfToken: generatePublicPdfToken(),
      },
      select: { id: true, invoiceNumber: true, total: true, publicPdfToken: true },
    })

    // Race guard: filter UPDATE on invoiceId:null + verify count to prevent
    // two simultaneous broker clicks from double-bundling.
    if (orders.length > 0) {
      const r = await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) }, invoiceId: null },
        data: { invoiceId: invoice.id },
      })
      if (r.count !== orders.length) {
        throw new Error(`Concurrent bundle race: expected ${orders.length} orders, attached ${r.count}`)
      }
    }
    if (serviceRequests.length > 0) {
      const r = await tx.serviceRequest.updateMany({
        where: { id: { in: serviceRequests.map((sr) => sr.id) }, invoiceId: null },
        data: { invoiceId: invoice.id },
      })
      if (r.count !== serviceRequests.length) {
        throw new Error(`Concurrent bundle race: expected ${serviceRequests.length} SRs, attached ${r.count}`)
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
      { error: 'No pending-invoice orders or service trips matched your filters.' },
      { status: 400 },
    )
  }

  // Persist the accountant email as the broker's default billing email if
  // they checked the Remember box. Done outside the transaction since it's
  // unrelated to bundle integrity.
  if (rememberEmail && accountantEmail) {
    await prisma.user.update({
      where: { id: user.id },
      data: { billingEmail: accountantEmail },
    })
  }

  // Stripe Payment Link — same helper the admin bundler uses so the resulting
  // payment URL is structurally identical.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://pinkposts.com'
  const recipientEmail = accountantEmail || profile.billingEmail || profile.email
  let checkoutUrl: string | null = null
  try {
    const session = await createInvoiceCheckoutSession({
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      amountInCents: Math.round(Number(result.invoice.total) * 100),
      customerEmail: recipientEmail,
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
    console.error('Broker bundle: Stripe Payment Link create failed (continuing without Pay link):', stripeErr)
  }

  // Optionally email the accountant. Reservation flag still protects against
  // double-send if the broker double-clicks.
  let sentToEmail: string | null = null
  if (sendEmail) {
    const reserved = await prisma.invoice.updateMany({
      where: { id: result.invoice.id, invoiceEmailSentAt: null },
      data: { invoiceEmailSentAt: new Date() },
    })
    if (reserved.count > 0) {
      try {
        let pdfBytes: Uint8Array | null = null
        try {
          const full = await loadInvoiceDetailForPdf(result.invoice.id)
          if (full) pdfBytes = buildInvoicePdfBytes(full)
        } catch (pdfErr) {
          console.error('Broker bundle: PDF generation failed; sending without attachment:', pdfErr)
        }
        await sendInvoiceEmail({
          invoiceId: result.invoice.id,
          invoiceNumber: result.invoice.invoiceNumber,
          customerName: profile.fullName || profile.name || profile.email,
          customerEmail: recipientEmail,
          companyName: profile.company,
          rangeStart: startDate.toISOString().slice(0, 10),
          rangeEnd: endDate.toISOString().slice(0, 10),
          total: Number(result.invoice.total),
          orderCount: result.ordersCount,
          serviceRequestCount: result.serviceRequestsCount,
          pdfBytes,
          pdfUrl: `${baseUrl}/api/invoices/${result.invoice.id}/pdf?token=${result.publicPdfToken}`,
          payUrl: checkoutUrl,
          // recipientUserId is null because the recipient is an external
          // accountant who doesn't have a Pink Posts user account — the
          // shouldSendEmail helper fails open in that case (no pref to check).
          recipientUserId: null,
        })
        sentToEmail = recipientEmail
      } catch (emailErr) {
        console.error('Broker bundle: invoice email send failed:', emailErr)
        await prisma.invoice
          .updateMany({
            where: { id: result.invoice.id, invoiceEmailSentAt: { not: null } },
            data: { invoiceEmailSentAt: null },
          })
          .catch(() => {})
      }
    }
  }

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.InvoiceCreated,
    targetType: 'invoice',
    targetId: result.invoice.id,
    metadata: {
      generatedBy: 'broker_self_service',
      total: result.total,
      orderCount: result.ordersCount,
      orderNumbers: result.orderNumbers,
      serviceRequestCount: result.serviceRequestsCount,
      serviceRequestIds: result.serviceRequestIds,
      rangeStart: startDate.toISOString(),
      rangeEnd: endDate.toISOString(),
      filters: { minPrice, maxPrice, agent },
      sentEmail: sendEmail,
      sentToEmail,
      usedAccountantEmailOverride: !!accountantEmail,
      rememberedEmail: rememberEmail && !!accountantEmail,
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
      pdf_url: `${baseUrl}/api/invoices/${result.invoice.id}/pdf?token=${result.publicPdfToken}`,
      pay_url: checkoutUrl,
    },
    sent_to_email: sentToEmail,
  })
}
