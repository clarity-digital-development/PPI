'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CreditCard,
  MapPin,
  Calendar,
  Package,
  User,
  Phone,
  Mail,
  Loader2,
  CheckCircle,
  AlertCircle,
  DollarSign,
} from 'lucide-react'
import { Button, Badge, Card, CardContent } from '@/components/ui'

interface OrderItem {
  id: string
  itemType: string
  itemCategory: string
  description: string
  quantity: number
  unitPrice: number | string
  totalPrice: number | string
}

interface Order {
  id: string
  orderNumber: string
  status: string
  paymentStatus: string
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  propertyType: string
  propertyNotes: string | null
  scheduledDate: string | null
  isExpedited: boolean
  // Installation details
  isGatedCommunity: boolean
  gateCode: string | null
  hasMarkerPlaced: boolean
  signOrientation: string | null
  signOrientationOther: string | null
  installationLocation: string | null
  installationLocationImage: string | null
  subtotal: number | string
  fuelSurcharge: number | string
  expediteFee: number | string
  discount: number | string
  tax: number | string
  total: number | string
  createdAt: string
  promoCode?: {
    code: string
  } | null
  paymentIntentId: string | null
  user: {
    id: string
    fullName: string | null
    email: string
    phone: string | null
    stripeCustomerId: string | null
  }
  postType: {
    name: string
    description: string | null
  }
  orderItems: OrderItem[]
}

interface PaymentMethod {
  id: string
  brand: string
  last4: string
  isDefault: boolean
}

const statusVariants: Record<string, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = {
  pending: 'warning',
  confirmed: 'info',
  scheduled: 'info',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
}

const paymentStatusVariants: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
  pending: 'warning',
  processing: 'info',
  succeeded: 'success',
  failed: 'error',
  refunded: 'neutral' as 'info',
}

