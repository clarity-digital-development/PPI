'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Button } from '@/components/ui'
import { useCart } from '@/lib/cart'
import {
  ShoppingCart,
  Trash2,
  Loader2,
  CheckCircle,
  AlertCircle,
  Package,
  User,
  MapPin,
} from 'lucide-react'

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
  const { items, loaded, removeItem, clearCart } = useCart()
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('')
  const [checkingOut, setCheckingOut] = useState(false)
  const [results, setResults] = useState<CheckoutResult[]>([])
  const [done, setDone] = useState(false)

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

  async function handleCheckoutAll() {
    if (items.length === 0 || !selectedPaymentMethod) return
    setCheckingOut(true)
    setDone(false)
    const initial: CheckoutResult[] = items.map(i => ({ cartItemId: i.id, status: 'pending' }))
    setResults(initial)

    const updated = [...initial]
    for (let idx = 0; idx < items.length; idx++) {
      const cartItem = items[idx]
      updated[idx] = { ...updated[idx], status: 'processing' }
      setResults([...updated])

      try {
        const fd = cartItem.formData
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
            items: cartItem.items,
            requested_date: fd.requested_date,
            is_expedited: fd.schedule_type === 'expedited',
            payment_method_id: selectedPaymentMethod,
            save_payment_method: false,
            promo_code: fd.promo_code,
            promo_code_id: fd.promo_code_id,
            fuel_surcharge_waived: fd.fuel_surcharge_waived,
            on_behalf_of_user_id: cartItem.agentId,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          updated[idx] = { ...updated[idx], status: 'error', error: data.error || 'Order failed' }
        } else {
          updated[idx] = { ...updated[idx], status: 'success', orderNumber: data.order?.orderNumber }
          // Remove successful items from the cart so a retry only re-charges failures
          removeItem(cartItem.id)
        }
      } catch (err) {
        updated[idx] = { ...updated[idx], status: 'error', error: err instanceof Error ? err.message : 'Network error' }
      }
      setResults([...updated])
    }

    setCheckingOut(false)
    setDone(true)
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
          {items.length > 0 && !checkingOut && (
            <Button variant="outline" onClick={clearCart}>Clear cart</Button>
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
                    {!checkingOut && !done && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
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

        {/* Payment method + checkout */}
        {items.length > 0 && !done && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Charge to (your card on file)
                </label>
                {paymentMethods.length === 0 ? (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    No payment method on file. Add one from your{' '}
                    <Link href="/dashboard/billing" className="underline font-medium">billing page</Link>.
                  </div>
                ) : (
                  <select
                    value={selectedPaymentMethod}
                    onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                    disabled={checkingOut}
                  >
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>
                        {pm.card_brand?.toUpperCase() || 'Card'} •••• {pm.card_last4}
                        {pm.is_default && ' (default)'}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <Button
                size="lg"
                className="w-full"
                onClick={handleCheckoutAll}
                disabled={checkingOut || !selectedPaymentMethod || paymentMethods.length === 0}
              >
                {checkingOut
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Placing {items.length} orders…</>
                  : `Place ${items.length} order${items.length === 1 ? '' : 's'} — $${grandTotal.toFixed(2)}+`
                }
              </Button>
              <p className="text-xs text-center text-gray-500">
                Each order is charged separately to the selected card.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
