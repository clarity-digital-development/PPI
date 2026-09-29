import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { sendInvoiceEmail } from '@/lib/email'
import { buildInvoicePdfBytes } from '@/lib/invoices/invoice-pdf'
import { loadInvoiceDetailForPdf } from '@/lib/invoices/load-detail'
import { invoiceDiscount } from '@/lib/invoices/discount'
import { uncollectableInvoice, uncollectableMessage } from '@/lib/invoices/bundle-errors'
import {
  attachOOAPickups,
  findSweepableOOAPickups,
  ooaPickupCents,
  type PreviouslyBilledScope,
} from '@/lib/invoices/ooa-pickups'
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
      // Same broker discount the admin bundler applies — the two paths must
      // never disagree about what this account owes.
      invoiceDiscountPercent: true,
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

  // Post-invoice adjustments sweep ONLY on unfiltered bundles: the agent /
  // price filters slice invoices deliberately (e.g. one invoice per agent),
  // and an adjustment from agent A's order must not land on an invoice the
  // broker filtered to agent B. Filtered bundles leave adjustments pending
  // for the next unfiltered (or admin) bundle.
  const sweepAdjustments = agent === null && minPrice === null && maxPrice === null

  // Out-of-area pickup halves (Ryan, 2026-09-28) follow the same slicing
  // logic, one notch finer. A pickup whose order is on THIS invoice always
  // rides along (the helper includes it regardless of scope). Beyond that: an
  // agent-filtered bundle takes only that agent's queued pickups, so agent A's
  // pickup never lands on the invoice cut for agent B; a price-filtered bundle
  // takes none (a pickup has no price the filter could honestly match); an
  // unfiltered bundle takes everything queued.
  const pickupScope: PreviouslyBilledScope =
    minPrice !== null || maxPrice !== null
      ? { kind: 'none' }
      : agent
        ? { kind: 'agent', agent }
        : { kind: 'all' }

  // SRs have no placedByUserId column — broker only bundles SRs they own
  // directly. Their team members' SRs aren't bundled here (would need an
  // agent-level filter that doesn't exist on SR today).
  // Arrow const (not a hoisted declaration) so the null-guard narrowing on
  // user/startDate/endDate above carries into the closure.
  const runBundleTransaction = async () =>
    prisma.$transaction(async (tx) => {
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

    // Pending post-invoice adjustments (orders edited after a previous invoice
    // of THIS broker went out). Same predicate as the admin bundler: keyed on
    // the OLD invoice's owner, cancelled orders excluded. Only swept on
    // unfiltered bundles — see sweepAdjustments above.
    const adjustmentOrders = sweepAdjustments
      ? await tx.order.findMany({
          where: {
            invoice: { userId: user.id },
            status: { not: 'cancelled' },
            postInvoiceAdjustmentCents: { not: 0 },
          },
          select: { id: true, orderNumber: true, propertyAddress: true, propertyCity: true, postInvoiceAdjustmentCents: true },
          orderBy: { createdAt: 'asc' },
        })
      : []
    const adjustmentCents = adjustmentOrders.reduce((s, o) => s + o.postInvoiceAdjustmentCents, 0)

    // Queued out-of-area pickup halves — same helper the admin bundler uses,
    // scoped by pickupScope above. Claimed below per row, race-safe.
    const pickups = await findSweepableOOAPickups(tx, user.id, orders.map((o) => o.id), pickupScope)
    const pickupCents = ooaPickupCents(pickups)

    // A pickup-only invoice is a normal case: the install was billed last
    // month and the sign came down this month.
    if (orders.length === 0 && serviceRequests.length === 0 && adjustmentOrders.length === 0 && pickups.length === 0) {
      return { invoice: null, ordersCount: 0, serviceRequestsCount: 0, subtotal: 0, total: 0 }
    }

    const ordersSubtotal = orders.reduce((s, o) => s + Number(o.subtotal || 0), 0)
    const ordersTotal = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const srTotal = serviceRequests.reduce((s, sr) => s + Number(sr.invoiceAmount || 0), 0)
    // Adjustments ride into TOTAL only — subtotal must keep matching the live
    // sum of the bundled lines (customer page + PDF re-derive it from them).
    // Pickups ARE lines on this invoice (untaxed, like service trips), so they
    // sit in subtotal and the broker discount covers them.
    const subtotal = ordersSubtotal + srTotal + pickupCents / 100
    // Broker discount off the pre-tax subtotal — see lib/invoices/discount.ts.
    const discount = invoiceDiscount(subtotal, profile.invoiceDiscountPercent)
    const total = ordersTotal + srTotal + pickupCents / 100 + adjustmentCents / 100 - discount.amount

    if (total <= 0) {
      const charges = (ordersTotal + srTotal + pickupCents / 100).toFixed(2)
      throw uncollectableInvoice(
        discount.amount > 0
          ? `This period's charges ($${charges}) don't cover your ${discount.percent}% discount (-$${discount.amount.toFixed(2)}) plus pending adjustments (-$${Math.abs(adjustmentCents / 100).toFixed(2)}). Contact Pink Posts to settle it directly.`
          : `Pending adjustments (-$${Math.abs(adjustmentCents / 100).toFixed(2)}) meet or exceed this period's charges ($${charges}). Contact Pink Posts to settle the credit directly.`
      )
    }

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        userId: user.id,
        rangeStart: startDate,
        rangeEnd: endDate,
        subtotal,
        total,
        discountPercent: discount.amount > 0 ? discount.percent : null,
        discountAmount: discount.amount > 0 ? discount.amount : null,
        status: 'sent',
        sentAt: new Date(),
        publicPdfToken: generatePublicPdfToken(),
        ...(adjustmentOrders.length > 0
          ? {
              adjustments: adjustmentOrders.map((o) => ({
                order_id: o.id,
                order_number: o.orderNumber,
                property: `${o.propertyAddress}, ${o.propertyCity}`,
                amount_cents: o.postInvoiceAdjustmentCents,
              })),
            }
          : {}),
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
    // Claim each pickup half; a mismatch throws the race error → full rollback.
    await attachOOAPickups(tx, pickups, invoice.id)

    // Sweep: zero each adjustment only if it still holds the value we read;
    // an edit racing this bundle changes it → count mismatch → full rollback.
    for (const o of adjustmentOrders) {
      const swept = await tx.order.updateMany({
        where: { id: o.id, postInvoiceAdjustmentCents: o.postInvoiceAdjustmentCents },
        data: {
          postInvoiceAdjustmentCents: 0,
          sweptAdjustmentCents: { increment: o.postInvoiceAdjustmentCents },
        },
      })
      if (swept.count !== 1) {
        throw new Error(`Concurrent bundle race: adjustment on ${o.orderNumber} changed mid-bundle`)
      }
    }

    return {
      invoice,
      ordersCount: orders.length,
      serviceRequestsCount: serviceRequests.length,
      adjustmentsCount: adjustmentOrders.length,
      pickupsCount: pickups.length,
      subtotal,
      total,
      orderNumbers: orders.map((o) => o.orderNumber),
      serviceRequestIds: serviceRequests.map((sr) => sr.id),
      pickupOrderNumbers: pickups.map((p) => p.orderNumber),
      publicPdfToken: invoice.publicPdfToken!,
    }
  })

  let result
  try {
    result = await runBundleTransaction()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    const uncollectable = uncollectableMessage(err)
    if (uncollectable) {
      return NextResponse.json({ error: uncollectable }, { status: 400 })
    }
    if (msg.startsWith('Concurrent bundle race')) {
      return NextResponse.json(
        { error: 'Another invoice was being generated at the same time — nothing was created. Refresh and try again.' },
        { status: 409 }
      )
    }
    throw err
  }

  if (!result.invoice) {
    return NextResponse.json(
      { error: 'Nothing to bundle: no pending-invoice orders, service trips, or out-of-area pickups matched your filters.' },
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
      description: `${result.ordersCount} order(s) + ${result.serviceRequestsCount} service trip(s)${result.pickupsCount > 0 ? ` + ${result.pickupsCount} out-of-area pickup(s)` : ''} — ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`,
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
          pickupCount: result.pickupsCount,
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
      pickupCount: result.pickupsCount,
      pickupOrderNumbers: result.pickupOrderNumbers,
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
      pickup_count: result.pickupsCount,
      pdf_url: `${baseUrl}/api/invoices/${result.invoice.id}/pdf?token=${result.publicPdfToken}`,
      pay_url: checkoutUrl,
    },
    sent_to_email: sentToEmail,
  })
}
