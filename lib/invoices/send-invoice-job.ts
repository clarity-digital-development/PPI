/**
 * Background worker for the invoice email send.
 *
 * The POST /api/admin/invoices route returns immediately after the DB
 * transaction commits, then runs this worker under waitUntil. Doing
 * the slow network I/O (Stripe Payment Link create + PDF generation +
 * Resend send) in a request handler caused the original "Load failed"
 * Safari timeout — the round trip was 10-15s, which Safari and some
 * gateways won't tolerate.
 *
 * Idempotency layers (any one is sufficient to prevent a duplicate send):
 *   1. The claim step `UPDATE WHERE emailStatus IN ('queued','failed')`
 *      is a single-flight gate. A second invocation finds count=0 and exits.
 *   2. `invoiceEmailSentAt IS NULL` reservation gates the actual Resend.
 *   3. Stripe Payment Link create uses an idempotencyKey derived from
 *      invoice.id (see lib/stripe/server.ts createInvoiceCheckoutSession).
 *
 * Crash-recovery: if the function dies between claim and final state
 * write, the row is left in 'sending' (or 'queued' if it never started).
 * The admin Resend route accepts either once the row is 10+ minutes stale.
 * (instrumentation.ts was meant to heal these on boot, but Next 14 only
 * runs it with experimental.instrumentationHook, which was never set.)
 *
 * Audit trail: the route writes InvoiceCreated (intent — which recipient
 * the admin typed). This worker writes InvoiceEmailSent / Failed / Skipped
 * (outcome — which recipient the customer actually received the email to,
 * plus the Resend message id when successful). Don't conflate; the split
 * keeps the log faithful when a Resend overrides the recipient.
 */
import { prisma } from '@/lib/prisma'
import { audit, AuditAction } from '@/lib/audit'
import { sendInvoiceEmail } from '@/lib/email'
import { buildInvoicePdfBytes } from '@/lib/invoices/invoice-pdf'
import { loadInvoiceDetailForPdf } from '@/lib/invoices/load-detail'
import { createInvoiceCheckoutSession, paymentInFlightMessage, paymentLinkPaymentInFlight, stripe } from '@/lib/stripe/server'

export interface SendInvoiceJobArgs {
  invoiceId: string
  // The recipient resolved at create-time. Passed as an argument (not
  // re-read from the DB inside the worker) so a concurrent Resend that
  // mutates Invoice.recipientEmail can't redirect this in-flight send.
  resolvedRecipientEmail: string
  // Where the resolved address came from. Echoed into the outcome audit
  // event so the trail records both intent and effect. 'snapshot' is the
  // resend path's "admin reused the previously-snapshotted recipient"
  // — distinct from 'account' (no billing email was ever set).
  recipientSource: 'override' | 'snapshot' | 'billing' | 'account'
  // Range labels for the email body. The route already has them as Dates;
  // strings are easier to pass through the job boundary.
  rangeStartIso: string
  rangeEndIso: string
  // 50/50 split invoices: a resend re-emails the unpaid half (or both) even
  // if it was sent before; `splitHalf` limits it to one half. Ignored for
  // ordinary invoices.
  splitResend?: boolean
  splitHalf?: 'A' | 'B'
  // The caller has already turned off (or written off) `splitHalf`'s stored
  // link: never reuse it, always mint a new one under fresh keys, and don't
  // email that party at all if Stripe can't make the new link.
  splitFreshLink?: boolean
}

