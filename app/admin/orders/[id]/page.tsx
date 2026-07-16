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
  RotateCcw,
  Clock,
  ExternalLink,
  Pencil,
  CalendarClock,
} from 'lucide-react'
import { Button, Badge, Card, CardContent, Modal } from '@/components/ui'

interface PostRentalChargeRow {
  id: string
  chargeType: string
  amountCents: number
  periodStart: string
  periodEnd: string
  status: string
  attemptedAt: string | null
  succeededAt: string | null
  failureCode: string | null
  failureMessage: string | null
  stripePaymentIntentId: string | null
  attemptCount: number
}

interface PostRentalView {
  status: 'active' | 'grandfathered' | 'stopped' | 'disabled' | 'exempt' | 'never_eligible'
  reason?: string
  installedAt: string | null
  stoppedAt: string | null
  override: boolean
  nextCharge: {
    dueDate: string
    chargeType: 'six_month' | 'nine_month' | 'monthly'
    amountCents: number
  } | null
  history: PostRentalChargeRow[]
}

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
  placedForAgentName?: string | null
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
  refundId: string | null
  refundInitiatedAt: string | null
  refundedAt: string | null
  refundedAmount: number | string | null
  cancelledAt: string | null
  // Edit-time diff charge tracking (Round 19)
  editChargeStatus: 'no_change' | 'charged_diff' | 'charge_failed' | 'credit_pending' | 'no_payment_method' | 'invoice_billing_skip' | null
  editChargeLastError: string | null
  lastEditPaymentIntentId: string | null
  lastEditChargedAt: string | null
  pendingCreditCents: number
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
  const [refundModalOpen, setRefundModalOpen] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundBanner, setRefundBanner] = useState<string | null>(null)
  const [postRental, setPostRental] = useState<PostRentalView | null>(null)
  const [retryingChargeId, setRetryingChargeId] = useState<string | null>(null)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [disableSaving, setDisableSaving] = useState(false)
  const [postRentalError, setPostRentalError] = useState<string | null>(null)
  const [postRentalBanner, setPostRentalBanner] = useState<string | null>(null)
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)

  async function loadOrder() {
    const res = await fetch(`/api/admin/orders/${orderId}`)
    if (!res.ok) {
      throw new Error('Failed to fetch order')
    }
    const data = await res.json()
    setOrder(data.order)
    if (data.postRental) setPostRental(data.postRental as PostRentalView)

    if (data.order.user?.stripeCustomerId) {
      const pmRes = await fetch(`/api/admin/customers/${data.order.user.id}/payment-methods`)
      if (pmRes.ok) {
        const pmData = await pmRes.json()
        setPaymentMethods(pmData.paymentMethods || [])
        const defaultPm = pmData.paymentMethods?.find((pm: PaymentMethod) => pm.isDefault)
        if (defaultPm) {
          setSelectedPaymentMethod(defaultPm.id)
        } else if (pmData.paymentMethods?.length > 0) {
          setSelectedPaymentMethod(pmData.paymentMethods[0].id)
        }
      }
    }
  }

  useEffect(() => {
    loadOrder()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load order'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function handleRefundOrder() {
    if (!order) return
    setRefunding(true)
    setRefundError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: refundReason.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to refund order')
      }
      setRefundModalOpen(false)
      setRefundReason('')
      setRefundBanner(`Refund of $${Number(order.total).toFixed(2)} initiated. The broker will be notified once Stripe confirms.`)
      await loadOrder()
    } catch (err) {
      setRefundError(err instanceof Error ? err.message : 'Failed to refund order')
    } finally {
      setRefunding(false)
    }
  }

  async function handleCancelOrder() {
    if (!order) return
    const confirmMsg = `Cancel order ${order.orderNumber}?\n\nThis will:\n• Cancel the Stripe payment attempt\n• Restore any inventory items linked to this order\n• Mark the order as cancelled\n\nThis cannot be undone.`
    if (!confirm(confirmMsg)) return

    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to cancel order')
        return
      }
      setOrder(prev => prev ? { ...prev, status: 'cancelled', paymentStatus: 'failed' } : null)
      const msg = [
        'Order cancelled.',
        data.stripe_cancelled ? 'Stripe payment intent cancelled.' : null,
        data.inventory_restored > 0 ? `${data.inventory_restored} inventory item(s) restored to storage.` : null,
      ].filter(Boolean).join(' ')
      alert(msg)
    } catch (err) {
      console.error('Error cancelling order:', err)
      alert('Could not cancel order — see console for details.')
    }
  }

  // Narrow date-only update — separate from Edit Order (the full wizard)
  // so it still works on an already-invoiced order. Invoices bundle by
  // order-creation date, not install date, so this can't desync an invoice.
  async function handleReschedule() {
    if (!rescheduleDate || !order) return
    setRescheduling(true)
    setRescheduleError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requested_date: rescheduleDate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update install date')
      }
      setRescheduleModalOpen(false)
      setOrder((prev) => prev ? { ...prev, scheduledDate: data.order.scheduledDate } : null)
    } catch (err) {
      setRescheduleError(err instanceof Error ? err.message : 'Failed to update install date')
    } finally {
      setRescheduling(false)
    }
  }

  async function handleRetryCharge(chargeId: string) {
    setRetryingChargeId(chargeId)
    setPostRentalError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/post-rental/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chargeId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Retry failed')
      setPostRentalBanner('Charge re-queued. The next cron run will retry the card.')
      await loadOrder()
    } catch (err) {
      setPostRentalError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetryingChargeId(null)
    }
  }

  async function handleToggleOverride(nextEnabled: boolean) {
    if (overrideSaving) return
    setOverrideSaving(true)
    setPostRentalError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/post-rental/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Toggle failed')
      setPostRentalBanner(
        nextEnabled
          ? 'Post-rental billing enabled for this order.'
          : 'Post-rental billing disabled for this order.'
      )
      await loadOrder()
    } catch (err) {
      setPostRentalError(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setOverrideSaving(false)
    }
  }

  async function handleToggleDisable(nextDisabled: boolean) {
    if (disableSaving) return
    setDisableSaving(true)
    setPostRentalError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/post-rental/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: nextDisabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Toggle failed')
      setPostRentalBanner(
        nextDisabled
          ? 'Post-rental billing disabled for this order (customer-owned post).'
          : 'Post-rental billing re-enabled for this order.'
      )
      await loadOrder()
    } catch (err) {
      setPostRentalError(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setDisableSaving(false)
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
      {/* Refund success banner */}
      {refundBanner && (
        <div className="mb-4 flex items-start justify-between gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-green-800">
            <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <span>{refundBanner}</span>
          </div>
          <button
            onClick={() => setRefundBanner(null)}
            className="text-green-700 hover:text-green-900 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

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

        <div className="flex items-center gap-3">
          {/* Edit Order — admin can fix items/notes/dates on the customer's
              behalf without emailing the agent. Matches the server-side
              gate in PATCH /api/orders/[id]/edit which blocks completed +
              cancelled orders. Opens the same wizard the customer would. */}
          {order.status !== 'completed' && order.status !== 'cancelled' && (
            <Link href={`/admin/orders/${orderId}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="w-4 h-4 mr-1" />
                Edit Order
              </Button>
            </Link>
          )}

          {/* Change Install Date — date-only, works even on an already-
              invoiced order (unlike Edit Order, which blocks those). */}
          {order.status !== 'completed' && order.status !== 'cancelled' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRescheduleError(null)
                setRescheduleDate(order.scheduledDate ? order.scheduledDate.slice(0, 10) : '')
                setRescheduleModalOpen(true)
              }}
            >
              <CalendarClock className="w-4 h-4 mr-1" />
              Change Install Date
            </Button>
          )}

          {/* Cancel button — only for unpaid, non-cancelled orders */}
          {order.paymentStatus !== 'succeeded' && order.status !== 'cancelled' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelOrder}
              className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
            >
              Cancel Order
            </Button>
          )}

          {/* Refund processing badge — refund initiated but not yet reconciled by webhook */}
          {order.refundInitiatedAt && !order.refundedAt && (
            <Badge variant="warning" className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Refund processing
            </Badge>
          )}

          {/* Refund button — only for paid, non-cancelled, not-yet-refunded orders */}
          {order.paymentStatus === 'succeeded' &&
            !order.refundId &&
            order.status !== 'cancelled' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRefundError(null)
                  setRefundReason('')
                  setRefundModalOpen(true)
                }}
                className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Refund Order
              </Button>
            )}

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
              {order.placedForAgentName && (
                <div className="mb-4 p-3 bg-pink-50 border border-pink-200 rounded-lg">
                  <p className="text-xs font-semibold text-pink-700 uppercase tracking-wide">Sold by agent</p>
                  <p className="font-semibold text-gray-900">{order.placedForAgentName}</p>
                </div>
              )}
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

          {/* Post-Rental Billing card — admin visibility into the rental
              schedule for this order (status, next charge, history, retry,
              opt-in toggle). */}
          {postRental && (
            <PostRentalCard
              view={postRental}
              banner={postRentalBanner}
              error={postRentalError}
              retryingChargeId={retryingChargeId}
              overrideSaving={overrideSaving}
              disableSaving={disableSaving}
              onDismissBanner={() => setPostRentalBanner(null)}
              onDismissError={() => setPostRentalError(null)}
              onRetry={handleRetryCharge}
              onToggleOverride={handleToggleOverride}
              onToggleDisable={handleToggleDisable}
            />
          )}
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

                {/* Last edit charge — surfaces the outcome of the most
                    recent order edit's diff charge so admin doesn't have to
                    open Stripe to reconcile. Only renders when the order
                    has been edited (editChargeStatus != null). */}
                {order.editChargeStatus && order.editChargeStatus !== 'no_change' && (
                  <div className="pt-4 border-t border-gray-100">
                    <p className="text-sm font-medium text-gray-900 mb-2">Last edit charge</p>
                    {order.editChargeStatus === 'charged_diff' && (
                      <div className="text-sm">
                        <Badge variant="success">Charged</Badge>
                        {order.lastEditPaymentIntentId && order.lastEditPaymentIntentId !== 'credit_offset' && (
                          <a
                            href={`https://dashboard.stripe.com/payments/${order.lastEditPaymentIntentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mt-2 text-pink-600 hover:text-pink-700 underline text-xs font-mono"
                          >
                            {order.lastEditPaymentIntentId.slice(0, 18)}…
                          </a>
                        )}
                        {order.lastEditPaymentIntentId === 'credit_offset' && (
                          <p className="mt-2 text-xs text-gray-600">Fully covered by prior credit — no Stripe charge.</p>
                        )}
                        {order.lastEditChargedAt && (
                          <p className="mt-1 text-xs text-gray-500">
                            {new Date(order.lastEditChargedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                    {order.editChargeStatus === 'charge_failed' && (
                      <div className="text-sm">
                        <Badge variant="error">Charge failed</Badge>
                        {order.editChargeLastError && (
                          <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                            {order.editChargeLastError}
                          </p>
                        )}
                        <p className="mt-2 text-xs text-gray-600">
                          Collect manually via Stripe dashboard.
                        </p>
                      </div>
                    )}
                    {order.editChargeStatus === 'no_payment_method' && (
                      <div className="text-sm">
                        <Badge variant="warning">No card on file</Badge>
                        {order.editChargeLastError && (
                          <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                            {order.editChargeLastError}
                          </p>
                        )}
                      </div>
                    )}
                    {order.editChargeStatus === 'credit_pending' && (
                      <div className="text-sm">
                        <Badge variant="info">Credit owed</Badge>
                        <p className="mt-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
                          Customer owed ${(order.pendingCreditCents / 100).toFixed(2)}. Issue refund manually via Stripe dashboard.
                        </p>
                      </div>
                    )}
                    {order.editChargeStatus === 'invoice_billing_skip' && (
                      <div className="text-sm">
                        <Badge variant="neutral">Invoice billing — diff folded into next invoice</Badge>
                      </div>
                    )}
                  </div>
                )}

                {/* Pending credit balance (non-zero) — separate from
                    editChargeStatus so it surfaces even when the most-recent
                    edit didn't itself produce a credit (e.g. legacy balance
                    from a prior negative-diff edit). As of 2026-06-29 positive
                    diffs no longer auto-net against this balance, so it only
                    decreases when admin manually issues the Stripe refund. */}
                {order.pendingCreditCents > 0 && order.editChargeStatus !== 'credit_pending' && (
                  <div className="pt-4 border-t border-gray-100">
                    <p className="text-sm font-medium text-gray-900 mb-2">Unresolved credit</p>
                    <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
                      Customer owed <strong>${(order.pendingCreditCents / 100).toFixed(2)}</strong> from a prior edit. Issue refund manually via Stripe.
                    </p>
                  </div>
                )}

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

      {/* Refund confirmation modal */}
      <Modal
        isOpen={refundModalOpen}
        onClose={() => {
          if (refunding) return
          setRefundModalOpen(false)
          setRefundError(null)
        }}
        title="Refund Order"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Refund <span className="font-semibold">${Number(order.total).toFixed(2)}</span> to the
            customer&rsquo;s card? This cancels the order and notifies the broker. Refunds take
            5&ndash;10 business days.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-gray-400 font-normal">(optional, internal note)</span>
            </label>
            <textarea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              placeholder="e.g. Duplicate order, customer request"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              disabled={refunding}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{refundReason.length}/500</p>
          </div>

          {refundError && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{refundError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setRefundModalOpen(false)
                setRefundError(null)
              }}
              disabled={refunding}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRefundOrder}
              disabled={refunding}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {refunding ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Refunding...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Refund ${Number(order.total).toFixed(2)}
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Change Install Date modal */}
      <Modal
        isOpen={rescheduleModalOpen}
        onClose={() => {
          if (rescheduling) return
          setRescheduleModalOpen(false)
          setRescheduleError(null)
        }}
        title="Change Install Date"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Pick a new install date for order {order.orderNumber}. This only updates the schedule —
            items and pricing don&rsquo;t change, and it works even if this order is already invoiced.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New date</label>
            <input
              type="date"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              disabled={rescheduling}
            />
          </div>
          {rescheduleError && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{rescheduleError}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setRescheduleModalOpen(false)
                setRescheduleError(null)
              }}
              disabled={rescheduling}
            >
              Cancel
            </Button>
            <Button onClick={handleReschedule} disabled={rescheduling || !rescheduleDate}>
              {rescheduling ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CalendarClock className="w-4 h-4 mr-2" />
                  Save New Date
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ============================================
// PostRentalCard — admin visibility for the post-rental schedule on this
// order. Status badge + next-charge preview + history table + retry button
// (failed rows only) + per-order opt-in toggle. Pure presentational; all
// state and handlers live in the parent.
// ============================================

const statusBadgeVariant: Record<
  PostRentalView['status'],
  'success' | 'info' | 'neutral' | 'warning' | 'error'
> = {
  active: 'success',
  grandfathered: 'neutral',
  stopped: 'info',
  disabled: 'warning',
  exempt: 'info',
  never_eligible: 'neutral',
}

const statusLabel: Record<PostRentalView['status'], string> = {
  active: 'Active',
  grandfathered: 'Grandfathered',
  stopped: 'Stopped (pickup)',
  disabled: 'Disabled (own post)',
  exempt: 'Exempt',
  never_eligible: 'Not eligible',
}

const chargeTypeLabel: Record<string, string> = {
  six_month: '6-month anchor',
  nine_month: '9-month anchor',
  monthly: 'Monthly',
}

const chargeStatusVariant: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  scheduled: 'info',
  attempting: 'warning',
  succeeded: 'success',
  failed: 'error',
  skipped: 'neutral',
}

function formatPRDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatPRDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatPRMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function PostRentalCard(props: {
  view: PostRentalView
  banner: string | null
  error: string | null
  retryingChargeId: string | null
  overrideSaving: boolean
  disableSaving: boolean
  onDismissBanner: () => void
  onDismissError: () => void
  onRetry: (chargeId: string) => void
  onToggleOverride: (nextEnabled: boolean) => void
  onToggleDisable: (nextDisabled: boolean) => void
}) {
  const {
    view,
    banner,
    error,
    retryingChargeId,
    overrideSaving,
    disableSaving,
    onDismissBanner,
    onDismissError,
    onRetry,
    onToggleOverride,
    onToggleDisable,
  } = props

  return (
    <Card variant="bordered">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-400" />
            Post-Rental Billing
          </h2>
          <Badge variant={statusBadgeVariant[view.status]}>{statusLabel[view.status]}</Badge>
        </div>

        {banner && (
          <div className="mb-4 flex items-start justify-between gap-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <div className="flex items-start gap-2 text-sm text-green-800">
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{banner}</span>
            </div>
            <button onClick={onDismissBanner} className="text-green-700 text-xs font-medium">
              Dismiss
            </button>
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-start justify-between gap-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <div className="flex items-start gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={onDismissError} className="text-red-700 text-xs font-medium">
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm">
          <div>
            <p className="text-gray-500">Clock started</p>
            <p className="font-medium text-gray-900">{formatPRDate(view.installedAt)}</p>
          </div>
          {view.stoppedAt && (
            <div>
              <p className="text-gray-500">Stopped at</p>
              <p className="font-medium text-gray-900">{formatPRDate(view.stoppedAt)}</p>
            </div>
          )}
          {view.reason && (
            <div className="md:col-span-2">
              <p className="text-gray-500">Reason</p>
              <p className="text-gray-700">{view.reason}</p>
            </div>
          )}
        </div>

        {view.status === 'active' && (
          <div className="mb-4 p-3 bg-pink-50 border border-pink-200 rounded-lg">
            {view.nextCharge ? (
              <p className="text-sm text-gray-800">
                <span className="font-semibold">Next charge:</span>{' '}
                {formatPRMoney(view.nextCharge.amountCents)} on{' '}
                {formatPRDate(view.nextCharge.dueDate)}{' '}
                <span className="text-gray-500">
                  ({chargeTypeLabel[view.nextCharge.chargeType] || view.nextCharge.chargeType})
                </span>
              </p>
            ) : (
              <p className="text-sm text-gray-600">No upcoming charges scheduled.</p>
            )}
          </div>
        )}

        {view.status !== 'exempt' && (
          <div className="mb-4 flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-sm">
              <p className="font-medium text-gray-900">
                Disable post-rental billing (customer-owned post)
              </p>
              <p className="text-gray-500 text-xs mt-0.5">
                Turn on when the agent supplied their own post — PPI charges no
                recurring rental for this order. Overrides the opt-in below.
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={view.status === 'disabled'}
                disabled={disableSaving}
                onChange={(e) => onToggleDisable(e.target.checked)}
                className="sr-only peer"
              />
              <div
                className={`relative w-11 h-6 bg-gray-300 rounded-full peer peer-checked:bg-pink-600 transition-colors ${disableSaving ? 'opacity-50' : ''}`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform ${view.status === 'disabled' ? 'translate-x-5' : ''}`}
                />
              </div>
            </label>
          </div>
        )}

        {(view.status === 'grandfathered' || view.override) && (
          <div className="mb-4 flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-sm">
              <p className="font-medium text-gray-900">
                Enable post-rental billing for this order
              </p>
              <p className="text-gray-500 text-xs mt-0.5">
                Per-order opt-in for grandfathered orders. Use for relationship customers
                negotiated onto the new schedule.
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={view.override}
                disabled={overrideSaving}
                onChange={(e) => onToggleOverride(e.target.checked)}
                className="sr-only peer"
              />
              <div
                className={`relative w-11 h-6 bg-gray-300 rounded-full peer peer-checked:bg-pink-600 transition-colors ${overrideSaving ? 'opacity-50' : ''}`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full transition-transform ${view.override ? 'translate-x-5' : ''}`}
                />
              </div>
            </label>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-gray-900 mb-2">Charge history</p>
          {view.history.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No charges yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3 font-medium">Period</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Attempted</th>
                    <th className="py-2 pr-3 font-medium">Succeeded</th>
                    <th className="py-2 pr-3 font-medium">Stripe</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {view.history.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3 text-gray-700 whitespace-nowrap">
                        {formatPRDate(row.periodStart)} – {formatPRDate(row.periodEnd)}
                      </td>
                      <td className="py-2 pr-3 text-gray-600">
                        {chargeTypeLabel[row.chargeType] || row.chargeType}
                      </td>
                      <td className="py-2 pr-3 text-gray-900 font-medium">
                        {formatPRMoney(row.amountCents)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={chargeStatusVariant[row.status] || 'neutral'}>
                          {row.status}
                        </Badge>
                        {row.status === 'failed' && row.failureMessage && (
                          <p className="text-red-600 text-xs mt-1">
                            {row.failureCode ? `[${row.failureCode}] ` : ''}
                            {row.failureMessage}
                          </p>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                        {formatPRDateTime(row.attemptedAt)}
                        {row.attemptCount > 1 && (
                          <span className="text-gray-400"> ({row.attemptCount}x)</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">
                        {formatPRDateTime(row.succeededAt)}
                      </td>
                      <td className="py-2 pr-3">
                        {row.stripePaymentIntentId ? (
                          <a
                            href={`https://dashboard.stripe.com/payments/${row.stripePaymentIntentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pink-600 hover:underline inline-flex items-center gap-1"
                          >
                            <span className="font-mono">
                              {row.stripePaymentIntentId.slice(0, 12)}…
                            </span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        {row.status === 'failed' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={retryingChargeId === row.id}
                            onClick={() => onRetry(row.id)}
                          >
                            {retryingChargeId === row.id ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Retrying
                              </>
                            ) : (
                              <>
                                <RotateCcw className="w-3 h-3 mr-1" />
                                Retry
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
