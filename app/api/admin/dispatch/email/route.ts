// Installer dispatch: email a price-free jobs list to the install crew.
//
//   POST { orderIds?: string[], serviceRequestIds?: string[], recipients: string[],
//          note?: string, dryRun?: boolean }
//
// dryRun renders the exact email (same loader, same template) and returns it
// without sending, so the admin preview is byte-for-byte what goes out.
// Admin-only: middleware already rejects non-admin JWTs for /api/admin/*, and
// the DB-backed getCurrentUser() check below is the second layer. team_admin
// never passes — the email carries gate codes and lockbox codes.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { loadDispatchJobs, MAX_DISPATCH_JOBS } from '@/lib/dispatch/load-jobs'
import { renderInstallerDispatchEmail, sendInstallerDispatchEmail } from '@/lib/email'
import type { DispatchJob } from '@/lib/dispatch/types'
import { redactMoney } from '@/lib/dispatch/money'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_RECIPIENTS = 10
const MAX_NOTE = 2000

function cleanIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return Array.from(new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 64)))
}

function summarize(j: DispatchJob) {
  return j.kind === 'order'
    ? { kind: j.kind, id: j.id, label: `${j.address.line1}, ${j.address.city}`, date: j.scheduledDate, expedited: j.isExpedited, status: j.status }
    : { kind: j.kind, id: j.id, label: j.address.onFile ? `${j.address.line1}, ${j.address.city}` : 'address not on file', date: j.requestedDate, expedited: false, status: j.status, type: j.type }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const orderIds = cleanIds(body?.orderIds)
  const serviceRequestIds = cleanIds(body?.serviceRequestIds)
  const dryRun = body?.dryRun === true
  // The admin's own note gets the same treatment as customer text — a "80$"
  // in Ryan's note must not reach the crew either.
  const note = redactMoney(typeof body?.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '') ?? ''

  const total = orderIds.length + serviceRequestIds.length
  if (total === 0) return NextResponse.json({ error: 'No jobs selected' }, { status: 400 })
  if (total > MAX_DISPATCH_JOBS) {
    return NextResponse.json({ error: `Too many jobs in one email (max ${MAX_DISPATCH_JOBS})` }, { status: 400 })
  }

  const rawRecipients: string[] = Array.isArray(body?.recipients)
    ? body.recipients.filter((x: unknown): x is string => typeof x === 'string')
    : []
  const recipients = Array.from(new Set(rawRecipients.map((r) => r.trim().toLowerCase()).filter(Boolean)))
  const invalid = recipients.filter((r) => !EMAIL_RE.test(r))
  if (invalid.length) {
    return NextResponse.json({ error: `Not a valid email address: ${invalid.join(', ')}` }, { status: 400 })
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS})` }, { status: 400 })
  }
  // A preview may have no recipients yet; a real send needs at least one.
  if (!dryRun && recipients.length === 0) {
    return NextResponse.json({ error: 'Add at least one installer email address' }, { status: 400 })
  }

  const { jobs, skipped } = await loadDispatchJobs({ orderIds, serviceRequestIds })
  if (jobs.length === 0) {
    return NextResponse.json({ error: 'Every selected job is cancelled or no longer exists', skipped }, { status: 400 })
  }

  const props = {
    recipients,
    jobs,
    note: note || null,
    sentByName: user.fullName || user.email,
    generatedAt: new Date(),
  }

  let rendered: ReturnType<typeof renderInstallerDispatchEmail>
  try {
    rendered = renderInstallerDispatchEmail(props)
  } catch (err) {
    // The money backstop fired — something carried a dollar amount past the
    // DTO. Refuse loudly; never send.
    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.DispatchEmailFailed,
      targetType: 'dispatch',
      targetId: null,
      metadata: { reason: 'money_guard', orderIds, serviceRequestIds, recipients, error: err instanceof Error ? err.message : String(err) },
      request,
    })
    return NextResponse.json(
      { error: 'Refused to send: the email body contained a dollar amount. Nothing was sent.' },
      { status: 500 }
    )
  }

  if (dryRun) {
    return NextResponse.json({
      preview: {
        subject: rendered.subject,
        text: rendered.text,
        to: recipients,
        attachmentNames: rendered.attachments.map((a) => a.filename),
      },
      jobs: jobs.map(summarize),
      skipped,
    })
  }

  let resendId: string | null = null
  try {
    const sent = await sendInstallerDispatchEmail(props)
    resendId = sent.id
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email send failed'
    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.DispatchEmailFailed,
      targetType: 'dispatch',
      targetId: null,
      metadata: { reason: 'send_failed', orderIds, serviceRequestIds, recipients, error: message },
      request,
    })
    return NextResponse.json({ error: `Could not send: ${message}` }, { status: 502 })
  }

  const orderNumbers = jobs.filter((j): j is Extract<DispatchJob, { kind: 'order' }> => j.kind === 'order').map((j) => j.orderNumber)
  const actor = { id: user.id, email: user.email, role: user.role }
  await Promise.all([
    audit({
      actor,
      action: AuditAction.DispatchEmailSent,
      targetType: 'dispatch',
      targetId: resendId,
      metadata: { recipients, orderIds, orderNumbers, serviceRequestIds, jobCount: jobs.length, skipped, subject: rendered.subject, resendId, noteLength: note.length },
      request,
    }),
    ...jobs.map((j) =>
      audit({
        actor,
        action: AuditAction.DispatchEmailSent,
        targetType: j.kind,
        targetId: j.id,
        metadata: { recipients, resendId },
        request,
      })
    ),
  ])

  return NextResponse.json({ ok: true, sentTo: recipients, jobCount: jobs.length, skipped, resendId })
}
