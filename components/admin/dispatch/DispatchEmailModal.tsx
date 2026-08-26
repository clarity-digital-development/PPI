'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, Paperclip } from 'lucide-react'
import { Modal, Button, Input } from '@/components/ui'
import { redactMoney } from '@/lib/dispatch/money'

interface DispatchEmailModalProps {
  isOpen: boolean
  onClose: () => void
  orderIds: string[]
  serviceRequestIds: string[]
  /** Called after a successful send (selection cleared by the caller). */
  onSent: () => void
}

interface PreviewJob {
  kind: 'order' | 'service_request'
  id: string
  label: string
  date: string | null
  expedited: boolean
  status: string
  type?: string
}
interface Skipped { kind: string; id: string; label: string; reason: 'cancelled' | 'not_found' }
interface Preview {
  subject: string
  text: string
  to: string[]
  attachmentNames: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Remembered recipients live in this browser only — deliberately not mined
// back out of the audit log (which swallows its own failures).
const RECIPIENTS_KEY = 'admin-dispatch-recipients-v1'

function readRecipients(): { lastUsed: string[]; recent: string[] } {
  try {
    const raw = window.localStorage.getItem(RECIPIENTS_KEY)
    if (!raw) return { lastUsed: [], recent: [] }
    const p = JSON.parse(raw) as { lastUsed?: unknown; recent?: unknown }
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return { lastUsed: arr(p.lastUsed), recent: arr(p.recent) }
  } catch {
    return { lastUsed: [], recent: [] }
  }
}

function writeRecipients(lastUsed: string[], recent: string[]) {
  try {
    window.localStorage.setItem(RECIPIENTS_KEY, JSON.stringify({ lastUsed, recent: recent.slice(0, 10) }))
  } catch {
    /* ignore */
  }
}

function parseRecipients(text: string): { valid: string[]; invalid: string[] } {
  const all = Array.from(new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)))
  return { valid: all.filter((e) => EMAIL_RE.test(e)), invalid: all.filter((e) => !EMAIL_RE.test(e)) }
}

