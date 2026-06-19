'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { FileText, Send, Loader2, RefreshCw, Link2, RotateCw, AlertTriangle } from 'lucide-react'
import { Card, CardContent, Button, Input, Select, Badge } from '@/components/ui'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Customer {
  id: string
  full_name: string | null
  email: string
  company: string | null
  // Billing-contact email — if set, the default recipient for bundled
  // invoices for this customer. UI pre-fills the "Send to" input with
  // this when it's non-null, else falls back to email.
  billing_email: string | null
}

interface PreviewOrder {
  id: string
  order_number: string
  created_at: string
  property: string
  total: number
  placed_for_agent_name: string | null
}

interface PreviewServiceRequest {
  id: string
  type: string
  description: string | null
  completed_at: string | null
  property: string
  amount: number
}

interface PreviewResponse {
  orders: PreviewOrder[]
  service_requests: PreviewServiceRequest[]
  subtotal: number
  total: number
  count: number
  order_count: number
  service_request_count: number
}

type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped'

interface InvoiceListRow {
  id: string
  invoice_number: string
  customer_id: string
  customer_name: string
  customer_company: string | null
  customer_email: string
  range_start: string
  range_end: string
  subtotal: number
  total: number
  status: 'sent' | 'paid' | 'void'
  sent_at: string | null
  paid_at: string | null
  order_count: number
  // service_request_count is now also returned by the bundler list endpoint
  // (Invoice._count.serviceRequests). Optional for back-compat with cached
  // responses that don't include it yet.
  service_request_count?: number
  created_at: string
  // Background email-worker state (Round 21). Optional for back-compat with
  // any in-flight responses that haven't picked up the new fields yet.
  email_status?: EmailStatus
  recipient_email?: string | null
  email_error?: string | null
  sending_started_at?: string | null
}

const EMAIL_STATUS_LABEL: Record<
  EmailStatus,
  { label: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral'; spinner: boolean }
> = {
  queued: { label: 'Queued', variant: 'warning', spinner: true },
  sending: { label: 'Sending', variant: 'warning', spinner: true },
  sent: { label: 'Sent', variant: 'success', spinner: false },
  failed: { label: 'Failed', variant: 'error', spinner: false },
  skipped: { label: 'Opted out', variant: 'neutral', spinner: false },
}

function currentWeekRange(): { start: string; end: string } {
  const today = new Date()
  const day = today.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(monday), end: fmt(sunday) }
}

const STATUS_LABEL: Record<InvoiceListRow['status'], { label: string; variant: 'info' | 'success' | 'warning' | 'neutral' }> = {
  sent: { label: 'Sent', variant: 'info' },
  paid: { label: 'Paid', variant: 'success' },
  void: { label: 'Void', variant: 'neutral' },
}

