import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { createInvoiceCheckoutSession, stripe, paymentInFlightMessage, paymentLinkPaymentInFlight } from '@/lib/stripe/server'
import { sendInvoiceEmail } from '@/lib/email'
import { buildInvoicePdfBytes } from '@/lib/invoices/invoice-pdf'
import { loadInvoiceDetailForPdf } from '@/lib/invoices/load-detail'
import { processInvoiceSendJob } from '@/lib/invoices/send-invoice-job'
import { reopenRefundedShare } from '@/lib/invoices/split-settle'

/**
 * Admin: regenerate the Stripe Payment Link for an invoice.
 *
 * Use case: the original Payment Link is broken/deactivated/can't be paid
 * (rare — Payment Links don't expire, but a Stripe outage or accidental
 * deactivation could leave a customer stranded). Admin clicks "Regenerate
 * Payment Link" on /admin/invoices and we:
 *
 *   1. Deactivate the old Payment Link in Stripe (best-effort).
 *   2. Create a fresh Payment Link with a NEW idempotency key — the old key
 *      points at the deactivated link, so we suffix with a regen counter to
 *      get a fresh one.
 *   3. Update Invoice.checkoutSessionId + checkoutUrl.
 *   4. Re-render the PDF and re-send the invoice email to the same recipient
 *      (billing contact if set, else account email) so the customer gets the
 *      working link without the admin having to copy/paste anything.
 *
 * Refuses to regenerate for already-paid or voided invoices.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, fullName: true, name: true, company: true, billingEmail: true } },
      orders: { include: { orderItems: true }, orderBy: { createdAt: 'asc' } },
      serviceRequests: {
        include: { installation: { select: { propertyAddress: true, propertyCity: true, propertyState: true, propertyZip: true } } },
        orderBy: { completedAt: 'asc' },
      },
      _count: { select: { ooaPickupOrders: true, postRentalCharges: true } },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status === 'void') {
    return NextResponse.json({ error: 'Invoice is voided — regenerate not allowed.' }, { status: 400 })
  }

  // 50/50 split invoice (Ryan, 2026-11-09): each share has its own link.
  // Replace ONE share's link (`half`) and re-email just that party — the
  // send worker mints the new link under fresh keys once the old one is off.
  const halves = await prisma.invoicePayment.findMany({ where: { invoiceId: id } })
  if (halves.length > 0) {
    const regenBody = await request.json().catch(() => ({}))
    const half = regenBody?.half === 'A' || regenBody?.half === 'B' ? (regenBody.half as 'A' | 'B') : null
    const row = half ? halves.find((h) => h.half === half) : null
    if (!row) {
      return NextResponse.json({ error: "This invoice is split. Pick which party's pay link to replace." }, { status: 400 })
    }
    if (row.status === 'paid') {
      return NextResponse.json({ error: `${row.payerName}'s share is already paid.` }, { status: 400 })
    }
    // A refunded share is owed again: its old link's one checkout was the
    // payment that got refunded, so there's nothing to check or turn off.
    const wasRefunded = row.status === 'refunded'
    // Claim the send slot FIRST, so a refusal can't leave this party with
    // their old link turned off and no new one. Released on any refusal below.
    const priorEmailStatus = invoice.emailStatus
    // The invoice itself may already be paid: a share refunded after it
    // settled is owed again and gets billed the same way.
    const claim = await prisma.invoice.updateMany({
      where: { id, status: { in: ['sent', 'paid'] }, emailStatus: { notIn: ['queued', 'sending'] } },
      data: { emailStatus: 'queued', emailError: null, sendingStartedAt: null },
    })
    if (claim.count === 0) {
      return NextResponse.json({ error: 'This invoice is sending right now — try again in a minute.' }, { status: 409 })
    }
    const release = () =>
      prisma.invoice
        .updateMany({ where: { id, emailStatus: 'queued' }, data: { emailStatus: priorEmailStatus } })
        .catch(() => {})
    // Same rules as the whole-invoice path below: don't replace a link whose
    // payment is paid or still clearing, and don't make a new one unless
    // Stripe confirms the old one is off.
    const oldShareLink = !wasRefunded && row.checkoutSessionId?.startsWith('plink_') ? row.checkoutSessionId : null
    if (oldShareLink) {
      try {
        const old = await stripe().paymentLinks.retrieve(oldShareLink)
        if (!old.active) {
          const inFlight = await paymentLinkPaymentInFlight(oldShareLink)
          if (inFlight) {
            await release()
            return NextResponse.json({ error: paymentInFlightMessage(inFlight) }, { status: 409 })
          }
        } else {
          await stripe().paymentLinks.update(oldShareLink, { active: false })
        }
      } catch (err) {
        const code = (err as { code?: string })?.code
        if (code !== 'resource_missing') {
          console.error(`Regenerate: could not check or turn off share ${row.half} link ${oldShareLink}:`, err)
          await release()
          return NextResponse.json(
            { error: "Couldn't turn off the old Stripe pay link, so no new one was made. Please try again." },
            { status: 502 },
          )
        }
      }
    }
    if (wasRefunded) {
      // Its stored link may not be the one the refunded payment used; make
      // sure it can't take a payment alongside the new one.
      if (row.checkoutSessionId?.startsWith('plink_')) {
        await stripe()
          .paymentLinks.update(row.checkoutSessionId, { active: false })
          .catch((err) => console.warn(`Regenerate: couldn't turn off refunded share ${row.half}'s link ${row.checkoutSessionId}:`, err))
      }
      await reopenRefundedShare(row.id)
    }
    await processInvoiceSendJob({
      invoiceId: id,
      resolvedRecipientEmail: row.payerEmail,
      recipientSource: 'snapshot',
      rangeStartIso: invoice.rangeStart.toISOString(),
      rangeEndIso: invoice.rangeEnd.toISOString(),
      splitResend: true,
      splitHalf: row.half as 'A' | 'B',
      splitFreshLink: true,
    })
    const after = await prisma.invoicePayment.findUnique({
      where: { id: row.id },
      select: { checkoutSessionId: true, checkoutUrl: true, emailStatus: true, emailError: true },
    })
    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.InvoiceResent,
      targetType: 'invoice',
      targetId: id,
      metadata: { invoiceNumber: invoice.invoiceNumber, half: row.half, payer: row.payerName, regeneratedLink: true, emailStatus: after?.emailStatus ?? null },
      request,
    })
    // Success only when a NEW link went out — never the one just turned off.
    const gotNewLink =
      !!after?.checkoutSessionId?.startsWith('plink_') && after.checkoutSessionId !== row.checkoutSessionId
    if (after?.emailStatus !== 'sent' || !gotNewLink) {
      return NextResponse.json(
        { error: after?.emailError || "A new pay link wasn't sent. Try New link again in a minute." },
        { status: 502 },
      )
    }
    return NextResponse.json({ ok: true, checkout_url: after.checkoutUrl, recipient_email: row.payerEmail })
  }

  if (invoice.status === 'paid') {
    return NextResponse.json({ error: 'Invoice is already paid — no Payment Link needed.' }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://pinkposts.com'
  // Recipient resolution: snapshot first (Round 21). For invoices created
  // BEFORE Round 21 deployed (recipientEmail is NULL), fall back to the
  // same create-time resolution the bundler uses today — billingEmail ||
  // email. The original "drift" concern only applies when a snapshot
  // exists and disagrees with current billingEmail; for legacy rows the
  // snapshot doesn't exist at all, so honoring the current billing
  // contact matches admin expectations everywhere else in Round 21.
  const recipientEmail: string =
    invoice.recipientEmail || invoice.user.billingEmail || invoice.user.email

  // Turn off the old Payment Link so a stale URL can't accept payment after
  // we've issued a new one. Two things stop the regenerate:
  // - the old link already took a payment that's paid or still clearing (a
  //   used link is inactive, and the webhook only marks the invoice paid once
  //   the money clears) — a new link would let the customer pay twice;
  // - Stripe won't confirm the old link is off — two live links again.
  // A link Stripe no longer has (resource_missing) can't take a payment.
  const oldLinkId = invoice.checkoutSessionId
  if (oldLinkId && oldLinkId.startsWith('plink_')) {
    try {
      const old = await stripe().paymentLinks.retrieve(oldLinkId)
      if (!old.active) {
        const inFlight = await paymentLinkPaymentInFlight(oldLinkId)
        if (inFlight) {
          return NextResponse.json({ error: paymentInFlightMessage(inFlight) }, { status: 409 })
        }
      } else {
        await stripe().paymentLinks.update(oldLinkId, { active: false })
      }
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code !== 'resource_missing') {
        console.error(`Regenerate: could not check or turn off old Payment Link ${oldLinkId}:`, err)
        return NextResponse.json(
          { error: "Couldn't turn off the old Stripe pay link, so no new one was made. Please try again." },
          { status: 502 },
        )
      }
    }
  }

  // Create the new Payment Link. Bump the idempotency key with a regen
  // counter so Stripe gives us a fresh link instead of returning the old
  // (now-deactivated) one. Counter = number of times we've already
  // regenerated, derived from the audit log or simply the current time.
  // Simpler approach: use the current Invoice.updatedAt millis as the bump.
  // Counter pulled from update_at timestamp + invocation time to guarantee
  // uniqueness across rapid retries.
  const bump = `${invoice.updatedAt.getTime()}-${Date.now()}`
  const pickupCount = invoice._count.ooaPickupOrders
  const rentalCount = invoice._count.postRentalCharges
  let newLink: { id: string; url: string | null }
  try {
    newLink = await createInvoiceCheckoutSession({
      // The REAL id — the webhook finds the invoice by it. The bump goes in
      // the idempotency keys only (it used to ride here as "<id>#<bump>").
      invoiceId: invoice.id,
      idempotencySuffix: bump,
      invoiceNumber: invoice.invoiceNumber,
      amountInCents: Math.round(Number(invoice.total) * 100),
      customerEmail: recipientEmail,
      successUrl: `${baseUrl}/invoice-paid?invoice=${invoice.invoiceNumber}`,
      cancelUrl: `${baseUrl}/invoice-cancelled?invoice=${invoice.invoiceNumber}`,
      description: `${invoice.orders.length} order(s) + ${invoice.serviceRequests.length} service trip(s)${pickupCount > 0 ? ` + ${pickupCount} out-of-area pickup(s)` : ''}${rentalCount > 0 ? ` + ${rentalCount} post rental charge(s)` : ''}`,
    })
  } catch (err) {
    console.error('Regenerate: Stripe Payment Link create failed:', err)
    return NextResponse.json(
      { error: 'Could not create a new Stripe Payment Link. Please try again.' },
      { status: 500 },
    )
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { checkoutSessionId: newLink.id, checkoutUrl: newLink.url },
  })

  // Re-render the PDF and resend the email with the fresh Pay link. We
  // intentionally bypass the invoiceEmailSentAt reservation flag so the
  // resend always goes out (the regenerate button is an explicit
  // human-initiated retry — flag is for accidental double-bundling, not
  // intentional manual resend).
  const detail = await loadInvoiceDetailForPdf(invoice.id)
  if (!detail) {
    return NextResponse.json({ error: 'Invoice disappeared during regenerate.' }, { status: 500 })
  }

  let emailSent = false
  try {
    const pdfBytes = buildInvoicePdfBytes(detail)
    const sendResult = await sendInvoiceEmail({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: detail.customer.name,
      customerEmail: recipientEmail,
      companyName: detail.customer.company,
      rangeStart: detail.range_start.slice(0, 10),
      rangeEnd: detail.range_end.slice(0, 10),
      total: detail.total,
      orderCount: invoice.orders.length,
      serviceRequestCount: invoice.serviceRequests.length,
      pickupCount,
      rentalCount,
      pdfBytes,
      pdfUrl: invoice.publicPdfToken
        ? `${baseUrl}/api/invoices/${invoice.id}/pdf?token=${invoice.publicPdfToken}`
        : null,
      payUrl: newLink.url,
      subjectOverride: `Updated payment link — Invoice ${invoice.invoiceNumber} — $${detail.total.toFixed(2)}`,
      bannerHtml: `
        <div style="background-color: #FEF3C7; border: 1px solid #F59E0B; color: #92400E; padding: 14px 16px; border-radius: 8px; margin-bottom: 24px; text-align: left; font-size: 14px;">
          <strong>Updated payment link.</strong> The previous link for this invoice has been replaced — please use the new "Pay" button below.
        </div>
      `,
      recipientUserId: invoice.userId,
    })
    // Resend returns { error } instead of throwing on a rejected send.
    if (sendResult && typeof sendResult === 'object' && 'error' in sendResult && sendResult.error) {
      const e = sendResult.error as { name?: string; message?: string }
      throw new Error(e.message || e.name || 'Resend rejected the message')
    }
    emailSent = true
  } catch (err) {
    console.error('Regenerate: re-send email failed (link was created successfully):', err)
  }

  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.InvoiceCreated, // no dedicated enum value yet — reuse with metadata
    targetType: 'invoice',
    targetId: invoice.id,
    metadata: {
      action: 'regenerate_payment_link',
      oldLinkId: oldLinkId ?? null,
      newLinkId: newLink.id,
      newLinkUrl: newLink.url,
      sentToEmail: recipientEmail,
      emailResent: emailSent,
    },
    request,
  })

  return NextResponse.json({
    ok: true,
    checkout_session_id: newLink.id,
    checkout_url: newLink.url,
    email_resent: emailSent,
    sent_to_email: recipientEmail,
  })
}
