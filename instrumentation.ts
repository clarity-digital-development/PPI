/**
 * Next.js instrumentation hook — runs ONCE per server process boot.
 *
 * Two responsibilities, both invoice-related:
 *
 * 1. Heal rows stuck in `emailStatus='sending'` by a Railway deploy or
 *    process restart that killed the background worker mid-job. Without
 *    this they'd show "Sending…" forever in the admin UI and the Resend
 *    endpoint would refuse to retry them (its conditional update only
 *    matches terminal states).
 *
 * 2. Backfill pre-Round-21 invoice rows. The Invoice.emailStatus column
 *    was added with @default(queued), so existing successfully-sent
 *    invoices would all show "Queued" badges forever after the first
 *    deploy. Idempotent — only flips rows that still have the default
 *    AND prior evidence of a real send (invoiceEmailSentAt populated).
 *
 * Next.js 14 calls `register()` automatically. The function MUST be async
 * and guarded so it only runs on the Node.js runtime (not edge / build).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Dynamic import so the Edge bundler doesn't try to pull Prisma in.
  const { prisma } = await import('@/lib/prisma')

  // (1) Heal: anything in 'sending' state for 10+ minutes is almost
  // certainly a victim of a process restart (the worker happy-path runs
  // in 5-15s; even pathological Stripe/Resend slowness rarely exceeds a
  // minute). Flip to 'failed' with a clear error so admin sees it on the
  // worklist and can hit Resend to retry from a clean state.
  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)
    const healed = await prisma.invoice.updateMany({
      where: {
        emailStatus: 'sending',
        sendingStartedAt: { lt: tenMinAgo },
      },
      data: {
        emailStatus: 'failed',
        emailError: 'Server restarted while sending — click Resend to retry.',
        sendingStartedAt: null,
        // Release the legacy reservation flag so the worker can pick it up
        // when Resend is clicked.
        invoiceEmailSentAt: null,
      },
    })
    if (healed.count > 0) {
      console.log(
        `[instrumentation] Healed ${healed.count} invoice(s) stuck in 'sending' state from a prior process.`,
      )
    }
  } catch (err) {
    // Non-fatal — the app should still boot if this query fails. Stuck rows
    // will be cleared on next boot or via manual Resend.
    console.error('[instrumentation] Invoice heal hook failed:', err)
  }

  // (2) Backfill: legacy invoices created before Round 21 have emailStatus
  // defaulted to 'queued'. Any row with invoiceEmailSentAt populated AND
  // status != void definitely had a successful send under the old flow —
  // flip those to 'sent' so the badge column reflects reality. Idempotent:
  // re-runs only ever match rows still on the 'queued' default.
  try {
    const backfilled = await prisma.invoice.updateMany({
      where: {
        emailStatus: 'queued',
        invoiceEmailSentAt: { not: null },
        status: { not: 'void' },
      },
      data: { emailStatus: 'sent' },
    })
    if (backfilled.count > 0) {
      console.log(
        `[instrumentation] Backfilled emailStatus='sent' on ${backfilled.count} historically-emailed invoice(s).`,
      )
    }
  } catch (err) {
    console.error('[instrumentation] Invoice backfill hook failed:', err)
  }

  // (3) Snapshot recipientEmail for legacy rows. Safe fallback to user.email
  // (NOT billingEmail — that may have been added after the original send
  // and would lie about who got the invoice). Idempotent: only fills rows
  // where the column is still NULL.
  try {
    const legacy = await prisma.invoice.findMany({
      where: { recipientEmail: null },
      select: { id: true, user: { select: { email: true } } },
      take: 500,
    })
    let snapshotted = 0
    for (const inv of legacy) {
      if (!inv.user?.email) continue
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { recipientEmail: inv.user.email },
      })
      snapshotted++
    }
    if (snapshotted > 0) {
      console.log(
        `[instrumentation] Snapshotted recipientEmail on ${snapshotted} legacy invoice(s).`,
      )
    }
  } catch (err) {
    console.error('[instrumentation] Invoice recipient snapshot hook failed:', err)
  }
}
