/**
 * Admin "Resend invoice email" — single chokepoint for retrying a failed,
 * sent, or skipped invoice email send, optionally to a different recipient.
 *
 * Critical correctness notes (from Round 21 adversarial review):
 *
 * 1. AUTH GATE first. This endpoint accepts an arbitrary recipientEmailOverride
 *    and writes it onto Invoice.recipientEmail — if it were unauthenticated
 *    or non-admin, an attacker could redirect a customer's invoice + working
 *    Stripe Pay link to themselves. Admin-only, explicit.
 *
 * 2. CONDITIONAL UPDATE. Refuses to flip 'sending' rows back to 'queued' —
 *    that would race with an in-flight worker and produce a duplicate send
 *    (worker A re-reads the new recipient + sends; new worker also sends).
 *    Allowed terminal states: failed, sent, skipped. Returns 409 on conflict.
 *
 * 3. PAID/VOID GUARD. If the invoice is already paid or voided, refuse —
 *    no reason to re-email a closed invoice + risks customer confusion.
 *
 * 4. AUDIT InvoiceResent (separate from InvoiceCreated). Forensic queries
 *    for "who created this invoice" must not conflate creates with retries.
 *    Captures the actor's id/email/IP + old vs new recipient.
 */
import { waitUntil } from '@vercel/functions'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { processInvoiceSendJob } from '@/lib/invoices/send-invoice-job'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth — explicit and first.
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: invoiceId } = await params

  const body = await request.json().catch(() => ({}))
  const overrideRaw =
    typeof body?.recipientEmailOverride === 'string' ? body.recipientEmailOverride.trim() : null
  const recipientEmailOverride = overrideRaw || null
  if (recipientEmailOverride && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmailOverride)) {
    return NextResponse.json(
      { error: 'Recipient email is not a valid address.' },
      { status: 400 },
    )
  }

  // 2. Load the invoice — needed for the paid/void guard, audit metadata,
  //    and to know the existing snapshotted recipient.
  const existing = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      userId: true,
      status: true,
      emailStatus: true,
      recipientEmail: true,
      rangeStart: true,
      rangeEnd: true,
      user: { select: { email: true, billingEmail: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  // 3. Paid/void guard.
  if (existing.status === 'paid' || existing.status === 'void') {
    return NextResponse.json(
      { error: `Invoice is already ${existing.status} — no email needed.` },
      { status: 400 },
    )
  }

  // 4. Resolve the recipient for this resend. Explicit override > existing
  //    snapshot > customer's current billingEmail > account email. Snapshotted
  //    onto the row atomically with the requeue so the worker sees the right
  //    target. NEVER re-derive at worker time.
  const newRecipient =
    recipientEmailOverride ||
    existing.recipientEmail ||
    existing.user.billingEmail ||
    existing.user.email
  const recipientSource: 'override' | 'snapshot' | 'billing' | 'account' =
    recipientEmailOverride
      ? 'override'
      : existing.recipientEmail
        ? 'snapshot'
        : existing.user.billingEmail
          ? 'billing'
          : 'account'

  // 5. Conditional requeue. CRITICAL — only resets terminal states. A row in
  //    'queued' or 'sending' is already being handled; we refuse with 409 so
  //    the admin doesn't accidentally race the worker into a double-send.
  //    Same query also clears invoiceEmailSentAt (the legacy single-flight)
  //    + emailError so the worker can start clean.
  //    Exception: a 'queued'/'sending' row untouched for 10+ minutes is a send
  //    that died (the background job runs at most 5 minutes under waitUntil),
  //    and nothing else ever clears it, so it can be resent. (A 'queued' row
  //    that holds the email reservation was emailed by the broker bundle route
  //    before it recorded emailStatus; resending it is the same as resending
  //    a 'sent' one, which the admin can always do.)
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000)
  const claim = await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      status: { notIn: ['paid', 'void'] },
      OR: [
        { emailStatus: { in: ['failed', 'sent', 'skipped'] } },
        { emailStatus: { in: ['queued', 'sending'] }, updatedAt: { lt: staleBefore } },
      ],
    },
    data: {
      emailStatus: 'queued',
      emailError: null,
      invoiceEmailSentAt: null,
      sendingStartedAt: null,
      recipientEmail: newRecipient,
    },
  })
  if (claim.count === 0) {
    return NextResponse.json(
      {
        error:
          existing.emailStatus === 'sending'
            ? 'Invoice is currently sending — wait 30 seconds and try again.'
            : existing.emailStatus === 'queued'
              ? 'Invoice is already queued for sending. If it is still queued in 10 minutes, try again.'
              : 'Invoice is in a state that cannot be resent.',
        code: existing.emailStatus,
      },
      { status: 409 },
    )
  }

  // 6. Audit the resend — separate action from InvoiceCreated.
  await audit({
    actor: { id: user.id, email: user.email, role: user.role },
    action: AuditAction.InvoiceResent,
    targetType: 'invoice',
    targetId: invoiceId,
    metadata: {
      invoiceNumber: existing.invoiceNumber,
      previousRecipient: existing.recipientEmail,
      newRecipient,
      recipientSource,
      recipientEmailOverride,
      previousEmailStatus: existing.emailStatus,
    },
    request,
  })

  // 7. Run after the response (waitUntil, see app/api/admin/invoices/route.ts).
  //    Same idempotent worker as the initial send.
  //    Pass the 4-tier recipientSource through so the worker's outcome
  //    audit event (InvoiceEmailSent/Failed) distinguishes "admin reused
  //    the snapshot on resend" from "no billing email was ever set".
  waitUntil(
    processInvoiceSendJob({
      invoiceId,
      resolvedRecipientEmail: newRecipient,
      recipientSource,
      rangeStartIso: existing.rangeStart.toISOString(),
      rangeEndIso: existing.rangeEnd.toISOString(),
    }).catch((err) => {
      console.error('Background invoice-send resend crashed:', err)
      return prisma.invoice
        .update({
          where: { id: invoiceId },
          data: {
            emailStatus: 'failed',
            emailError: String(err?.message ?? err).slice(0, 500),
            sendingStartedAt: null,
          },
        })
        .catch(() => {})
    })
  )

  return NextResponse.json({
    ok: true,
    email_status: 'queued',
    recipient_email: newRecipient,
  })
}