export async function processInvoiceSendJob(args: SendInvoiceJobArgs): Promise<void> {
  const { invoiceId, resolvedRecipientEmail, recipientSource, rangeStartIso, rangeEndIso } = args

  // 1. Claim the job atomically. Refuses to pick up rows that are already
  //    'sending' (in-flight elsewhere) or 'sent' / 'skipped' (terminal).
  //    A concurrent invocation will see count=0 and return without side
  //    effects.
  const claim = await prisma.invoice.updateMany({
    where: { id: invoiceId, emailStatus: { in: ['queued', 'failed'] } },
    data: { emailStatus: 'sending', sendingStartedAt: new Date() },
  })
  if (claim.count === 0) {
    console.log(`[invoice-send] ${invoiceId} skipped — claim refused (already in flight or terminal)`)
    return
  }

  let stripeError: string | null = null
  let pdfError: string | null = null

  // 2. Re-load the invoice + customer so we have everything Stripe + Resend
  //    need. We trust the resolvedRecipientEmail passed in over invoice.recipientEmail
  //    — see file header on why.
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      publicPdfToken: true,
      userId: true,
      checkoutSessionId: true,
      checkoutUrl: true,
      user: { select: { email: true, fullName: true, name: true, company: true } },
    },
  })
  if (!invoice || !invoice.user) {
    // Shouldn't happen — the route just created this row. If it does, flip
    // to failed so admin can see + investigate, not silently leave hanging.
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { emailStatus: 'failed', emailError: 'Invoice or customer missing at worker start' },
    }).catch(() => {})
    return
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://pinkposts.com'

  // 50/50 split invoice: each unpaid half gets its own pay link and email.
  const halves = await prisma.invoicePayment.findMany({ where: { invoiceId }, orderBy: { half: 'asc' } })
  if (halves.length > 0) {
    await sendSplitHalves({
      invoice,
      halves,
      baseUrl,
      rangeStartIso,
      rangeEndIso,
      resend: !!args.splitResend,
      onlyHalf: args.splitHalf,
      freshLink: !!args.splitFreshLink && !!args.splitHalf,
    })
    return
  }

  // 3. Stripe Payment Link (non-fatal). If this fails the email still goes
  //    out, just without a Pay button — admin can use Regenerate Pay Link
  //    on the invoice page later. Logged for visibility.
  let checkoutUrl: string | null = null
  // A resend must not mint a second live link for the same invoice (the
  // customer could pay both; the webhook skips the second as already paid).
  // Reuse the stored link while Stripe says it's active. If Stripe can't be
  // asked, keep the stored URL rather than risk a duplicate. An inactive link
  // usually means its one checkout was used: if that payment went through or
  // is still clearing, don't bill again (stop, flagged for admin). Only a
  // link whose checkouts all failed, or one turned off by hand, gets a
  // replacement, under fresh idempotency keys (the original keys would
  // replay the dead link).
  const priorLinkId = invoice.checkoutSessionId?.startsWith('plink_') ? invoice.checkoutSessionId : null
  if (priorLinkId) {
    let inFlight: string | null = null
    try {
      const link = await stripe().paymentLinks.retrieve(priorLinkId)
      if (link.active) checkoutUrl = link.url
      else inFlight = await paymentLinkPaymentInFlight(priorLinkId)
    } catch (err) {
      console.error(`[invoice-send] ${invoiceId} couldn't check the stored Payment Link; reusing it:`, err)
      checkoutUrl = invoice.checkoutUrl
    }
    if (inFlight) {
      const reason = paymentInFlightMessage(inFlight)
      console.warn(`[invoice-send] ${invoiceId} not sent: ${reason}`)
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { emailStatus: 'failed', emailError: reason, sendingStartedAt: null },
      }).catch(() => {})
      await audit({
        actor: { system: true },
        action: AuditAction.InvoiceEmailFailed,
        targetType: 'invoice',
        targetId: invoiceId,
        metadata: { invoiceNumber: invoice.invoiceNumber, attemptedRecipient: resolvedRecipientEmail, recipientSource, error: reason, paymentLinkId: priorLinkId },
      }).catch(() => {})
      return
    }
  }
  if (!checkoutUrl) {
    try {
      const session = await createInvoiceCheckoutSession({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amountInCents: Math.round(Number(invoice.total) * 100),
        customerEmail: invoice.user.email,
        description: `Invoice ${invoice.invoiceNumber} — ${rangeStartIso.slice(0, 10)} to ${rangeEndIso.slice(0, 10)}`,
        successUrl: `${baseUrl}/invoice-paid?invoice=${invoice.invoiceNumber}`,
        cancelUrl: `${baseUrl}/invoice-cancelled?invoice=${invoice.invoiceNumber}`,
        idempotencySuffix: invoice.checkoutSessionId ? `resend-${Date.now().toString(36)}` : undefined,
      })
      checkoutUrl = session.url
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { checkoutSessionId: session.id, checkoutUrl: session.url },
      })
    } catch (err) {
      stripeError = err instanceof Error ? err.message : String(err)
      console.error(`[invoice-send] ${invoiceId} Stripe Payment Link failed (continuing without):`, err)
    }
  }

  // 4. Generate the PDF (non-fatal). The email still sends without an
  //    attachment if PDF gen blows up — customer can hit the public PDF
  //    URL with the token.
  let pdfBytes: Uint8Array | null = null
  try {
    const full = await loadInvoiceDetailForPdf(invoice.id)
    if (full) pdfBytes = buildInvoicePdfBytes(full)
  } catch (err) {
    pdfError = err instanceof Error ? err.message : String(err)
    console.error(`[invoice-send] ${invoiceId} PDF generation failed (sending without attachment):`, err)
  }

  // 5. Reserve the email slot (existing single-flight that pre-dates this
  //    worker — kept for back-compat with anything else that might trigger
  //    a send). If reservation fails, the email already went out on a
  //    prior worker run — flip emailStatus to 'sent' to reflect reality
  //    and exit without re-sending.
  const reserved = await prisma.invoice.updateMany({
    where: { id: invoiceId, invoiceEmailSentAt: null },
    data: { invoiceEmailSentAt: new Date() },
  })
  if (reserved.count === 0) {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { emailStatus: 'sent', emailError: null, sendingStartedAt: null },
    }).catch(() => {})
    console.log(`[invoice-send] ${invoiceId} email already sent on a previous run — marked sent`)
    return
  }

  // 6. Send. Use the recipient resolved at the route / resend-endpoint
  //    boundary — NOT re-derived here, so the address can't drift.
  try {
    // Counted here rather than read off the PDF detail above: PDF generation
    // is allowed to fail, and the email's count line must still be right.
    // ooaPickupOrders so a pickup-only invoice (Ryan, 2026-09-28) doesn't
    // read as "this invoice" in the email; postRentalCharges likewise.
    const counts = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { _count: { select: { orders: true, serviceRequests: true, ooaPickupOrders: true, postRentalCharges: true } } },
    })
    const result = await sendInvoiceEmail({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.user.fullName || invoice.user.name || invoice.user.email,
      customerEmail: resolvedRecipientEmail,
      companyName: invoice.user.company,
      rangeStart: rangeStartIso.slice(0, 10),
      rangeEnd: rangeEndIso.slice(0, 10),
      total: Number(invoice.total),
      orderCount: counts._count.orders,
      serviceRequestCount: counts._count.serviceRequests,
      pickupCount: counts._count.ooaPickupOrders,
      rentalCount: counts._count.postRentalCharges,
      pdfBytes,
      pdfUrl: invoice.publicPdfToken
        ? `${baseUrl}/api/invoices/${invoice.id}/pdf?token=${invoice.publicPdfToken}`
        : `${baseUrl}/api/invoices/${invoice.id}/pdf`,
      payUrl: checkoutUrl,
      recipientUserId: invoice.userId,
    })

    // CR3 (Round 22): invoices always send — the opt-out "skipped" path was
    // removed (see sendInvoiceEmail; a bill is transactional and must reach the
    // customer even if they opted out of order email). Resend API errors are
    // still handled below so a rejected send flips the row to 'failed'.

    // CRITICAL: Resend v2 SDK returns { data, error } on EVERY call — it
    // does NOT throw on API errors (invalid recipient, suppression list,
    // rate limit, 4xx). Without this check we'd silently flip the row to
    // 'sent' with a green badge while the customer never receives the
    // email — defeating the entire point of the email-status column.
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      const e = result.error as { name?: string; message?: string }
      throw new Error(e.message || e.name || 'Resend rejected the message')
    }

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { emailStatus: 'sent', emailError: null, sendingStartedAt: null },
    })
    await audit({
      actor: { system: true },
      action: AuditAction.InvoiceEmailSent,
      targetType: 'invoice',
      targetId: invoiceId,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        actualRecipient: resolvedRecipientEmail,
        recipientSource,
        // Resend returns { id } on success — capture the message id for
        // forensic tracing back to Resend's delivery dashboard.
        resendMessageId: (result as { data?: { id?: string } })?.data?.id ?? null,
        stripeError,
        pdfError,
        pdfAttached: pdfBytes !== null,
      },
    })
    console.log(`[invoice-send] ${invoiceId} sent to ${resolvedRecipientEmail}`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[invoice-send] ${invoiceId} Resend send failed:`, err)
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        emailStatus: 'failed',
        emailError: reason.slice(0, 500),
        // Release the reservation so a manual Resend can retry — see
        // resend endpoint for the gating logic.
        invoiceEmailSentAt: null,
        sendingStartedAt: null,
      },
    }).catch(() => {})
    await audit({
      actor: { system: true },
      action: AuditAction.InvoiceEmailFailed,
      targetType: 'invoice',
      targetId: invoiceId,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        attemptedRecipient: resolvedRecipientEmail,
        recipientSource,
        error: reason.slice(0, 500),
        stripeError,
        pdfError,
      },
    }).catch(() => {})
  }
}

type SplitHalf = Awaited<ReturnType<typeof prisma.invoicePayment.findMany>>[number]

/**
 * 50/50 split send (Ryan, 2026-11-09). Each payer gets the full invoice + PDF,
 * "your share", and a Pay button on THEIR half's own Payment Link (half-sized,
 * metadata.half so the webhook marks only that half). Per-half state lives on
 * InvoicePayment; the invoice's emailStatus is the roll-up the admin list
 * shows ('sent' once every unpaid half has gone out).
 *
 * Link rules mirror the single-invoice path: reuse a half's live link, never
 * mint a second one while its payment is in flight, and only replace a dead
 * link under fresh idempotency keys.
 */
async function sendSplitHalves(opts: {
  invoice: {
    id: string
    invoiceNumber: string
    total: unknown
    publicPdfToken: string | null
    userId: string
    user: { email: string; fullName: string | null; name: string | null; company: string | null }
  }
  halves: SplitHalf[]
  baseUrl: string
  rangeStartIso: string
  rangeEndIso: string
  resend: boolean
  onlyHalf?: 'A' | 'B'
  freshLink?: boolean
}): Promise<void> {
  const { invoice, halves, baseUrl, rangeStartIso, rangeEndIso } = opts
  const targets = halves.filter(
    (h) =>
      h.status === 'pending' &&
      (!opts.onlyHalf || h.half === opts.onlyHalf) &&
      (opts.resend || h.emailStatus !== 'sent'),
  )
  const errors: string[] = []

  let pdfBytes: Uint8Array | null = null
  try {
    const full = await loadInvoiceDetailForPdf(invoice.id)
    if (full) pdfBytes = buildInvoicePdfBytes(full)
  } catch (err) {
    console.error(`[invoice-send] ${invoice.id} split PDF generation failed (sending without attachment):`, err)
  }
  const counts = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    select: { _count: { select: { orders: true, serviceRequests: true, ooaPickupOrders: true, postRentalCharges: true } } },
  })

  // A share can be paid (by card, or marked paid by hand) while this job
  // runs — the list above is a snapshot. Re-check right before touching a
  // share so a paid one never gets a fresh link or a "pay your share" email.
  const stillOwed = async (id: string) => {
    const fresh = await prisma.invoicePayment.findUnique({
      where: { id },
      select: { status: true, invoice: { select: { status: true } } },
    })
    // 'paid' too: a share refunded after the invoice settled is owed again.
    return fresh?.status === 'pending' && fresh.invoice.status !== 'void'
  }

  for (const h of targets) {
    if (!(await stillOwed(h.id))) continue
    const other = halves.find((x) => x.half !== h.half)
    let payUrl: string | null = null
    let skipReason: string | null = null
    let stripeError: string | null = null

    const fresh = !!opts.freshLink && h.half === opts.onlyHalf
    const priorLinkId = !fresh && h.checkoutSessionId?.startsWith('plink_') ? h.checkoutSessionId : null
    if (priorLinkId) {
      try {
        const link = await stripe().paymentLinks.retrieve(priorLinkId)
        if (link.active) payUrl = link.url
        else {
          const inFlight = await paymentLinkPaymentInFlight(priorLinkId)
          if (inFlight) skipReason = paymentInFlightMessage(inFlight)
        }
      } catch (err) {
        console.error(`[invoice-send] ${invoice.id} half ${h.half}: couldn't check the stored link; reusing it:`, err)
        payUrl = h.checkoutUrl
      }
    }
    if (skipReason) {
      errors.push(`${h.payerName}: ${skipReason}`)
      await prisma.invoicePayment
        .update({ where: { id: h.id }, data: { emailStatus: 'failed', emailError: skipReason.slice(0, 500) } })
        .catch(() => {})
      continue
    }
    if (!payUrl) {
      try {
        const link = await createInvoiceCheckoutSession({
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          amountInCents: h.amountCents,
          customerEmail: h.payerEmail,
          description: `Invoice ${invoice.invoiceNumber} (50% share) — ${rangeStartIso.slice(0, 10)} to ${rangeEndIso.slice(0, 10)}`,
          successUrl: `${baseUrl}/invoice-paid?invoice=${invoice.invoiceNumber}`,
          cancelUrl: `${baseUrl}/invoice-cancelled?invoice=${invoice.invoiceNumber}`,
          half: h.half,
          // Fresh keys whenever this share has had a link or an email before
          // (a reopened share has its link cleared but keeps emailSentAt):
          // the original keys would replay the old, used-up link.
          idempotencySuffix:
            fresh || h.checkoutSessionId || h.emailSentAt ? `resend-${Date.now().toString(36)}` : undefined,
        })
        // Save the link only while the share is still unpaid. If it was paid
        // meanwhile, turn the new link straight off and skip this share.
        const saved = await prisma.invoicePayment.updateMany({
          where: { id: h.id, status: 'pending' },
          data: { checkoutSessionId: link.id, checkoutUrl: link.url },
        })
        if (saved.count === 0) {
          await stripe().paymentLinks.update(link.id, { active: false }).catch((e) =>
            console.error(`[invoice-send] ${invoice.id} half ${h.half}: couldn't deactivate unused link ${link.id}:`, e),
          )
          continue
        }
        payUrl = link.url
      } catch (err) {
        stripeError = err instanceof Error ? err.message : String(err)
        console.error(`[invoice-send] ${invoice.id} half ${h.half}: Stripe Payment Link failed (sending without):`, err)
      }
    }
    if (fresh && !payUrl) {
      // A replacement link was the whole point — an email without one would
      // only confuse the party. Leave it failed for the admin to retry.
      const reason = `Couldn't make a new pay link${stripeError ? `: ${stripeError}` : ''}`
      errors.push(`${h.payerName}: ${reason}`)
      await prisma.invoicePayment
        .update({ where: { id: h.id }, data: { emailStatus: 'failed', emailError: reason.slice(0, 500) } })
        .catch(() => {})
      continue
    }

    if (!(await stillOwed(h.id))) continue
    try {
      const result = await sendInvoiceEmail({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: h.payerName,
        customerEmail: h.payerEmail,
        companyName: invoice.user.company,
        rangeStart: rangeStartIso.slice(0, 10),
        rangeEnd: rangeEndIso.slice(0, 10),
        total: Number(invoice.total),
        orderCount: counts._count.orders,
        serviceRequestCount: counts._count.serviceRequests,
        pickupCount: counts._count.ooaPickupOrders,
        rentalCount: counts._count.postRentalCharges,
        pdfBytes,
        pdfUrl: invoice.publicPdfToken
          ? `${baseUrl}/api/invoices/${invoice.id}/pdf?token=${invoice.publicPdfToken}`
          : `${baseUrl}/api/invoices/${invoice.id}/pdf`,
        payUrl,
        recipientUserId: invoice.userId,
        share: { amount: h.amountCents / 100, percent: 50, otherPartyName: other?.payerName ?? 'the other party' },
      })
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        const e = result.error as { name?: string; message?: string }
        throw new Error(e.message || e.name || 'Resend rejected the message')
      }
      await prisma.invoicePayment.update({
        where: { id: h.id },
        data: { emailStatus: 'sent', emailError: null, emailSentAt: new Date() },
      })
      await audit({
        actor: { system: true },
        action: AuditAction.InvoiceEmailSent,
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          half: h.half,
          actualRecipient: h.payerEmail,
          recipientSource: 'split',
          resendMessageId: (result as { data?: { id?: string } })?.data?.id ?? null,
          stripeError,
          pdfAttached: pdfBytes !== null,
        },
      }).catch(() => {})
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      errors.push(`${h.payerName}: ${reason}`)
      await prisma.invoicePayment
        .update({ where: { id: h.id }, data: { emailStatus: 'failed', emailError: reason.slice(0, 500) } })
        .catch(() => {})
      await audit({
        actor: { system: true },
        action: AuditAction.InvoiceEmailFailed,
        targetType: 'invoice',
        targetId: invoice.id,
        metadata: { invoiceNumber: invoice.invoiceNumber, half: h.half, attemptedRecipient: h.payerEmail, error: reason.slice(0, 500), stripeError },
      }).catch(() => {})
    }
  }

  // Roll up: 'sent' once every still-unpaid half has had its email.
  const after = await prisma.invoicePayment.findMany({
    where: { invoiceId: invoice.id },
    select: { status: true, emailStatus: true },
  })
  const outstanding = after.some((h) => h.status === 'pending' && h.emailStatus !== 'sent')
  await prisma.invoice
    .update({
      where: { id: invoice.id },
      data: outstanding
        ? { emailStatus: 'failed', emailError: (errors.join('; ') || 'A share was not sent').slice(0, 500), sendingStartedAt: null }
        : { emailStatus: 'sent', emailError: null, sendingStartedAt: null, invoiceEmailSentAt: new Date() },
    })
    .catch(() => {})
}
