'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Button, Select } from '@/components/ui'
import { useCart, useHoldHeartbeat } from '@/lib/cart'
import { getOrCreateCartSessionId } from '@/lib/cart-session'
import {
  ShoppingCart,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Package,
  User,
  MapPin,
  Plus,
  Clock,
} from 'lucide-react'
import { getStripe } from '@/lib/stripe/client'

interface PaymentMethod {
  id: string
  card_brand: string | null
  card_last4: string | null
  is_default: boolean
}

interface CheckoutResult {
  cartItemId: string
  status: 'pending' | 'processing' | 'success' | 'error'
  orderNumber?: string
  error?: string
}

export default function CartPage() {
  const { items, loaded, updateItem, removeItem, clearCart } = useCart()
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('')
  const [checkingOut, setCheckingOut] = useState(false)
  const [results, setResults] = useState<CheckoutResult[]>([])
  const [done, setDone] = useState(false)
  // Rows where the bump heartbeat returned extended:false — checkout for
  // these is blocked until the user re-picks (we don't auto-reacquire to
  // avoid silently re-grabbing inventory that may have changed hands).
  const [expiredRows, setExpiredRows] = useState<Set<string>>(new Set())

  useHoldHeartbeat({
    items,
    updateItem,
    enabled: !checkingOut && !done,
    onConflict: (cartItemId) => {
      setExpiredRows(prev => {
        if (prev.has(cartItemId)) return prev
        const next = new Set(prev)
        next.add(cartItemId)
        return next
      })
    },
  })

  useEffect(() => {
    async function fetchPayments() {
      try {
        const res = await fetch('/api/payments/methods')
        if (res.ok) {
          const data = await res.json()
          const methods: PaymentMethod[] = data.paymentMethods || []
          setPaymentMethods(methods)
          const def = methods.find(m => m.is_default) || methods[0]
          if (def) setSelectedPaymentMethod(def.id)
        }
      } catch (err) {
        console.error('Error loading payment methods:', err)
      }
    }
    fetchPayments()
  }, [])

  const grandTotal = items.reduce((sum, item) => sum + item.estimatedTotal, 0)

  // "Next order" → back to the place-order flow to add another order to the
  // batch. Preserve the on_behalf_of param if this cart was built on behalf of
  // a specific agent (cart items store it as agentId; team_admins placing under
  // their own account leave it empty).
  const onBehalfOfId = items.find(i => i.agentId)?.agentId || ''
  const nextOrderHref = onBehalfOfId
    ? `/dashboard/place-order?on_behalf_of=${encodeURIComponent(onBehalfOfId)}`
    : '/dashboard/place-order'

  async function handleCheckoutAll() {
    if (items.length === 0 || !selectedPaymentMethod) return
    setCheckingOut(true)
    setDone(false)
    setResults(items.map(i => ({ cartItemId: i.id, status: 'processing' })))

    try {
      // Build the batch payload — every cart row becomes one order in the batch,
      // all sharing a SINGLE Stripe charge for the combined total
      // Each item carries its hold_id so the server can claim it atomically.
      const batchPayload = {
        payment_method_id: selectedPaymentMethod,
        cart_session_id: getOrCreateCartSessionId(),
        orders: items.map(cartItem => {
          const fd = cartItem.formData
          const holdIds = cartItem.holdIds || {}
          const itemsWithHolds = cartItem.items.map(item => {
            const itemHolds: Record<string, string> = {}
            for (const field of ['customer_sign_id', 'customer_rider_id', 'customer_lockbox_id']) {
              const id = item[field]
              if (typeof id === 'string') {
                const holdId = holdIds[`${field}:${id}`]
                if (holdId) itemHolds[field] = holdId
              }
            }
            return Object.keys(itemHolds).length > 0
              ? { ...item, hold_ids: itemHolds }
              : item
          })
          return {
            property_type: fd.property_type,
            property_address: fd.property_address,
            property_city: fd.property_city,
            property_state: fd.property_state,
            property_zip: fd.property_zip,
            installation_location: fd.installation_location,
            installation_location_image: fd.installation_location_image,
            installation_notes: fd.installation_notes,
            is_gated_community: fd.is_gated_community,
            gate_code: fd.gate_code,
            has_marker_placed: fd.has_marker_placed,
            sign_orientation: fd.sign_orientation,
            sign_orientation_other: fd.sign_orientation_other,
            post_type: fd.post_type,
            items: itemsWithHolds,
            requested_date: fd.requested_date,
            is_expedited: fd.schedule_type === 'expedited',
            placed_for_agent_name: fd.placed_for_agent_name?.trim() || cartItem.agentName || undefined,
          }
        }),
      }

      const res = await fetch('/api/orders/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload),
      })
      const data = await res.json()

      if (!res.ok) {
        // Batch-wide failure — mark all rows errored with the message
        setResults(items.map(i => ({ cartItemId: i.id, status: 'error', error: data.error || 'Batch failed' })))
        setCheckingOut(false)
        setDone(true)
        return
      }

      // If 3DS is required, ask Stripe.js to handle the challenge on the
      // single combined PaymentIntent
      if (data.status === 'requires_action' && data.client_secret) {
        const stripe = await getStripe()
        if (!stripe) throw new Error('Could not load payment service.')
        const { paymentIntent, error: stripeError } = await stripe.handleNextAction({
          clientSecret: data.client_secret,
        })
        if (stripeError) throw new Error(stripeError.message || 'Payment verification failed.')
        if (paymentIntent?.status !== 'succeeded' && paymentIntent?.status !== 'processing') {
          throw new Error('Your bank did not approve the payment. Please try a different card.')
        }
      }

      // All N orders placed under one charge — mark each row success
      const placedOrders = data.orders || []
      setResults(items.map((cartItem, idx) => ({
        cartItemId: cartItem.id,
        status: 'success',
        orderNumber: placedOrders[idx]?.orderNumber,
      })))
      // Clear the cart now that everything is placed
      clearCart()
    } catch (err) {
      setResults(items.map(i => ({
        cartItemId: i.id,
        status: 'error',
        error: err instanceof Error ? err.message : 'Network error',
      })))
    } finally {
      setCheckingOut(false)
      setDone(true)
    }
  }

  if (!loaded) {
    return (
      <div>
        <Header title="Cart" />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
        </div>
      </div>
    )
  }

  if (items.length === 0 && !done) {
    return (
      <div>
        <Header title="Cart" />
        <div className="p-6 max-w-2xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center">
              <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Your cart is empty</h2>
              <p className="text-gray-600 mb-6">
                Go to a customer&apos;s page and click <strong>Place Order for This Customer</strong> →{' '}
                <strong>Add to Cart</strong> to start batching orders.
              </p>
              <Link href="/admin/customers">
                <Button>Browse Customers</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length

  return (
    <div>
      <Header title="Cart" />
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        {/* Cart summary */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {items.length} order{items.length === 1 ? '' : 's'} in cart
            </h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Grand total: <span className="font-semibold text-gray-900">${grandTotal.toFixed(2)}</span>{' '}
              <span className="text-gray-400">(approx. — final total includes tax)</span>
            </p>
          </div>
          {items.length > 0 && !checkingOut && !done && (
            <div className="flex items-center gap-2">
              <Link href={nextOrderHref}>
                <Button variant="outline">
                  <Plus className="w-4 h-4 mr-1" />
                  Next order
                </Button>
              </Link>
              <Button variant="outline" onClick={clearCart}>Clear cart</Button>
            </div>
          )}
        </div>

        {/* Cart items */}
        {items.map((item, idx) => {
          const result = results.find(r => r.cartItemId === item.id)
          return (
            <Card key={item.id}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                      <User className="w-4 h-4" />
                      <span className="font-semibold text-gray-900">{item.agentName || item.agentEmail}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                      <MapPin className="w-4 h-4" />
                      <span>{item.propertyAddress}</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm text-gray-600">
                      <Package className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <ul className="text-xs space-y-0.5">
                        {item.items.slice(0, 4).map((oi, i) => (
                          <li key={i}>· {String(oi.description)}</li>
                        ))}
                        {item.items.length > 4 && <li className="text-gray-400">… and {item.items.length - 4} more</li>}
                      </ul>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900">${item.estimatedTotal.toFixed(2)}</p>
                    {item.holdsExpireAt && !expiredRows.has(item.id) && (
                      <p className="mt-1 text-xs text-gray-500 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Reserved for <HoldCountdown until={item.holdsExpireAt} />
                      </p>
                    )}
                    {expiredRows.has(item.id) && (
                      <p className="mt-1 text-xs text-red-600 inline-flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Reservation expired — remove & re-pick
                      </p>
                    )}
                    {!checkingOut && !done && (
                      <button
                        type="button"
                        onClick={() => {
                          removeItem(item.id)
                          setExpiredRows(prev => {
                            if (!prev.has(item.id)) return prev
                            const next = new Set(prev)
                            next.delete(item.id)
                            return next
                          })
                        }}
                        className="mt-2 text-sm text-gray-400 hover:text-red-500 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-4 h-4" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* Checkout status for this row */}
                {result && (
                  <div className={`mt-3 pt-3 border-t flex items-center gap-2 text-sm ${
                    result.status === 'success' ? 'text-green-700' :
                    result.status === 'error' ? 'text-red-700' :
                    result.status === 'processing' ? 'text-pink-700' :
                    'text-gray-500'
                  }`}>
                    {result.status === 'success' && <><CheckCircle className="w-4 h-4" /> Placed — {result.orderNumber}</>}
                    {result.status === 'error' && <><AlertCircle className="w-4 h-4" /> {result.error}</>}
                    {result.status === 'processing' && <><Loader2 className="w-4 h-4 animate-spin" /> Placing order {idx + 1} of {items.length}…</>}
                    {result.status === 'pending' && <>Queued</>}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}

        {/* Done summary */}
        {done && (
          <Card className={successCount > 0 && errorCount === 0 ? 'border-green-200 bg-green-50' : errorCount > 0 ? 'border-amber-200 bg-amber-50' : ''}>
            <CardContent className="p-5">
              <p className="font-semibold text-gray-900">
                {successCount} placed{errorCount > 0 ? `, ${errorCount} failed` : ''}
              </p>
              {errorCount > 0 && (
                <p className="text-sm text-gray-700 mt-1">
                  Failed orders are still in your cart — fix the issue (different card, valid date, etc.) and try again.
                </p>
              )}
              {successCount > 0 && (
                <Link href="/admin/orders">
                  <Button className="mt-3">View placed orders</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {/* Re-pick prompt for expired rows */}
        {expiredRows.size > 0 && !checkingOut && !done && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4 text-sm text-amber-900">
              <p className="font-semibold mb-1">Some reservations expired while your cart was open.</p>
              <p>Remove the affected orders above and re-add them from the customer&apos;s page. Inventory may have changed in the meantime.</p>
            </CardContent>
          </Card>
        )}

        {/* Payment method + checkout */}
        {items.length > 0 && !done && (
          <Card>
            <CardContent className="p-5 space-y-3">
              {paymentMethods.length === 0 ? (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  No payment method on file. Add one from your{' '}
                  <Link href="/dashboard/billing" className="underline font-medium">billing page</Link>.
                </div>
              ) : (
                <Select
                  label="Charge to (your card on file)"
                  value={selectedPaymentMethod}
                  onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                  disabled={checkingOut}
                  placeholder=""
                  options={paymentMethods.map(pm => ({
                    value: pm.id,
                    label: `${pm.card_brand?.toUpperCase() || 'Card'} •••• ${pm.card_last4}${pm.is_default ? ' (default)' : ''}`,
                  }))}
                />
              )}

              {expiredRows.size > 0 && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  {expiredRows.size === 1 ? 'One order has' : `${expiredRows.size} orders have`} expired reservations. Remove and re-add to continue.
                </div>
              )}
              <Button
                size="lg"
                className="w-full"
                onClick={handleCheckoutAll}
                disabled={checkingOut || !selectedPaymentMethod || paymentMethods.length === 0 || expiredRows.size > 0}
              >
                {checkingOut
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Placing {items.length} orders…</>
                  : `Place ${items.length} order${items.length === 1 ? '' : 's'} — $${grandTotal.toFixed(2)}+`
                }
              </Button>
              <p className="text-xs text-center text-gray-500">
                Single charge for the combined total — appears once on your statement.
              </p>
              <Link href={nextOrderHref} className="block">
                <Button variant="outline" className="w-full" disabled={checkingOut}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add another order
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function HoldCountdown({ until }: { until: string }) {
  const target = new Date(until).getTime()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const remainingMs = Math.max(0, target - now)
  const totalSec = Math.floor(remainingMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return <span>{m}:{s.toString().padStart(2, '0')}</span>
}