export default function AdminInvoicesPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customersLoading, setCustomersLoading] = useState(true)

  const initial = currentWeekRange()
  const [customerId, setCustomerId] = useState('')
  const [startDate, setStartDate] = useState(initial.start)
  const [endDate, setEndDate] = useState(initial.end)

  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [invoices, setInvoices] = useState<InvoiceListRow[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  // Per-invoice regen-in-flight state so two clicks can't double-fire and the
  // button shows a spinner per row instead of disabling the whole table.
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({})
  const [regenError, setRegenError] = useState<string | null>(null)
  const [regenSuccess, setRegenSuccess] = useState<string | null>(null)

  // Round 21: "Send to" override for the bundle dialog. Pre-filled with the
  // selected customer's billing-contact (or account) email; tracked via
  // `isOverridden` so we can tell whether the admin actually changed it
  // (and only then mark the send as a recipient override in the audit log).
  const [recipientInput, setRecipientInput] = useState('')
  const [recipientOverridden, setRecipientOverridden] = useState(false)
  // Stale-data guard: when the customer changes, we want to reset recipient
  // to the new default — store the default separately so we can detect a
  // manual edit vs a system update.
  const [recipientDefault, setRecipientDefault] = useState<string>('')
  const [recipientDefaultSource, setRecipientDefaultSource] = useState<'billing' | 'account' | null>(null)

  // Round 21: per-invoice resend state + active polling intervals so we can
  // clean up on unmount and on filter changes.
  const [resending, setResending] = useState<Record<string, boolean>>({})
  const [resendError, setResendError] = useState<string | null>(null)
  const [resendSuccess, setResendSuccess] = useState<string | null>(null)
  const pollTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    async function loadCustomers() {
      try {
        const res = await fetch('/api/admin/customers?invoiceBillingOnly=1&limit=500')
        if (res.ok) {
          const data = await res.json()
          setCustomers(data.customers || [])
        }
      } catch (err) {
        console.error('Failed to load invoice-billing customers:', err)
      } finally {
        setCustomersLoading(false)
      }
    }
    loadCustomers()
    refreshInvoices()
  }, [])

  async function regeneratePaymentLink(invoiceId: string) {
    if (regenerating[invoiceId]) return
    if (!confirm('Regenerate the Stripe Payment Link for this invoice and re-send the email to the customer?')) return
    setRegenerating((prev) => ({ ...prev, [invoiceId]: true }))
    setRegenError(null)
    setRegenSuccess(null)
    try {
      const res = await fetch(`/api/admin/invoices/${invoiceId}/regenerate-payment-link`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Regenerate failed')
      setRegenSuccess(
        data.email_resent
          ? `New Payment Link sent to ${data.sent_to_email}.`
          : `New Payment Link created but the email re-send failed — copy the URL from the Stripe dashboard.`,
      )
      refreshInvoices()
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Regenerate failed')
    } finally {
      setRegenerating((prev) => ({ ...prev, [invoiceId]: false }))
    }
  }

  async function refreshInvoices(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setInvoicesLoading(true)
    try {
      const res = await fetch('/api/admin/invoices')
      if (res.ok) {
        const data = await res.json()
        setInvoices(data.invoices || [])
      }
    } catch (err) {
      console.error('Failed to load invoices:', err)
    } finally {
      if (!opts.silent) setInvoicesLoading(false)
    }
  }

  async function runPreview() {
    if (!customerId || !startDate || !endDate) return
    setPreviewing(true)
    setError(null)
    setSuccess(null)
    setPreview(null)
    try {
      const params = new URLSearchParams({ mode: 'preview', customerId, startDate, endDate })
      const res = await fetch(`/api/admin/invoices?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Preview failed')
      }
      setPreview(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  // Round 21: cascading-interval poll while any invoice is in transit.
  // Stops when no invoice is queued/sending. Spaced [2, 5, 10, 20, 30]s so
  // the UI catches both fast-path sends (5-10s) and slow ones (Stripe/Resend
  // dawdle) without DOSing the API. Uses silent refresh so the table doesn't
  // flash a full-page loading spinner between updates.
  function startTransitPolling() {
    pollTimersRef.current.forEach((t) => clearTimeout(t))
    pollTimersRef.current = []
    for (const delay of [2000, 5000, 10000, 20000, 30000]) {
      pollTimersRef.current.push(
        setTimeout(async () => {
          await refreshInvoices({ silent: true })
        }, delay),
      )
    }
  }
  useEffect(() => {
    return () => { pollTimersRef.current.forEach((t) => clearTimeout(t)) }
  }, [])

  async function sendInvoice() {
    if (!customerId || !startDate || !endDate) return
    setSending(true)
    setError(null)
    setSuccess(null)
    try {
      // Only send recipientEmailOverride when the admin actually typed a
      // different address than the default — otherwise the audit log would
      // wrongly mark a same-as-default send as an "override".
      const trimmed = recipientInput.trim()
      const overridePayload =
        recipientOverridden && trimmed && trimmed !== recipientDefault.trim() ? trimmed : null
      const res = await fetch('/api/admin/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          startDate,
          endDate,
          recipientEmailOverride: overridePayload,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Send failed')
      {
        const oc = data.invoice.order_count ?? 0
        const sc = data.invoice.service_request_count ?? 0
        const parts: string[] = []
        if (oc > 0) parts.push(`${oc} order${oc === 1 ? '' : 's'}`)
        if (sc > 0) parts.push(`${sc} service trip${sc === 1 ? '' : 's'}`)
        const bundleLine = parts.join(' + ') || 'this invoice'
        // Worded as "queued for" — Round 21 moved the actual send to a
        // background worker so the response returns in <500ms. The list
        // below auto-refreshes via startTransitPolling() so the badge
        // transitions Queued → Sending → Sent visibly.
        setSuccess(
          `Invoice ${data.invoice.invoice_number} queued for ${data.invoice.recipient_email} — ${bundleLine}, ${formatCurrency(data.invoice.total)}. Usually takes 5-10 seconds; you can navigate away.`,
        )
      }
      setPreview(null)
      // Reset the override so the next bundle starts fresh.
      setRecipientOverridden(false)
      refreshInvoices()
      startTransitPolling()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function resendInvoiceEmail(invoiceId: string, currentRecipient: string | null) {
    if (resending[invoiceId]) return
    const newRecipient = window.prompt(
      'Resend this invoice email — to what address? (Leave blank to use the existing recipient.)',
      currentRecipient ?? '',
    )
    if (newRecipient === null) return // cancelled
    setResending((prev) => ({ ...prev, [invoiceId]: true }))
    setResendError(null)
    setResendSuccess(null)
    try {
      const res = await fetch(`/api/admin/invoices/${invoiceId}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmailOverride: newRecipient.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Resend failed')
      setResendSuccess(`Queued resend to ${data.recipient_email}. Status updates in a few seconds.`)
      refreshInvoices()
      startTransitPolling()
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Resend failed')
    } finally {
      setResending((prev) => ({ ...prev, [invoiceId]: false }))
    }
  }

  const customerOptions = useMemo(
    () => [
      { value: '', label: customersLoading ? 'Loading customers…' : 'Select an invoice-billing customer…' },
      ...customers.map((c) => ({
        value: c.id,
        label: `${c.full_name || c.email}${c.company ? ` (${c.company})` : ''}`,
      })),
    ],
    [customers, customersLoading],
  )

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-7 h-7 text-pink-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500">
            Bundle pending-invoice orders for invoice-billing customers and send them a single Pay link.
          </p>
        </div>
      </div>

      {/* Builder */}
      <Card className="mb-8">
        <CardContent className="p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">New invoice</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div className="lg:col-span-2">
              <Select
                label="Customer"
                value={customerId}
                onChange={(e) => {
                  const next = e.target.value
                  setCustomerId(next)
                  setPreview(null)
                  // Resolve the new default recipient + reset the "Send to"
                  // field so the override doesn't accidentally carry across
                  // customers. recipientOverridden tracks whether the admin
                  // has actually edited the field (so audit log only marks
                  // override when the value truly differs from the default).
                  const c = customers.find((x) => x.id === next)
                  const def = c ? c.billing_email || c.email : ''
                  setRecipientDefault(def)
                  setRecipientDefaultSource(c ? (c.billing_email ? 'billing' : 'account') : null)
                  setRecipientInput(def)
                  setRecipientOverridden(false)
                }}
                placeholder=""
                options={customerOptions}
              />
              {customers.length === 0 && !customersLoading && (
                <p className="mt-1 text-xs text-amber-700">
                  No customers have invoice billing enabled. Flip the toggle on a customer&apos;s <strong>/admin/customers/[id]</strong> page first.
                </p>
              )}
            </div>
            <Input
              type="date"
              label="Start date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPreview(null) }}
              max={endDate || undefined}
            />
            <Input
              type="date"
              label="End date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPreview(null) }}
              min={startDate || undefined}
            />
          </div>
          {/* Round 21: "Send to" override row. Pre-fills with the customer's
              billing-contact (or account) email; admin can type a one-off
              address (e.g., the customer's accountant) without permanently
              changing the customer's billing contact. */}
          {customerId && (
            <div className="mb-3">
              <Input
                type="email"
                label="Send to"
                value={recipientInput}
                onChange={(e) => {
                  setRecipientInput(e.target.value)
                  setRecipientOverridden(e.target.value.trim() !== recipientDefault.trim())
                }}
                disabled={!customerId}
              />
              <div className="mt-1 flex items-center gap-2 text-xs">
                {recipientOverridden ? (
                  <>
                    <span className="text-amber-700 font-medium">
                      One-off override — won&apos;t change the customer&apos;s billing contact on file.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRecipientInput(recipientDefault)
                        setRecipientOverridden(false)
                      }}
                      className="text-pink-600 hover:text-pink-700 underline"
                    >
                      Reset to default
                    </button>
                  </>
                ) : (
                  <span className="text-gray-500">
                    {recipientDefaultSource === 'billing'
                      ? 'Using customer’s billing contact (set on /admin/customers).'
                      : 'No billing contact set — using customer’s account email. Edit above to send to a different address.'}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={runPreview}
              disabled={!customerId || previewing || sending}
            >
              {previewing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Previewing…</> : 'Preview orders'}
            </Button>
            <Button
              onClick={sendInvoice}
              disabled={!customerId || sending || (preview ? preview.count === 0 : false)}
            >
              {sending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : <><Send className="w-4 h-4 mr-2" /> Bundle &amp; send invoice</>}
            </Button>
          </div>
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}
          {success && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">{success}</div>
          )}
        </CardContent>
      </Card>

      {/* Preview */}
      {preview && (
        <Card className="mb-8">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Preview</h2>
              <div className="text-right">
                <p className="text-xs text-gray-500">
                  {preview.order_count ?? preview.orders.length} order{(preview.order_count ?? preview.orders.length) === 1 ? '' : 's'}
                  {(preview.service_request_count ?? preview.service_requests?.length ?? 0) > 0 && (
                    <>{' + '}{preview.service_request_count ?? preview.service_requests?.length ?? 0} service trip{(preview.service_request_count ?? preview.service_requests?.length ?? 0) === 1 ? '' : 's'}</>
                  )}
                </p>
                <p className="text-lg font-bold text-pink-600">{formatCurrency(preview.total)}</p>
              </div>
            </div>
            {preview.orders.length === 0 && (preview.service_requests?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No pending-invoice orders or service trips in this range.</p>
            ) : (
              <div className="space-y-4">
                {preview.orders.length > 0 && (
                  <div className="overflow-x-auto">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Orders</p>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Order #</th>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Property</th>
                          <th className="px-3 py-2 text-left">Agent</th>
                          <th className="px-3 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.orders.map((o) => (
                          <tr key={o.id}>
                            <td className="px-3 py-2 font-medium text-gray-900">{o.order_number}</td>
                            <td className="px-3 py-2 text-gray-600">{formatDate(o.created_at)}</td>
                            <td className="px-3 py-2 text-gray-600">{o.property}</td>
                            <td className="px-3 py-2 text-gray-600">{o.placed_for_agent_name || '—'}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(o.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {(preview.service_requests?.length ?? 0) > 0 && (
                  <div className="overflow-x-auto">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Service trips</p>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">SR #</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">Completed</th>
                          <th className="px-3 py-2 text-left">Property</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.service_requests.map((sr) => (
                          <tr key={sr.id}>
                            <td className="px-3 py-2 font-mono text-xs text-gray-600">SR {sr.id.slice(-6).toUpperCase()}</td>
                            <td className="px-3 py-2 text-gray-700 capitalize">{sr.type}{sr.description ? `: ${sr.description}` : ''}</td>
                            <td className="px-3 py-2 text-gray-600">{sr.completed_at ? formatDate(sr.completed_at) : '—'}</td>
                            <td className="px-3 py-2 text-gray-600">{sr.property}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(sr.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing invoices */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Recent invoices</h2>
            <button
              type="button"
              onClick={() => refreshInvoices()}
              className="text-xs text-gray-500 hover:text-pink-600 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          {regenError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{regenError}</div>
          )}
          {regenSuccess && (
            <div className="mb-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">{regenSuccess}</div>
          )}
          {resendError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{resendError}</div>
          )}
          {resendSuccess && (
            <div className="mb-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">{resendSuccess}</div>
          )}
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-pink-600" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Invoice #</th>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-left">Range</th>
                    <th className="px-3 py-2 text-center">Items</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-center">Email</th>
                    <th className="px-3 py-2 text-left">Sent</th>
                    <th className="px-3 py-2 text-left">Paid</th>
                    <th className="px-3 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.map((inv) => {
                    const cfg = STATUS_LABEL[inv.status]
                    const canRegen = inv.status === 'sent'
                    const isRegen = !!regenerating[inv.id]
                    return (
                      <tr key={inv.id}>
                        <td className="px-3 py-2">
                          <Link
                            href={`/dashboard/invoices/${inv.id}`}
                            className="font-medium text-pink-600 hover:text-pink-700"
                            target="_blank"
                          >
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-gray-900">{inv.customer_name}</div>
                          {inv.customer_company && (
                            <div className="text-xs text-gray-500">{inv.customer_company}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {inv.range_start.slice(0, 10)} → {inv.range_end.slice(0, 10)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-gray-900">{inv.order_count}</span>
                          <span className="text-xs text-gray-500"> orders</span>
                          {(inv.service_request_count ?? 0) > 0 && (
                            <>
                              {' + '}
                              <span className="text-gray-900">{inv.service_request_count}</span>
                              <span className="text-xs text-gray-500"> SR{(inv.service_request_count ?? 0) === 1 ? '' : 's'}</span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(inv.total)}</td>
                        <td className="px-3 py-2 text-center"><Badge variant={cfg.variant}>{cfg.label}</Badge></td>
                        <td className="px-3 py-2 text-center">
                          {(() => {
                            const ec = inv.email_status ? EMAIL_STATUS_LABEL[inv.email_status] : null
                            if (!ec) return <span className="text-xs text-gray-400">—</span>
                            return (
                              <div className="flex flex-col items-center gap-1">
                                <Badge variant={ec.variant}>
                                  {ec.spinner && <Loader2 className="w-3 h-3 mr-1 inline animate-spin" />}
                                  {ec.label}
                                </Badge>
                                {inv.recipient_email && (
                                  <span
                                    className="text-[10px] text-gray-500 truncate max-w-[160px]"
                                    title={inv.recipient_email}
                                  >
                                    to: {inv.recipient_email}
                                  </span>
                                )}
                                {inv.email_status === 'failed' && inv.email_error && (
                                  <span
                                    className="text-[10px] text-red-600 max-w-[200px] mt-0.5"
                                    title={inv.email_error}
                                  >
                                    <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />
                                    {inv.email_error.length > 60 ? inv.email_error.slice(0, 57) + '…' : inv.email_error}
                                  </span>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{inv.sent_at ? formatDate(inv.sent_at) : '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{inv.paid_at ? formatDate(inv.paid_at) : '—'}</td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex flex-col items-center gap-1">
                            {/* Resend appears for failed sends (recovery) AND for
                                already-sent sends (admin may want to forward to a
                                different address — e.g., customer's accountant
                                didn't get the first one). Hidden while currently
                                queued/sending — the resend endpoint returns 409
                                for those states anyway. */}
                            {(inv.email_status === 'failed' ||
                              inv.email_status === 'sent' ||
                              inv.email_status === 'skipped') &&
                              inv.status !== 'paid' &&
                              inv.status !== 'void' && (
                                <button
                                  type="button"
                                  onClick={() => resendInvoiceEmail(inv.id, inv.recipient_email ?? null)}
                                  disabled={!!resending[inv.id]}
                                  className="inline-flex items-center gap-1 text-xs text-pink-600 hover:text-pink-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                                  title={
                                    inv.email_status === 'failed'
                                      ? 'Retry sending this invoice (optionally to a different address)'
                                      : 'Resend this invoice (optionally to a different address)'
                                  }
                                >
                                  {resending[inv.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                                  {resending[inv.id] ? 'Resending…' : 'Resend'}
                                </button>
                              )}
                            {canRegen ? (
                              <button
                                type="button"
                                onClick={() => regeneratePaymentLink(inv.id)}
                                disabled={isRegen}
                                className="inline-flex items-center gap-1 text-xs text-pink-600 hover:text-pink-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                                title="Regenerate the Stripe Payment Link and re-send the invoice email"
                              >
                                {isRegen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                                {isRegen ? 'Regenerating…' : 'Regenerate Pay link'}
                              </button>
                            ) : null}
                            {!canRegen && inv.email_status !== 'failed' && inv.email_status !== 'sent' && inv.email_status !== 'skipped' && (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
