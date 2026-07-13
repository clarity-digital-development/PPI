'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  useStripe,
  useElements,
  PaymentElement,
  Elements,
} from '@stripe/react-stripe-js'
import { getStripe } from '@/lib/stripe-client'
import { Card, CardContent, Button, Badge } from '@/components/ui'
import { Header } from '@/components/dashboard'
import { Loader2, CheckCircle, FileText, Download, Wrench } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { exportInvoicePdf, type InvoiceDetail } from '@/lib/invoices/invoice-pdf'

function PayForm({ invoiceNumber, total, onPaid }: { invoiceNumber: string; total: number; onPaid: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setProcessing(true)
    setError(null)
    try {
      const { error: confirmErr, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/dashboard/invoices/${invoiceNumber}`,
        },
        redirect: 'if_required',
      })
      if (confirmErr) {
        setError(confirmErr.message || 'Payment failed. Please try again.')
        setProcessing(false)
        return
      }
      if (paymentIntent?.status === 'succeeded') {
        onPaid()
        return
      }
      // 'processing' — the webhook will flip the invoice eventually.
      onPaid()
    } catch (err) {
      console.error('Pay error:', err)
      setError('Could not process payment. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}
      <Button type="submit" className="w-full" size="lg" disabled={!stripe || processing}>
        {processing ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing…</>
        ) : (
          `Pay ${formatCurrency(total)}`
        )}
      </Button>
    </form>
  )
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const id = params.id as string
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [intentLoading, setIntentLoading] = useState(false)
  const [intentError, setIntentError] = useState<string | null>(null)
  const [justPaid, setJustPaid] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/invoices/${id}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Could not load invoice')
        }
        const data = await res.json()
        if (!cancelled) setInvoice(data.invoice)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load invoice')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  async function initPaymentIntent() {
    setIntentLoading(true)
    setIntentError(null)
    try {
      const res = await fetch(`/api/invoices/${id}/pay-intent`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not initialize payment')
      }
      const data = await res.json()
      setClientSecret(data.clientSecret)
    } catch (err) {
      setIntentError(err instanceof Error ? err.message : 'Initialization failed')
    } finally {
      setIntentLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
      </div>
    )
  }
  if (error || !invoice) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error || 'Invoice not found.'}</div>
        <Link href="/dashboard" className="mt-4 inline-block text-pink-600 hover:underline text-sm">← Back to dashboard</Link>
      </div>
    )
  }

  const isPaid = invoice.status === 'paid' || justPaid

  return (
    <div>
      <Header title={`Invoice ${invoice.invoice_number}`} />
      <div className="p-6 max-w-4xl mx-auto">
        {/* Hero */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-lg bg-pink-100 flex items-center justify-center text-pink-600">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Invoice {invoice.invoice_number}</h1>
                  <p className="text-sm text-gray-500">
                    Billing period {invoice.range_start.slice(0, 10)} → {invoice.range_end.slice(0, 10)}
                  </p>
                  {invoice.customer.company && (
                    <p className="text-sm text-gray-500 mt-1">{invoice.customer.company}</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase tracking-wider">Total Due</p>
                <p className="text-3xl font-bold text-pink-600">{formatCurrency(invoice.total)}</p>
                <div className="mt-2 flex items-center justify-end gap-2">
                  {isPaid ? (
                    <Badge variant="success">Paid</Badge>
                  ) : invoice.status === 'void' ? (
                    <Badge variant="neutral">Voided</Badge>
                  ) : (
                    <Badge variant="info">Outstanding</Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportInvoicePdf(invoice)}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    PDF
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pay area */}
        {!isPaid && invoice.status === 'sent' && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Pay this invoice</h2>
              <p className="text-sm text-gray-500 mb-4">
                A single charge for {formatCurrency(invoice.total)} settles {(() => {
                  const parts: string[] = []
                  if (invoice.orders.length) parts.push(`${invoice.orders.length} bundled order${invoice.orders.length === 1 ? '' : 's'}`)
                  if (invoice.service_requests.length) parts.push(`${invoice.service_requests.length} service trip${invoice.service_requests.length === 1 ? '' : 's'}`)
                  return parts.join(' + ') || 'this invoice'
                })()}.
              </p>
              {!clientSecret ? (
                <>
                  {intentError && (
                    <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{intentError}</div>
                  )}
                  <Button onClick={initPaymentIntent} disabled={intentLoading} size="lg">
                    {intentLoading ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading payment form…</>
                    ) : (
                      `Pay ${formatCurrency(invoice.total)}`
                    )}
                  </Button>
                </>
              ) : (
                <Elements
                  stripe={getStripe()}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: 'stripe',
                      variables: {
                        colorPrimary: '#E84A7A',
                        colorBackground: '#ffffff',
                        colorText: '#1f2937',
                        colorDanger: '#ef4444',
                        fontFamily: 'system-ui, sans-serif',
                        borderRadius: '8px',
                      },
                    },
                  }}
                >
                  <PayForm
                    invoiceNumber={invoice.invoice_number}
                    total={invoice.total}
                    onPaid={() => setJustPaid(true)}
                  />
                </Elements>
              )}
            </CardContent>
          </Card>
        )}

        {/* Paid banner */}
        {isPaid && (
          <Card className="mb-6 border-green-200 bg-green-50">
            <CardContent className="p-6 flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-green-900">Paid in full</p>
                <p className="text-sm text-green-800">
                  {invoice.paid_at ? `Paid ${formatDate(invoice.paid_at)}` : 'Your payment is being processed; this invoice will mark paid shortly.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bundled orders */}
        {invoice.orders.length > 0 && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-3">Bundled orders</h2>
              <div className="space-y-3">
                {invoice.orders.map((o) => (
                  <div key={o.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <Link href={`/dashboard/orders/${o.id}`} className="font-medium text-pink-600 hover:text-pink-700">
                          {o.order_number}
                        </Link>
                        <p className="text-xs text-gray-500">{formatDate(o.created_at)}</p>
                      </div>
                      <p className="font-semibold text-gray-900">{formatCurrency(o.total)}</p>
                    </div>
                    <p className="text-sm text-gray-700">
                      {o.property_address}, {o.property_city}, {o.property_state} {o.property_zip}
                    </p>
                    {o.placed_for_agent_name && (
                      <p className="text-xs text-pink-600 mt-1">Agent: {o.placed_for_agent_name}</p>
                    )}
                    <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
                      {o.flat_fee_applied ? (
                        <li>• Flat Installation Fee — {formatCurrency(o.subtotal)} (+ gas &amp; tax)</li>
                      ) : (
                        o.items.map((it, idx) => (
                          <li key={idx}>
                            • {it.description}
                            {it.quantity > 1 ? ` ×${it.quantity}` : ''}
                            {it.quantity > 1 && ` — ${formatCurrency(it.unit_price)} ea`}
                            {' — '}{formatCurrency(it.total_price)}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bundled service trips */}
        {invoice.service_requests.length > 0 && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-pink-500" /> Bundled service trips
              </h2>
              <div className="space-y-3">
                {invoice.service_requests.map((sr) => {
                  const label = sr.type === 'service' ? 'Service trip'
                    : sr.type === 'removal' ? 'Removal'
                    : sr.type === 'repair' ? 'Repair'
                    : sr.type === 'replacement' ? 'Replacement'
                    : sr.type
                  return (
                    <div key={sr.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <p className="font-medium text-gray-900">{label}</p>
                          <p className="text-xs text-gray-500">
                            {sr.completed_at ? `Completed ${formatDate(sr.completed_at)}` : `Requested ${formatDate(sr.created_at)}`}
                          </p>
                        </div>
                        <p className="font-semibold text-gray-900">{formatCurrency(sr.amount)}</p>
                      </div>
                      {sr.property_address && (
                        <p className="text-sm text-gray-700">
                          {sr.property_address}
                          {sr.property_city ? `, ${sr.property_city}` : ''}
                          {sr.property_state ? `, ${sr.property_state}` : ''}
                          {sr.property_zip ? ` ${sr.property_zip}` : ''}
                        </p>
                      )}
                      {sr.description && (
                        <p className="text-xs text-gray-600 mt-1">{sr.description}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grand total — broken out so Subtotal → Total is fully explained */}
        <Card>
          <CardContent className="p-6">
            <div className="space-y-2 text-sm">
              {/* Split when service trips exist so the broker sees why Sales
                  Tax below isn't 6% × Subtotal — service trips aren't taxable.
                  Each row independently > 0-gated so an SR-only invoice doesn't
                  render a confusing "Orders subtotal $0.00" line. Order-only
                  invoices fall through to the single Subtotal line, preserving
                  the prior layout exactly. "(non-taxable)" carries the
                  explanation; the orders row stays neutral because discounts/
                  fees mean 6% × orders_subtotal ≠ tax_total in the general
                  case. */}
              {invoice.service_requests_subtotal > 0 ? (
                <>
                  {invoice.orders_subtotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Orders subtotal</span>
                      <span className="text-gray-900">{formatCurrency(invoice.orders_subtotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Service trips (non-taxable)</span>
                    <span className="text-gray-900">{formatCurrency(invoice.service_requests_subtotal)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-900">{formatCurrency(invoice.subtotal)}</span>
                </div>
              )}
              {invoice.discount_total > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span><span>-{formatCurrency(invoice.discount_total)}</span>
                </div>
              )}
              {invoice.no_post_total > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Service Trip Fee (no post)</span>
                  <span className="text-gray-900">{formatCurrency(invoice.no_post_total)}</span>
                </div>
              )}
              {invoice.expedite_total > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Expedite Fee</span>
                  <span className="text-gray-900">{formatCurrency(invoice.expedite_total)}</span>
                </div>
              )}
              {invoice.fuel_total > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Fuel Surcharge</span>
                  <span className="text-gray-900">{formatCurrency(invoice.fuel_total)}</span>
                </div>
              )}
              {invoice.tax_total > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Sales Tax</span>
                  <span className="text-gray-900">{formatCurrency(invoice.tax_total)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-200 pt-2 mt-2">
                <span className="text-sm text-gray-500">Total due</span>
                <span className="text-lg font-bold text-pink-600">{formatCurrency(invoice.total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