function dayLabel(d: string | null): string {
  if (!d) return 'Next available'
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Splice the note into the preview exactly where renderInstallerDispatchEmail
// puts it (right after the heading line) so the preview stays byte-for-byte
// the email — the dryRun is rendered before the note is typed.
function withNote(text: string, note: string): string {
  if (!note) return text
  const nl = text.indexOf('\n')
  const head = nl === -1 ? text : text.slice(0, nl)
  const rest = nl === -1 ? '' : text.slice(nl + 1)
  return `${head}\n\n----\n${note}\n----\n${rest}`
}

const keepOpen = () => {
  /* mid-send: backdrop / X do nothing */
}

export function DispatchEmailModal({ isOpen, onClose, orderIds, serviceRequestIds, onSent }: DispatchEmailModalProps) {
  const [recipientsText, setRecipientsText] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [jobs, setJobs] = useState<PreviewJob[]>([])
  const [skipped, setSkipped] = useState<Skipped[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ to: string[]; jobCount: number } | null>(null)
  // Sending gate codes + lockbox codes to an address we've never used gets an
  // explicit second click.
  const [confirmNew, setConfirmNew] = useState<string[] | null>(null)

  const { valid: recipients, invalid } = parseRecipients(recipientsText)

  // Prefill from the last send + render the preview once on open. The preview
  // is the real render (dryRun runs the exact loader + template), so what the
  // admin reads is byte-for-byte what the crew gets.
  useEffect(() => {
    if (!isOpen) return
    const saved = readRecipients()
    setRecent(saved.recent)
    setRecipientsText(saved.lastUsed.join(', '))
    setNote('')
    setSent(null)
    setSendError(null)
    setConfirmNew(null)
    setPreview(null)
    setPreviewError(null)
    setLoadingPreview(true)
    // Close-then-reopen with a different selection must not let the first
    // (slower, photo-laden) response overwrite the second one's preview.
    let cancelled = false
    fetch('/api/admin/dispatch/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds, serviceRequestIds, recipients: saved.lastUsed, dryRun: true }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not build the preview')
        if (cancelled) return
        setPreview(data.preview)
        setJobs(data.jobs ?? [])
        setSkipped(data.skipped ?? [])
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : 'Could not build the preview')
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false)
      })
    return () => {
      cancelled = true
    }
    // orderIds/serviceRequestIds are stable for the life of an open modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  function addRecent(email: string) {
    if (recipients.includes(email)) return
    setRecipientsText((t) => (t.trim() ? `${t.trim().replace(/[,;\s]+$/, '')}, ${email}` : email))
  }

  async function doSend() {
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/admin/dispatch/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds, serviceRequestIds, recipients, note: note || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Send failed')
      const merged = Array.from(new Set([...recipients, ...recent]))
      writeRecipients(recipients, merged)
      setRecent(merged.slice(0, 10))
      setSent({ to: data.sentTo ?? recipients, jobCount: data.jobCount ?? jobs.length })
      onSent()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
      setConfirmNew(null)
    }
  }

  function handleSendClick() {
    const unknown = recipients.filter((r) => !recent.includes(r))
    if (unknown.length && !confirmNew) {
      setConfirmNew(unknown)
      return
    }
    void doSend()
  }

  const canSend = recipients.length > 0 && invalid.length === 0 && !sending && !loadingPreview && !previewError && !sent
  // Same redaction the server applies to the note, so the preview shows the
  // crew's copy and the admin sees the marker before sending.
  const cleanNote = redactMoney(note.trim()) ?? ''
  const noteWasRedacted = cleanNote !== note.trim()

  return (
    <Modal isOpen={isOpen} onClose={sending ? keepOpen : onClose} title="Email installers" className="max-w-2xl w-full mx-4">
      {sent ? (
        <div className="py-6 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle className="w-7 h-7 text-green-600" />
          </div>
          <p className="font-semibold text-gray-900">Sent to {sent.to.join(', ')}</p>
          <p className="text-sm text-gray-600 mt-1">{sent.jobCount} job{sent.jobCount === 1 ? '' : 's'} on the way to the crew.</p>
          <Button className="mt-5" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Input
              label="To (installer email addresses)"
              value={recipientsText}
              onChange={(e) => { setRecipientsText(e.target.value); setConfirmNew(null) }}
              placeholder="crew@example.com, second@example.com"
              error={invalid.length ? `Not a valid address: ${invalid.join(', ')}` : undefined}
            />
            {recent.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {recent.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => addRecent(e)}
                    disabled={recipients.includes(e)}
                    className="text-xs px-2.5 py-1 rounded-full border border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100 disabled:opacity-40 disabled:cursor-default"
                  >
                    + {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note to installers (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="e.g. Start with the expedited one — agent is meeting you at 9."
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none resize-none"
            />
            {noteWasRedacted && (
              <p className="text-xs text-amber-700 mt-1">Dollar amounts are replaced with “[amount removed]” before sending — see the preview below.</p>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-1">What will be sent</p>
            {loadingPreview ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
                <Loader2 className="w-4 h-4 animate-spin" /> Building the email…
              </div>
            ) : previewError ? (
              <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {previewError}
              </div>
            ) : preview ? (
              <div className="space-y-2">
                <ul className="text-sm space-y-1">
                  {jobs.map((j) => (
                    <li key={`${j.kind}:${j.id}`} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-pink-400 flex-shrink-0" />
                      <span className="text-gray-900">{j.label}</span>
                      <span className="text-gray-500">· {dayLabel(j.date)}</span>
                      {j.type && <span className="text-xs text-pink-700 bg-pink-50 px-1.5 rounded">{j.type}</span>}
                      {j.expedited && <span className="text-xs text-amber-700">⚡ expedited</span>}
                      {j.status === 'completed' && <span className="text-xs text-gray-500">(already completed)</span>}
                    </li>
                  ))}
                  {skipped.map((s) => (
                    <li key={`${s.kind}:${s.id}`} className="flex items-center gap-2 text-gray-400">
                      <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                      <span className="line-through">{s.label}</span>
                      <span className="text-xs">will be skipped — {s.reason === 'cancelled' ? 'cancelled' : 'no longer exists'}</span>
                    </li>
                  ))}
                </ul>
                {preview.attachmentNames.length > 0 && (
                  <p className="text-xs text-gray-600 flex items-center gap-1">
                    <Paperclip className="w-3 h-3" /> {preview.attachmentNames.length} photo{preview.attachmentNames.length === 1 ? '' : 's'} attached
                  </p>
                )}
                <p className="text-xs font-medium text-gray-600 mt-2">Subject: {preview.subject}</p>
                <pre className="whitespace-pre-wrap text-xs text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-72 overflow-y-auto font-mono">
                  {withNote(preview.text, cleanNote)}
                </pre>
              </div>
            ) : null}
          </div>

          {confirmNew && (
            <div className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">
              <p className="font-medium">You haven&apos;t sent to {confirmNew.join(', ')} before.</p>
              <p className="mt-1">This email includes gate codes and lockbox codes. Send anyway?</p>
            </div>
          )}

          {sendError && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {sendError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
            <Button onClick={handleSendClick} disabled={!canSend}>
              {sending ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>) : confirmNew ? 'Yes, send to new address' : 'Send'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
