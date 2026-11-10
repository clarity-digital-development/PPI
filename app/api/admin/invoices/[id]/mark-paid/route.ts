/**
 * Admin "Mark invoice Paid" — for payments collected outside Stripe (ACH sent
 * directly to Pink Posts' bank, check, cash) that the Stripe webhook will
 * never see. Mirrors the exact cascade app/api/webhooks/stripe/route.ts runs
 * for a Stripe-collected invoice payment: Invoice -> paid, every bundled
 * Order -> paymentStatus succeeded, every bundled ServiceRequest -> invoiceStatus
 * paid, every out-of-area pickup half and post rental billed on it -> paid. No paymentIntentId is stamped anywhere (there is no real Stripe PI
 * behind a manual payment) — refundOrder() already rejects a succeeded order
 * with no paymentIntentId rather than crashing, so this is safe to leave null.
 *
 * Two hazards an adversarial review caught in the first pass, both fixed here:
 *
 * 1. The invoice's Stripe Payment Link stays live after a manual mark-paid —
 *    same "stale URL can't accept payment" hazard the regenerate-payment-link
 *    route already guards against. Deactivated the same way, best-effort.
 *
 * 2. TOCTOU race with the Stripe webhook: if a customer completes payment via
 *    the still-being-deactivated (or already-live) Payment Link at the same
 *    moment an admin clicks Mark Paid, both paths could read status:'sent'
 *    before either commits. Guarded the same way the invoice bundler
 *    (app/api/admin/invoices/route.ts) guards its own concurrent-bundle race:
 *    an updateMany conditioned on the invoice still being 'sent', with the
 *    affected-row count checked before touching orders/service requests.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { stripe } from '@/lib/stripe/server'
import { settleSplitInvoiceIfComplete } from '@/lib/invoices/split-settle'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: invoiceId } = await params

  const body = await request.json().catch(() => ({}))
  const note =
    typeof body?.note === 'string' && body.note.trim().length > 0
      ? body.note.trim().slice(0, 500)
      : null

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      total: true,
      checkoutSessionId: true,
      orders: { select: { id: true } },
      serviceRequests: { select: { id: true } },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  if (invoice.status === 'void') {
    return NextResponse.json({ error: 'Invoice is voided — nothing to mark paid.' }, { status: 400 })
  }

  // 50/50 split invoice (Ryan, 2026-11-09): mark ONE party's share paid
  // (`half`: 'A' | 'B' — e.g. their check arrived) or, with no half, every
  // unpaid share. Each share's own Payment Link is deactivated so it can't
  // also be paid online. The invoice and its lines flip to paid only once
  // every share is paid. With every share already paid (a settle that didn't
  // finish), a no-half call just settles the invoice.
  const halves = await prisma.invoicePayment.findMany({ where: { invoiceId } })
  if (halves.length > 0) {
    const half = body?.half === 'A' || body?.half === 'B' ? (body.half as 'A' | 'B') : null
    // A refunded share is owed again, so it can be marked paid by hand too.
    const targets = halves.filter((h) => (h.status === 'pending' || h.status === 'refunded') && (!half || h.half === half))
    if (half && targets.length === 0) {
      return NextResponse.json({ error: 'That share is already paid.' }, { status: 400 })
    }
    // On an invoice that's already paid, only a share refunded since (and
    // owed again) can be marked.
    if (invoice.status === 'paid' && targets.length === 0) {
      return NextResponse.json({ error: 'Invoice is already paid.' }, { status: 400 })
    }
    const sharePaidAt = new Date()
    const marked: typeof targets = []
    const paidOnline: string[] = []
    for (const h of targets) {
      if (h.checkoutSessionId?.startsWith('plink_')) {
        try {
          await stripe().paymentLinks.update(h.checkoutSessionId, { active: false })
        } catch (err) {
          console.warn(`Mark paid: could not deactivate share ${h.half} Payment Link ${h.checkoutSessionId}:`, err)
        }
      }
      const res = await prisma.invoicePayment.updateMany({
        where: { id: h.id, status: h.status },
        // No PI for a payment taken outside Stripe (drops a refunded one's).
        data: { status: 'paid', paidAt: sharePaidAt, paymentIntentId: null },
      })
      if (res.count > 0) {
        marked.push(h)
      } else {
        // Lost a race — most likely this party just paid by card. Tell the
        // admin so the check isn't ALSO deposited.
        const now = await prisma.invoicePayment.findUnique({ where: { id: h.id }, select: { paymentIntentId: true } })
        if (now?.paymentIntentId) paidOnline.push(h.payerName)
      }
    }
    if (marked.length > 0) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.InvoicePaid,
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          paidVia: 'manual_admin',
          note,
          shares: marked.map((h) => ({ half: h.half, payer: h.payerName, amountCents: h.amountCents })),
        },
        request,
      })
    }
    const settled = await settleSplitInvoiceIfComplete(invoice.id, sharePaidAt)
    if (settled) {
      await audit({
        actor: { id: user.id, email: user.email, role: user.role },
        action: AuditAction.InvoicePaid,
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          paidVia: 'manual_admin',
          split: true,
          note,
          ...settled,
          total: Number(invoice.total),
        },
        request,
      })
    }
    if (half && marked.length === 0 && paidOnline.length === 0) {
      // The share changed under us (e.g. reopened for a new link) — nothing
      // was marked, so don't report success.
      return NextResponse.json({ error: 'That share just changed — refresh the list and try again.' }, { status: 409 })
    }
    const after = await prisma.invoicePayment.findMany({ where: { invoiceId }, select: { status: true } })
    return NextResponse.json({
      success: true,
      partial: after.some((h) => h.status !== 'paid'),
      paid_online: paidOnline,
    })
  }

  if (invoice.status === 'paid') {
    return NextResponse.json({ error: 'Invoice is already paid.' }, { status: 400 })
  }

  // Best-effort deactivate the live Payment Link so it can't accept a real
  // Stripe charge after this invoice is marked paid outside Stripe. Same
  // pattern as the regenerate-payment-link route; failure is non-fatal.
  const linkId = invoice.checkoutSessionId
  if (linkId && linkId.startsWith('plink_')) {
    try {
      await stripe().paymentLinks.update(linkId, { active: false })
    } catch (err) {
      console.warn(`Mark paid: could not deactivate Payment Link ${linkId}:`, err)
    }
  }

  const paidAt = new Date()
  let ooaPickupCount = 0
  let postRentalCount = 0
  try {
    await prisma.$transaction(async (tx) => {
      // Conditional claim — only proceeds if the invoice is still 'sent'.
      // If a concurrent Stripe payment_intent.succeeded webhook already
      // flipped it to 'paid' between our read above and this write, count
      // comes back 0 and we abort instead of overwriting the real payment's
      // paidAt/audit trail with a spurious manual one.
      const claim = await tx.invoice.updateMany({
        where: { id: invoice.id, status: 'sent' },
        data: { status: 'paid', paidAt },
      })
      if (claim.count === 0) {
        throw new Error('INVOICE_ALREADY_PAID_RACE')
      }
      await tx.order.updateMany({
        where: { id: { in: invoice.orders.map((o) => o.id) } },
        data: { paymentStatus: 'succeeded', paidAt },
      })
      await tx.serviceRequest.updateMany({
        where: { id: { in: invoice.serviceRequests.map((sr) => sr.id) } },
        data: { invoiceStatus: 'paid', invoicePaidAt: paidAt },
      })
      // Same pickup flip as the webhook, keyed on the pickup's own invoice id.
      const pickups = await tx.order.updateMany({
        where: { serviceAreaSecondChargeInvoiceId: invoice.id, serviceAreaSecondChargeStatus: 'pending_invoice' },
        data: { serviceAreaSecondChargeStatus: 'paid', serviceAreaSecondChargedAt: paidAt },
      })
      ooaPickupCount = pickups.count
      // And the post rental billed on it, keyed the same way.
      const rentals = await tx.postRentalCharge.updateMany({
        where: { invoiceId: invoice.id, status: 'pending_invoice' },
        data: { status: 'succeeded', succeededAt: paidAt },
      })
      postRentalCount = rentals.count
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'INVOICE_ALREADY_PAID_RACE') {
      return NextResponse.json(
        { error: 'This invoice was just paid (likely by the customer via Stripe) — refresh the list.' },
        { status: 409 },
      )
    }
    throw err
  }

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.InvoicePaid,
    targetType: 'invoice',
    targetId: invoice.id,
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      paidVia: 'manual_admin',
      note,
      deactivatedLinkId: linkId ?? null,
      orderCount: invoice.orders.length,
      serviceRequestCount: invoice.serviceRequests.length,
      ooaPickupCount,
      postRentalCount,
      total: Number(invoice.total),
    },
    request,
  })

  return NextResponse.json({ ok: true, paid_at: paidAt.toISOString() })
}