export default function AdminOrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = params.id as string

  const [order, setOrder] = useState<Order | null>(null)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [charging, setCharging] = useState(false)
  const [chargeError, setChargeError] = useState<string | null>(null)
  const [chargeSuccess, setChargeSuccess] = useState(false)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('')

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(`/api/admin/orders/${orderId}`)
        if (!res.ok) {
          throw new Error('Failed to fetch order')
        }
        const data = await res.json()
        setOrder(data.order)

        // If there's a customer, fetch their payment methods
        if (data.order.user?.stripeCustomerId) {
          const pmRes = await fetch(`/api/admin/customers/${data.order.user.id}/payment-methods`)
          if (pmRes.ok) {
            const pmData = await pmRes.json()
            setPaymentMethods(pmData.paymentMethods || [])
            // Set default payment method
            const defaultPm = pmData.paymentMethods?.find((pm: PaymentMethod) => pm.isDefault)
            if (defaultPm) {
              setSelectedPaymentMethod(defaultPm.id)
            } else if (pmData.paymentMethods?.length > 0) {
              setSelectedPaymentMethod(pmData.paymentMethods[0].id)
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order')
      } finally {
        setLoading(false)
      }
    }

    fetchOrder()
  }, [orderId])

  async function handleChargeCard() {
    if (!selectedPaymentMethod || !order) return

    setCharging(true)
    setChargeError(null)
    setChargeSuccess(false)

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method_id: selectedPaymentMethod }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to charge card')
      }

      setChargeSuccess(true)
      setOrder((prev) => prev ? { ...prev, paymentStatus: 'succeeded' } : null)
    } catch (err) {
      setChargeError(err instanceof Error ? err.message : 'Failed to charge card')
    } finally {
      setCharging(false)
    }
  }

  async function updateOrderStatus(newStatus: string) {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (res.ok) {
        setOrder((prev) => prev ? { ...prev, status: newStatus } : null)
      }
    } catch (err) {
      console.error('Error updating order status:', err)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="p-6">
        <Card variant="bordered">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">{error || 'Order not found'}</p>
            <Link href="/admin/orders">
              <Button>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Orders
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/orders"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                Order {order.orderNumber}
              </h1>
              <Badge variant={statusVariants[order.status] || 'neutral'}>
                {order.status.replace('_', ' ')}
              </Badge>
              <Badge variant={paymentStatusVariants[order.paymentStatus] || 'warning'}>
                {order.paymentStatus}
              </Badge>
              {order.isExpedited && (
                <Badge variant="warning">Expedited</Badge>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Created {new Date(order.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Status dropdown */}
        <select
          value={order.status}
          onChange={(e) => updateOrderStatus(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Card variant="bordered">
            <CardContent className="p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Customer Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-start gap-3">
                  <User className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Name</p>
                    <p className="font-medium text-gray-900">
                      {order.user.fullName || 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium text-gray-900">{order.user.email}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Phone</p>
                    <p className="font-medium text-gray-900">
                      {order.user.phone || 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Property Info */}
          <Card variant="bordered">
            <CardContent className="p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Property Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Address</p>
                    <p className="font-medium text-gray-900">
                      {order.propertyAddress}
                    </p>
                    <p className="text-gray-600">
                      {order.propertyCity}, {order.propertyState} {order.propertyZip}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Package className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Property Type</p>
                    <p className="font-medium text-gray-900 capitalize">
                      {order.propertyType.replace('_', ' ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Requested Date</p>
                    <p className="font-medium text-gray-900">
                      {order.scheduledDate
                        ? new Date(order.scheduledDate).toLocaleDateString('en-US', { timeZone: 'UTC' })
                        : 'Next Available'}
                    </p>
                  </div>
                </div>
                {order.postType && (
                  <div className="flex items-start gap-3">
                    <Package className="w-5 h-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-gray-500">Post Type</p>
                      <p className="font-medium text-gray-900">{order.postType.name}</p>
                    </div>
                  </div>
                )}
              </div>
              {order.propertyNotes && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500 mb-1">Special Instructions</p>
                  <p className="text-gray-700">{order.propertyNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Installation Details */}
          <Card variant="bordered">
            <CardContent className="p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Installation Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Gated Community</p>
                  <p className="font-medium text-gray-900">
                    {order.isGatedCommunity ? 'Yes' : 'No'}
                    {order.isGatedCommunity && order.gateCode && (
                      <span className="ml-2 text-gray-600">
                        (Code: {order.gateCode})
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Marker Placed</p>
                  <p className="font-medium text-gray-900">
                    {order.hasMarkerPlaced ? 'Yes' : 'No'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Sign Orientation</p>
                  <p className="font-medium text-gray-900 capitalize">
                    {order.signOrientation === 'other' && order.signOrientationOther
                      ? order.signOrientationOther
                      : order.signOrientation?.replace('_', ' ') || 'Not specified'}
                  </p>
                </div>
                {order.installationLocation && (
                  <div>
                    <p className="text-sm text-gray-500">Installation Location</p>
                    <p className="font-medium text-gray-900">
                      {order.installationLocation}
                    </p>
                  </div>
                )}
              </div>
              {order.installationLocationImage && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500 mb-2">Location Image</p>
                  <img
                    src={order.installationLocationImage}
                    alt="Installation location"
                    className="w-48 h-48 object-cover rounded-lg border border-gray-200"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Items */}
          <Card variant="bordered">
            <CardContent className="p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Order Items</h2>
              <div className="space-y-3">
                {order.orderItems.map((item) => (
                  <div key={item.id} className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="font-medium text-gray-900">{item.description}</p>
                      <p className="text-sm text-gray-500 capitalize">
                        {item.itemType} - {item.itemCategory?.replace('_', ' ')}
                      </p>
                    </div>
                    <p className="font-medium text-gray-900">
                      ${Number(item.totalPrice).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-900">${Number(order.subtotal).toFixed(2)}</span>
                </div>
                {Number(order.discount) > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount{order.promoCode ? ` (${order.promoCode.code})` : ''}</span>
                    <span>-${Number(order.discount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Fuel Surcharge</span>
                  <span className="text-gray-900">${Number(order.fuelSurcharge).toFixed(2)}</span>
                </div>
                {Number(order.expediteFee) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Expedite Fee</span>
                    <span className="text-gray-900">${Number(order.expediteFee).toFixed(2)}</span>
                  </div>
                )}
                {Number(order.tax) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Sales Tax (6%)</span>
                    <span className="text-gray-900">${Number(order.tax).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
                  <span className="text-gray-900">Total</span>
                  <span className="text-pink-600">${Number(order.total).toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Payment */}
        <div className="space-y-6">
          <Card variant="bordered">
            <CardContent className="p-6">
              <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Payment
              </h2>

              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <Badge
                    variant={paymentStatusVariants[order.paymentStatus] || 'warning'}
                    className="mt-1"
                  >
                    {order.paymentStatus}
                  </Badge>
                </div>

                <div>
                  <p className="text-sm text-gray-500">Amount</p>
                  <p className="text-2xl font-bold text-gray-900">
                    ${Number(order.total).toFixed(2)}
                  </p>
                </div>

                {/* Show charge card option if payment is not succeeded */}
                {order.paymentStatus !== 'succeeded' && (
                  <div className="pt-4 border-t border-gray-100">
                    <p className="text-sm font-medium text-gray-900 mb-3">
                      Charge Customer Card
                    </p>

                    {paymentMethods.length > 0 ? (
                      <>
                        <select
                          value={selectedPaymentMethod}
                          onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3"
                        >
                          {paymentMethods.map((pm) => (
                            <option key={pm.id} value={pm.id}>
                              {pm.brand.toUpperCase()} •••• {pm.last4}
                              {pm.isDefault ? ' (Default)' : ''}
                            </option>
                          ))}
                        </select>

                        <Button
                          onClick={handleChargeCard}
                          disabled={charging || !selectedPaymentMethod}
                          className="w-full"
                        >
                          {charging ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Charging...
                            </>
                          ) : (
                            <>
                              <DollarSign className="w-4 h-4 mr-2" />
                              Charge ${Number(order.total).toFixed(2)}
                            </>
                          )}
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-gray-500">
                        No payment methods on file for this customer.
                      </p>
                    )}

                    {chargeError && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
                        <AlertCircle className="w-4 h-4" />
                        {chargeError}
                      </div>
                    )}

                    {chargeSuccess && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-green-600">
                        <CheckCircle className="w-4 h-4" />
                        Payment successful!
                      </div>
                    )}
                  </div>
                )}

                {order.paymentStatus === 'succeeded' && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">Payment Complete</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card variant="bordered">
            <CardContent className="p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Quick Actions</h2>
              <div className="space-y-2">
                <Link
                  href={`/admin/customers/${order.user.id}`}
                  className="block w-full"
                >
                  <Button variant="outline" className="w-full justify-start">
                    <User className="w-4 h-4 mr-2" />
                    View Customer Profile
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
