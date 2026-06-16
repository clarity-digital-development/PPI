'use client'

import { useEffect, useState } from 'react'
import { Header, OrderHistoryTable } from '@/components/dashboard'
import type { OrderData } from '@/components/dashboard/order-history-table'
import { Input, Select, Button, Card, CardContent } from '@/components/ui'
import { Loader2, FileText, Download, Send, ChevronDown, ChevronUp, AlertCircle, CheckCircle } from 'lucide-react'

const ITEMS_PER_PAGE = 20

interface RosterMember { id: string; name: string }

interface BundleResponse {
  invoice: {
    id: string
    invoice_number: string
    total: number
    order_count: number
    service_request_count: number
    pdf_url: string
    pay_url: string | null
  }
  sent_to_email: string | null
}

export default function OrderHistoryPage() {
  // Orders list — unfiltered, just the broker's history. The new Generate
  // Invoice flow has its own self-contained filter panel; this list shows
  // everything paginated so the broker can browse what they've placed.
  const [orders, setOrders] = useState<OrderData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  // Profile context — role, company, invoice billing, billing email default,
  // team roster (for the agent filter). All driven off /api/profile + /api/teams.
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)
  const [members, setMembers] = useState<RosterMember[]>([])
  const [invoiceBilling, setInvoiceBilling] = useState<boolean | null>(null)
  const [savedBillingEmail, setSavedBillingEmail] = useState('')

  // Generate Invoice panel state — collapsed by default. Filters live ONLY
  // inside the panel; opening it pre-fills with the current week + the
  // broker's saved billing email if there is one.
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelStartDate, setPanelStartDate] = useState('')
  const [panelEndDate, setPanelEndDate] = useState('')
  const [panelMinPrice, setPanelMinPrice] = useState('')
  const [panelMaxPrice, setPanelMaxPrice] = useState('')
  const [panelAgent, setPanelAgent] = useState('')
  const [accountantEmail, setAccountantEmail] = useState('')
  const [rememberEmail, setRememberEmail] = useState(false)
  const [generating, setGenerating] = useState<'download' | 'send' | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null)

  // Profile + roster bootstrap.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const profileRes = await fetch('/api/profile', { cache: 'no-store' })
        const profile = profileRes.ok ? await profileRes.json() : null
        const role = profile?.user?.role
        const ib = !!profile?.user?.invoice_billing
        const be = profile?.user?.billingEmail || profile?.user?.billing_email || ''
        if (cancelled) return
        setInvoiceBilling(ib)
        setSavedBillingEmail(be)
        setAccountantEmail(be) // pre-fill the panel input
        if (role === 'team_admin') {
          setIsTeamAdmin(true)
          const teamsRes = await fetch('/api/teams')
          if (teamsRes.ok) {
            const data = await teamsRes.json()
            if (!cancelled) {
              setMembers(Array.isArray(data.members) ? data.members.map((m: RosterMember) => ({ id: m.id, name: m.name })) : [])
            }
          }
        }
      } catch (err) {
        console.error('Profile load failed:', err)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Orders list — page changes only. No filter dependency (filters live in
  // the Generate Invoice panel and don't drive this list).
  useEffect(() => {
    let cancelled = false
    async function fetchOrders() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          limit: String(ITEMS_PER_PAGE),
          offset: String(page * ITEMS_PER_PAGE),
        })
        const res = await fetch(`/api/orders?${params.toString()}`)
        if (!res.ok) throw new Error('Failed to fetch orders')
        const data = await res.json()
        if (cancelled) return
        const fetchedOrders: OrderData[] = data.orders || []
        setOrders(fetchedOrders)
        setHasMore(fetchedOrders.length === ITEMS_PER_PAGE)
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching orders:', err)
          setError(err instanceof Error ? err.message : 'Failed to load order history')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchOrders()
    return () => { cancelled = true }
  }, [page])

  // Default the panel date range to "this past week" the first time it opens.
  function openPanel() {
    if (!panelStartDate || !panelEndDate) {
      const today = new Date()
      const day = today.getDay()
      const diffToMonday = day === 0 ? -6 : 1 - day
      const monday = new Date(today)
      monday.setDate(today.getDate() + diffToMonday)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const fmt = (d: Date) => d.toISOString().slice(0, 10)
      setPanelStartDate(fmt(monday))
      setPanelEndDate(fmt(sunday))
    }
    if (!accountantEmail) setAccountantEmail(savedBillingEmail)
    setPanelOpen(true)
    setGenerateError(null)
    setGenerateSuccess(null)
  }

  function closePanel() {
    setPanelOpen(false)
  }

  async function generate(mode: 'download' | 'send') {
    if (!panelStartDate || !panelEndDate) {
      setGenerateError('Pick a start and end date for the invoice.')
      return
    }
    if (mode === 'send' && !accountantEmail) {
      setGenerateError('Enter your accountant\'s email address to send the invoice.')
      return
    }
    setGenerating(mode)
    setGenerateError(null)
    setGenerateSuccess(null)
    try {
      const body = {
        startDate: panelStartDate,
        endDate: panelEndDate,
        ...(panelMinPrice ? { minPrice: parseFloat(panelMinPrice) } : {}),
        ...(panelMaxPrice ? { maxPrice: parseFloat(panelMaxPrice) } : {}),
        ...(panelAgent ? { agent: panelAgent } : {}),
        ...(accountantEmail ? { accountantEmail } : {}),
        rememberEmail,
        sendEmail: mode === 'send',
      }
      const res = await fetch('/api/invoices/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data: BundleResponse | { error: string } = await res.json()
      if (!res.ok) {
        throw new Error(('error' in data && data.error) || 'Generate failed')
      }
      const ok = data as BundleResponse
      if (mode === 'send') {
        setGenerateSuccess(
          `Invoice ${ok.invoice.invoice_number} sent to ${ok.sent_to_email} — ${ok.invoice.order_count} order(s) + ${ok.invoice.service_request_count} service trip(s), $${ok.invoice.total.toFixed(2)}.`,
        )
        if (rememberEmail && accountantEmail) setSavedBillingEmail(accountantEmail)
      } else {
        // Fetch the PDF as a blob and trigger a browser download. The pdf_url
        // is public token-gated so no cookies needed for the fetch.
        const pdfRes = await fetch(ok.invoice.pdf_url)
        if (!pdfRes.ok) throw new Error('PDF download failed')
        const blob = await pdfRes.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `invoice-${ok.invoice.invoice_number}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setGenerateSuccess(
          `Invoice ${ok.invoice.invoice_number} created and downloaded — ${ok.invoice.order_count} order(s) + ${ok.invoice.service_request_count} service trip(s), $${ok.invoice.total.toFixed(2)}.`,
        )
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generate failed')
    } finally {
      setGenerating(null)
    }
  }

  const handlePrevious = () => { if (page > 0) setPage(page - 1) }
  const handleNext = () => { if (hasMore) setPage(page + 1) }

  // Brokers without invoice billing don't see the Generate Invoice button —
  // they have no pending_invoice orders to bundle.
  const showGenerateButton = invoiceBilling === true

  return (
    <div>
      <Header title="Order History" />

      <div className="p-6">
        {/* Generate Invoice — collapsed by default, expands into a single
            self-contained panel with filters + actions. Replaces the prior
            Filter & Export bar entirely. */}
        {showGenerateButton && (
          <Card className="mb-6">
            <CardContent className="p-0">
              <button
                type="button"
                onClick={panelOpen ? closePanel : openPanel}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-pink-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-pink-500" />
                  <span className="font-semibold text-gray-900">Generate Invoice</span>
                  <span className="text-xs text-gray-500 ml-2">
                    Bundle pending orders + service trips into a PDF invoice for your accountant.
                  </span>
                </div>
                {panelOpen ? (
                  <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
              </button>

              {panelOpen && (
                <div className="px-5 pb-5 pt-2 border-t border-gray-100 space-y-4">
                  {/* Filters — date range + price band + (team_admin only) agent */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <DateInput
                      label="Start date"
                      value={panelStartDate}
                      onChange={(v) => setPanelStartDate(v)}
                      max={panelEndDate || undefined}
                    />
                    <DateInput
                      label="End date"
                      value={panelEndDate}
                      onChange={(v) => setPanelEndDate(v)}
                      min={panelStartDate || undefined}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      label="Min price ($)"
                      placeholder="Any"
                      value={panelMinPrice}
                      onChange={(e) => setPanelMinPrice(e.target.value)}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      label="Max price ($)"
                      placeholder="Any"
                      value={panelMaxPrice}
                      onChange={(e) => setPanelMaxPrice(e.target.value)}
                    />
                    {isTeamAdmin && (
                      <Select
                        label="Agent"
                        placeholder=""
                        value={panelAgent}
                        onChange={(e) => setPanelAgent(e.target.value)}
                        options={[
                          { value: '', label: 'All agents' },
                          ...members.map((m) => ({ value: m.name, label: m.name })),
                        ]}
                      />
                    )}
                  </div>

                  {/* Accountant email + Remember checkbox */}
                  <div className="border-t border-gray-100 pt-4 space-y-3">
                    <Input
                      type="email"
                      label="Accountant's email (optional for Download — required to Send)"
                      placeholder="accounting@brokerage.com"
                      value={accountantEmail}
                      onChange={(e) => setAccountantEmail(e.target.value)}
                    />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rememberEmail}
                        onChange={(e) => setRememberEmail(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                      />
                      <span className="text-sm text-gray-700">
                        Remember this email for next time
                        {savedBillingEmail && accountantEmail !== savedBillingEmail && (
                          <span className="text-xs text-gray-500 ml-1">
                            (currently saved: {savedBillingEmail})
                          </span>
                        )}
                      </span>
                    </label>
                  </div>

                  {/* Error / success banners */}
                  {generateError && (
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{generateError}</span>
                    </div>
                  )}
                  {generateSuccess && (
                    <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                      <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{generateSuccess}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-3 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => generate('download')}
                      disabled={!!generating}
                    >
                      {generating === 'download' ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                      ) : (
                        <><Download className="w-4 h-4 mr-2" /> Download PDF</>
                      )}
                    </Button>
                    <Button
                      onClick={() => generate('send')}
                      disabled={!!generating || !accountantEmail}
                    >
                      {generating === 'send' ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                      ) : (
                        <><Send className="w-4 h-4 mr-2" /> Send to accountant</>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Either action creates the invoice in Pink Posts so the bundled orders + service trips
                    can&apos;t be billed again. Sending also emails the accountant with the PDF + a Stripe Pay link.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Orders list */}
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
              <p className="text-gray-500">Loading order history...</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <p className="text-red-700">{error}</p>
            <button
              onClick={() => setPage(0)}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800"
            >
              Try again
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">
              No orders found. Place your first order to see it here!
            </p>
          </div>
        ) : (
          <>
            <OrderHistoryTable orders={orders} />

            {/* Pagination */}
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-gray-500">Page {page + 1}</p>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevious}
                  disabled={page === 0}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${
                    page === 0
                      ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                      : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Previous
                </button>
                <button
                  onClick={handleNext}
                  disabled={!hasMore}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${
                    !hasMore
                      ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                      : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Native <input type="date"> wrapped to look like the rest of the form.
 * Webkit's default calendar-picker indicator is small + gray; we use the
 * arbitrary-variant selector to brand-tint it pink and normalize the box
 * height so it lines up with sibling Inputs/Selects.
 */
function DateInput({
  label, value, onChange, min, max,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  min?: string
  max?: string
}) {
  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        className="block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all duration-200 [color-scheme:light] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
      />
    </div>
  )
}
