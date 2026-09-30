import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { processInvoiceSendJob } from '@/lib/invoices/send-invoice-job'
import { invoiceDiscount } from '@/lib/invoices/discount'
import { uncollectableInvoice, uncollectableMessage } from '@/lib/invoices/bundle-errors'
import {
  attachOOAPickups,
  findSweepableOOAPickups,
  ooaPickupCents,
  toInvoicePickup,
} from '@/lib/invoices/ooa-pickups'

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

/**
 * Which orders an invoice for this customer bundles — preview and POST share
 * it so they can never disagree. A team_admin also pays for the orders they
 * place on an agent's behalf (userId = the agent, placedByUserId = the
 * team_admin), the same rule the broker self-serve bundler has always used
 * (app/api/invoices/bundle/route.ts). Matching userId alone meant a
 * brokerage's on-behalf orders could never be invoiced from /admin/invoices.
 */
function orderOwnershipWhere(customerId: string, role: string | null | undefined): Prisma.OrderWhereInput {
  return role === 'team_admin'
    ? { OR: [{ userId: customerId }, { placedByUserId: customerId }] }
    : { userId: customerId }
}

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
    // Role picks the order-ownership rule; the discount rate is the same one
    // the POST will apply, so the admin never previews one number and sends
    // another.
    const previewCustomer = await prisma.user.findUnique({
      where: { id: customerId },
      select: { role: true, invoiceDiscountPercent: true },
    })
    const [orders, serviceRequests] = await Promise.all([
      prisma.order.findMany({
        where: {
          ...orderOwnershipWhere(customerId, previewCustomer?.role),
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

    // Mirror of the POST sweep query — shows the admin what adjustment lines
    // the next invoice will carry before they create it. Keyed on the OLD
    // invoice's owner (not order.userId): a team_admin's on-behalf order is
    // owned by the agent, but the broker's invoice paid it — the adjustment
    // belongs to whoever gets invoiced, not to whoever the sign was for.
    // Cancelled orders excluded: a cancelled order's money is handled by the
    // cancel/credit flow; sweeping its stale adjustment would bill for it.
    const adjustmentOrders = await prisma.order.findMany({
      where: {
        invoice: { userId: customerId },
        status: { not: 'cancelled' },
        postInvoiceAdjustmentCents: { not: 0 },
      },
      select: { id: true, orderNumber: true, propertyAddress: true, propertyCity: true, postInvoiceAdjustmentCents: true },
      orderBy: { createdAt: 'asc' },
    })
    const adjustmentCents = adjustmentOrders.reduce((s, o) => s + o.postInvoiceAdjustmentCents, 0)

    // Out-of-area pickup halves queued for this account (Ryan, 2026-09-28) —
    // the SAME helper the POST claims with, so the preview can't list a
    // different set of lines from the invoice that gets sent. No date-range
    // filter, like adjustments: a pickup belongs to whichever invoice is next.
    const pickups = await findSweepableOOAPickups(prisma, customerId, orders.map((o) => o.id), { kind: 'all' })
    const pickupCents = ooaPickupCents(pickups)

    const ordersSubtotal = orders.reduce((s, o) => s + Number(o.subtotal || 0), 0)
    const ordersTotal = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const srTotal = serviceRequests.reduce((s, sr) => s + Number(sr.invoiceAmount || 0), 0)
    // Adjustments ride into TOTAL only. Folding them into subtotal breaks the
    // display math everywhere subtotal is re-derived live from the bundled
    // orders (customer page, PDF) — the adjustment source orders belong to
    // OLD invoices and are never in this invoice's orders relation. Pickups
    // are different: they're real lines on THIS invoice (re-derived live via
    // ooaPickupOrders), untaxed like service trips, so they sit in subtotal
    // and the broker discount covers them.
    const subtotal = ordersSubtotal + srTotal + pickupCents / 100
    const discount = invoiceDiscount(subtotal, previewCustomer?.invoiceDiscountPercent)
    const total = ordersTotal + srTotal + pickupCents / 100 + adjustmentCents / 100 - discount.amount
    return NextResponse.json({
      discount_percent: discount.amount > 0 ? discount.percent : null,
      discount_amount: discount.amount > 0 ? discount.amount : null,
      adjustments: adjustmentOrders.map((o) => ({
        order_id: o.id,
        order_number: o.orderNumber,
        property: `${o.propertyAddress}, ${o.propertyCity}`,
        amount: o.postInvoiceAdjustmentCents / 100,
      })),
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
      pickups: pickups.map((p) => {
        const line = toInvoicePickup(p)
        return {
          order_id: line.order_id,
          order_number: line.order_number,
          property: `${line.property_address}, ${line.property_city}, ${line.property_state} ${line.property_zip}`,
          removal_date: line.removal_date,
          amount: line.amount,
        }
      }),
      subtotal,
      total,
      count: orders.length + serviceRequests.length + adjustmentOrders.length + pickups.length,
      order_count: orders.length,
      service_request_count: serviceRequests.length,
      adjustment_count: adjustmentOrders.length,
      pickup_count: pickups.length,
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
      // service trips" alongside paid/sent dates instead of just orders;
      // ooaPickupOrders so a pickup-only invoice doesn't read as "0 orders".
      _count: { select: { orders: true, serviceRequests: true, ooaPickupOrders: true } },
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
      pickup_count: i._count.ooaPickupOrders,
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
    select: {
      id: true, email: true, fullName: true, name: true, company: true, billingEmail: true,
      // Snapshotted onto the invoice below, so changing the account's rate
      // later never rewrites what an already-sent invoice said.
      invoiceDiscountPercent: true,
      // Picks the order-ownership rule — see orderOwnershipWhere.
      role: true,
    },
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
  // Arrow const (not a hoisted declaration) so the null-guard narrowing on
  // startDate/endDate above carries into the closure.
  const runBundleTransaction = async () =>
    prisma.$transaction(async (tx) => {
    const [orders, serviceRequests] = await Promise.all([
      tx.order.findMany({
        where: {
          ...orderOwnershipWhere(customerId, customer.role),
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

    // Pending post-invoice adjustments: previously-invoiced orders that were
    // edited after their invoice went out, keyed on the OLD invoice's owner
    // (handles team_admin on-behalf orders whose order.userId is the agent).
    // Swept regardless of the date range — the adjustment belongs to whenever
    // the NEXT invoice happens, not to when the original order was placed.
    // Cancelled orders excluded: their money is the cancel/credit flow's job.
    const adjustmentOrders = await tx.order.findMany({
      where: {
        invoice: { userId: customerId },
        status: { not: 'cancelled' },
        postInvoiceAdjustmentCents: { not: 0 },
      },
      select: {
        id: true,
        orderNumber: true,
        propertyAddress: true,
        propertyCity: true,
        postInvoiceAdjustmentCents: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    const adjustmentCents = adjustmentOrders.reduce((s, o) => s + o.postInvoiceAdjustmentCents, 0)

    // Queued out-of-area pickup halves — same helper + scope as the preview.
    // Read inside the transaction and claimed below with a per-row
    // conditional update, so two parallel sends can't both bill one.
    const pickups = await findSweepableOOAPickups(tx, customerId, orders.map((o) => o.id), { kind: 'all' })
    const pickupCents = ooaPickupCents(pickups)

    // A pickup-only invoice is a normal case: the install was billed last
    // month and the sign came down this month.
    if (orders.length === 0 && serviceRequests.length === 0 && adjustmentOrders.length === 0 && pickups.length === 0) {
      return { invoice: null, ordersCount: 0, serviceRequestsCount: 0, subtotal: 0, total: 0 }
    }

    const ordersSubtotal = orders.reduce((s, o) => s + Number(o.subtotal || 0), 0)
    const ordersTotal = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const srTotal = serviceRequests.reduce((s, sr) => s + Number(sr.invoiceAmount || 0), 0)
    // Adjustments ride into TOTAL only; pickups sit in subtotal (discounted,
    // untaxed) — see the preview branch comment.
    const subtotal = ordersSubtotal + srTotal + pickupCents / 100
    // Broker discount off the pre-tax subtotal — see lib/invoices/discount.ts.
    // Deliberately NOT applied to `adjustmentCents`: an adjustment is a
    // tax-inclusive correction to an order that a PREVIOUS invoice already
    // settled, so discounting it again would apply the rate to a different
    // base than every other line. It means a correction settles at list value
    // while the original settled at the discounted rate. Nothing in production
    // has ever carried an adjustment line (checked 2026-09-23: 0 invoices), so
    // this is a documented choice rather than an observed behaviour — revisit
    // with Ryan the first time an invoice actually carries one.
    const discount = invoiceDiscount(subtotal, customer.invoiceDiscountPercent)
    const total = ordersTotal + srTotal + pickupCents / 100 + adjustmentCents / 100 - discount.amount

    // Net-negative or zero invoices can't be collected via a Stripe Payment
    // Link. Rare (needs credits exceeding the period's new work) — surface it
    // to the admin instead of creating an uncollectable invoice.
    if (total <= 0) {
      const charges = (ordersTotal + srTotal + pickupCents / 100).toFixed(2)
      throw uncollectableInvoice(
        discount.amount > 0
          ? `This period's charges ($${charges}) don't cover the ${discount.percent}% discount (-$${discount.amount.toFixed(2)}) plus pending adjustments (-$${Math.abs(adjustmentCents / 100).toFixed(2)}). Handle it manually, or wait for more orders before invoicing.`
          : `Pending adjustments (-$${Math.abs(adjustmentCents / 100).toFixed(2)}) meet or exceed this period's charges ($${charges}). Handle the credit manually, or wait for more orders before invoicing.`
      )
    }

    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: generateInvoiceNumber(),
        userId: customerId,
        rangeStart: startDate,
        rangeEnd: endDate,
        subtotal,
        total,
        discountPercent: discount.amount > 0 ? discount.percent : null,
        discountAmount: discount.amount > 0 ? discount.amount : null,
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
        // Snapshot of the swept adjustment lines — the source column is
        // zeroed below, so the PDF renders from this forever.
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
      select: { id: true, invoiceNumber: true, total: true, subtotal: true, publicPdfToken: true, recipientEmail: true, emailStatus: true },
    })

    // Race guard: filter the UPDATE on `invoiceId: null` too, then verify
    // the affected count matches what we read. If a parallel admin send
    // grabbed any of these rows between the SELECT and the UPDATE, the
    // count won't match — we throw to roll back the whole transaction and
    // the second admin gets a 500 they can retry from a clean state.
    //
    // Each order is also matched on the subtotal/total this invoice summed: an
    // edit or an out-of-area fee removal that commits between the read and
    // here (invoiceId still null) would otherwise attach with the invoice and
    // its payment link billing the old amount. Same count check, same 409.
    if (orders.length > 0) {
      const ordersUpdate = await tx.order.updateMany({
        where: {
          invoiceId: null,
          // Still billable: a cancel mid-bundle flips this to 'failed'.
          paymentStatus: 'pending_invoice',
          OR: orders.map((o) => ({ id: o.id, subtotal: o.subtotal, total: o.total })),
        },
        data: { invoiceId: invoice.id },
      })
      if (ordersUpdate.count !== orders.length) {
        throw new Error(`Concurrent bundle race: expected to attach ${orders.length} orders, attached ${ordersUpdate.count}`)
      }
    }
    if (serviceRequests.length > 0) {
      const srUpdate = await tx.serviceRequest.updateMany({
        // Only at the amount this invoice summed — an admin re-pricing the
        // request mid-bundle rolls this back rather than billing the old one.
        where: {
          invoiceId: null,
          OR: serviceRequests.map((sr) => ({ id: sr.id, invoiceAmount: sr.invoiceAmount })),
        },
        data: { invoiceId: invoice.id },
      })
      if (srUpdate.count !== serviceRequests.length) {
        throw new Error(`Concurrent bundle race: expected to attach ${serviceRequests.length} SRs, attached ${srUpdate.count}`)
      }
    }
    // Claim each pickup half for this invoice; a row that changed or was
    // claimed mid-bundle throws the race error and rolls everything back.
    await attachOOAPickups(tx, pickups, invoice.id)

    // Sweep the adjustments: zero each source column ONLY if it still holds
    // the value we read (an edit saving mid-bundle would change it — count
    // mismatch rolls the whole invoice back, same policy as the races above)
    // and move it into sweptAdjustmentCents so a later edit's SET arithmetic
    // knows this much has now been billed.
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
      adjustmentCents,
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
    // Our own deliberate aborts carry instructive messages — surface them as
    // structured errors instead of letting them decay into a bare 500 page.
    const uncollectable = uncollectableMessage(err)
    if (uncollectable) {
      return NextResponse.json({ error: uncollectable }, { status: 400 })
    }
    if (msg.startsWith('Concurrent bundle race')) {
      return NextResponse.json(
        { error: 'Another invoice was being generated for this customer at the same time — nothing was created. Refresh and try again.' },
        { status: 409 }
      )
    }
    throw err
  }

  if (!result.invoice) {
    return NextResponse.json(
      { error: 'Nothing to bundle: no pending-invoice orders or service trips in this date range, and no adjustments or out-of-area pickups waiting to be billed.' },
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
      pickupCount: result.pickupsCount,
      pickupOrderNumbers: result.pickupOrderNumbers,
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
      pickup_count: result.pickupsCount,
      email_status: 'queued',
      recipient_email: resolvedRecipientEmail,
    },
  })
}
