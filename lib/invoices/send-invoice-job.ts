/**
 * Background worker for the invoice email send.
 *
 * The POST /api/admin/invoices route returns immediately after the DB
 * transaction commits, then enqueues this worker via setImmediate. Doing
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
 * Crash-recovery: if the Node process dies between claim and final state
 * write, the row is left in 'sending' with sendingStartedAt set. The
 * startup heal hook in instrumentation.ts marks any row stuck >10min as
 * 'failed' on next boot so admin can manually Resend.
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
import { createInvoiceCheckoutSession } from '@/lib/stripe/server'

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

  // 3. Stripe Payment Link (non-fatal). If this fails the email still goes
  //    out, just without a Pay button — admin can use Regenerate Pay Link
  //    on the invoice page later. Logged for visibility.
  let checkoutUrl: string | null = null
  try {
    const session = await createInvoiceCheckoutSession({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amountInCents: Math.round(Number(invoice.total) * 100),
      customerEmail: invoice.user.email,
      description: `Invoice ${invoice.invoiceNumber} — ${rangeStartIso.slice(0, 10)} to ${rangeEndIso.slice(0, 10)}`,
      successUrl: `${baseUrl}/invoice-paid?invoice=${invoice.invoiceNumber}`,
      cancelUrl: `${baseUrl}/invoice-cancelled?invoice=${invoice.invoiceNumber}`,
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
    const counts = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { _count: { select: { orders: true, serviceRequests: true } } },
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
