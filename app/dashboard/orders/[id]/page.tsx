'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Header, CompletePaymentButton } from '@/components/dashboard'
import { Card, CardContent, Button, Badge, Modal } from '@/components/ui'
import { easternMidnightMs } from '@/lib/scheduling'
import {
  MapPin,
  Calendar,
  CreditCard,
  ArrowLeft,
  Loader2,
  Package,
  Clock,
  CheckCircle,
  XCircle,
  Truck,
  FileText,
  Pencil,
  AlertTriangle,
  CalendarClock,
} from 'lucide-react'

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
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  propertyType: string
  propertyNotes: string | null
  scheduledDate: string | null
  isExpedited: boolean
  subtotal: number | string
  fuelSurcharge: number | string
  noPostSurcharge: number | string
  expediteFee: number | string
  discount: number | string
  tax: number | string
  total: number | string
  promoCode?: {
    code: string
  } | null
  status: string
  paymentStatus: string
  createdAt: string
  updatedAt: string
  paidAt: string | null
  refundId: string | null
  refundInitiatedAt: string | null
  refundedAt: string | null
  refundedAmount: number | null
  cancelledAt: string | null
  orderItems: OrderItem[]
  postType: {
    name: string
    description: string | null
  }
}

const statusConfig: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral'; icon: typeof Clock }> = {
  pending: { label: 'Pending', variant: 'warning', icon: Clock },
  confirmed: { label: 'Confirmed', variant: 'info', icon: FileText },
  scheduled: { label: 'Scheduled', variant: 'info', icon: Calendar },
  in_progress: { label: 'In Progress', variant: 'info', icon: Truck },
  completed: { label: 'Completed', variant: 'success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', variant: 'error', icon: XCircle },
}

const statusTimeline = ['pending', 'confirmed', 'scheduled', 'in_progress', 'completed']

export default function OrderDetailsPage() {
  const params = useParams()
  const orderId = params.id as string
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  // Edit-charge toast: review-step.tsx writes the post-save chargeOutcome
  // here when redirecting from the edit page so we can surface charge_failed
  // / credit_pending / no_payment_method to the customer without making them
  // hunt through their email.
  const [editChargeToast, setEditChargeToast] = useState<{ kind: string; diff?: number; netDiff?: number; cardLast4?: string | null; cardBrand?: string | null } | null>(null)
  useEffect(() => {
    if (!orderId) return
    try {
      const raw = sessionStorage.getItem(`edit-charge-toast:${orderId}`)
      if (raw) {
        setEditChargeToast(JSON.parse(raw))
        sessionStorage.removeItem(`edit-charge-toast:${orderId}`)
      }
    } catch {
      // sessionStorage unavailable; just skip the toast.
    }
  }, [orderId])

  async function fetchOrder() {
    if (!orderId) {
      setError('No order ID provided')
      setLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Order not found')
        }
        throw new Error('Failed to fetch order')
      }
      const data = await res.json()
      setOrder(data.order)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load order details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrder()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  // createdAt is a real timestamp — render in local time ("Placed on …")
  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  // scheduledDate is a date-only field stored at noon UTC — render in UTC so
  // the calendar date doesn't shift back a day in US timezones.
  const formatShortDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }

  // 24h cutoff is measured against Eastern midnight of the scheduled date
  // (matches the server-side gate in /api/orders/[id]/cancel). Using UTC
  // here would show or hide the Cancel button up to 4h off the real cutoff
  // — confusing UX (server is authoritative either way).
  // Null scheduledDate (Next Available) skips the cutoff.
  const canCancel = (o: Order): boolean => {
    if (['in_progress', 'completed', 'cancelled'].includes(o.status)) return false
    if (o.paymentStatus !== 'succeeded') return false
    if (o.refundId) return false
    if (!o.scheduledDate) return true
    const cutoff = easternMidnightMs(new Date(o.scheduledDate)) - 24 * 60 * 60 * 1000
    return cutoff > Date.now()
  }

  if (loading) {
    return (
      <div>
        <Header title="Order Details" />
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
            <p className="text-gray-500">Loading order details...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div>
        <Header title="Order Details" />
        <div className="p-6">
          <Card variant="bordered">
            <CardContent className="p-8 text-center">
              <XCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">{error || 'Order not found'}</p>
              <Link href="/dashboard/order-history">
                <Button>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Order History
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const currentStatus = statusConfig[order.status] || statusConfig.pending
  const StatusIcon = currentStatus.icon
  const currentStatusIndex = statusTimeline.indexOf(order.status)
  const isCancelled = order.status === 'cancelled'

  return (
    <div>
      <Header title="Order Details" />

      <div className="p-6 max-w-4xl mx-auto">
        {/* Back Link */}
        <Link
          href="/dashboard/order-history"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Order History
        </Link>

        {/* Complete Payment banner — only renders if order has unresolved payment intent */}
        {order.paymentStatus !== 'succeeded' && order.status !== 'cancelled' && (
          <CompletePaymentButton orderId={order.id} amount={Number(order.total)} />
        )}

        {/* Edit-charge toast — surfaces the outcome of the most recent edit's
            diff charge after a save-and-redirect from the edit page. Cleared
            on next refresh (sessionStorage was consumed on mount). */}
        {editChargeToast && (
          <div
            className={`mb-4 p-4 rounded-xl border ${
              editChargeToast.kind === 'charged_diff'
                ? 'bg-green-50 border-green-200 text-green-900'
                : editChargeToast.kind === 'credit_pending'
                  ? 'bg-blue-50 border-blue-200 text-blue-900'
                  : editChargeToast.kind === 'invoice_billing_skip'
                    ? 'bg-blue-50 border-blue-200 text-blue-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {editChargeToast.kind === 'charged_diff' && (
              <p className="text-sm">
                <strong>Saved.</strong> ${(editChargeToast.netDiff ?? 0).toFixed(2)} charged
                {editChargeToast.cardBrand && editChargeToast.cardLast4
                  ? ` to ${editChargeToast.cardBrand.toUpperCase()} •••• ${editChargeToast.cardLast4}`
                  : ' to card on file'}. Receipt sent by email.
              </p>
            )}
            {editChargeToast.kind === 'credit_pending' && (
              <p className="text-sm">
                <strong>Saved.</strong> Refund of ${Math.abs(editChargeToast.diff ?? 0).toFixed(2)} coming back — the Pink Posts team will issue this manually to your card in the next few business days. Reach out at 859-395-8188 if you don&apos;t see it within a week.
              </p>
            )}
            {editChargeToast.kind === 'invoice_billing_skip' && (
              <p className="text-sm">
                <strong>Saved.</strong> Difference of ${Math.abs(editChargeToast.diff ?? 0).toFixed(2)} will be reflected on the next invoice.
              </p>
            )}
            {editChargeToast.kind === 'charge_failed' && (
              <p className="text-sm">
                <strong>Saved, but charge failed.</strong> ${Math.abs(editChargeToast.diff ?? 0).toFixed(2)} declined — Pink Posts will reach out to collect.
              </p>
            )}
            {editChargeToast.kind === 'no_payment_method' && (
              <p className="text-sm">
                <strong>Saved.</strong> ${Math.abs(editChargeToast.diff ?? 0).toFixed(2)} owed — no card on file. Pink Posts will reach out to collect.
              </p>
            )}
          </div>
        )}

        {/* Order Header */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-gray-900">
                    Order {order.orderNumber}
                  </h2>
                  <Badge variant={currentStatus.variant}>
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {currentStatus.label}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Placed on {formatDate(order.createdAt)}
                </p>
              </div>
              {order.isExpedited && (
                <Badge variant="warning" className="self-start">
                  Expedited
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Timeline */}
        {!isCancelled && (
          <Card variant="bordered" className="mb-6">
            <CardContent className="p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Order Progress</h3>
              <div className="flex items-center justify-between">
                {statusTimeline.map((status, index) => {
                  const config = statusConfig[status]
                  const Icon = config.icon
                  const isCompleted = index <= currentStatusIndex
                  const isCurrent = index === currentStatusIndex

                  return (
                    <div key={status} className="flex flex-col items-center flex-1">
                      <div className="flex items-center w-full">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            isCompleted
                              ? 'bg-pink-600 text-white'
                              : 'bg-gray-200 text-gray-400'
                          } ${isCurrent ? 'ring-2 ring-pink-300' : ''}`}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        {index < statusTimeline.length - 1 && (
                          <div
                            className={`flex-1 h-1 mx-2 ${
                              index < currentStatusIndex ? 'bg-pink-600' : 'bg-gray-200'
                            }`}
                          />
                        )}
                      </div>
                      <span
                        className={`text-xs mt-2 text-center ${
                          isCompleted ? 'text-gray-900 font-medium' : 'text-gray-400'
                        }`}
                      >
                        {config.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cancelled Notice */}
        {isCancelled && (
          <Card className="bg-red-50 border-red-200 mb-6">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-red-800">Order Cancelled</h3>
                  {order.cancelledAt && order.refundedAt && order.refundedAmount !== null ? (
                    <p className="text-red-700">
                      Cancelled on {formatDate(order.cancelledAt)} — Refund of $
                      {Number(order.refundedAmount).toFixed(2)} processed on{' '}
                      {formatDate(order.refundedAt)}
                    </p>
                  ) : order.cancelledAt && order.refundInitiatedAt ? (
                    <p className="text-red-700">
                      Cancelled on {formatDate(order.cancelledAt)} — Refund of $
                      {Number(order.total).toFixed(2)} processing (5-10 business days)
                    </p>
                  ) : (
                    <p className="text-red-700">
                      This order was cancelled. Please contact support if you have questions.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Order Details */}
          <Card variant="bordered">
            <CardContent className="p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Order Details</h3>

              {/* Property */}
              <div className="flex items-start gap-3 mb-4 pb-4 border-b border-gray-100">
                <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-500">Installation Address</p>
                  <p className="font-medium text-gray-900">{order.propertyAddress}</p>
                  <p className="text-gray-600">
                    {order.propertyCity}, {order.propertyState} {order.propertyZip}
                  </p>
                  <p className="text-sm text-gray-500 mt-1 capitalize">
                    {order.propertyType.replace('_', ' ')} property
                  </p>
                </div>
              </div>

              {/* Post Type */}
              {order.postType && (
                <div className="flex items-start gap-3 mb-4 pb-4 border-b border-gray-100">
                  <Package className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm text-gray-500">Sign Post Type</p>
                    <p className="font-medium text-gray-900">{order.postType.name}</p>
                    {order.postType.description && (
                      <p className="text-sm text-gray-500">{order.postType.description}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Schedule */}
              <div className="flex items-start gap-3 mb-4 pb-4 border-b border-gray-100">
                <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-500">Requested Installation</p>
                  <p className="font-medium text-gray-900">
                    {order.isExpedited
                      ? 'Same Day (Expedited)'
                      : order.scheduledDate
                      ? formatShortDate(order.scheduledDate)
                      : 'Next Available'}
                  </p>
                </div>
              </div>

              {/* Payment */}
              <div className="flex items-start gap-3">
                <CreditCard className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-500">Payment Status</p>
                  <p className="font-medium text-gray-900 capitalize">
                    {order.paymentStatus === 'succeeded' ? 'Paid' : order.paymentStatus}
                  </p>
                </div>
              </div>

              {/* Installation Notes */}
              {order.propertyNotes && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500 mb-1">Installation Notes</p>
                  <p className="text-gray-700 text-sm">{order.propertyNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Summary */}
          <Card variant="bordered">
            <CardContent className="p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Order Summary</h3>

              <div className="space-y-3">
                {order.orderItems.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <div className="flex-1">
                      <span className="text-gray-900">{item.description}</span>
                      {item.quantity > 1 && (
                        <span className="text-gray-500"> (x{item.quantity})</span>
                      )}
                      {item.itemCategory && (
                        <p className="text-xs text-gray-500 capitalize">
                          {item.itemCategory.replace('_', ' ')}
                        </p>
                      )}
                    </div>
                    <span className="font-medium text-gray-900 ml-4">
                      ${Number(item.totalPrice).toFixed(2)}
                    </span>
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
                {Number(order.fuelSurcharge) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Fuel Surcharge</span>
                    <span className="text-gray-900">${Number(order.fuelSurcharge).toFixed(2)}</span>
                  </div>
                )}
                {Number(order.noPostSurcharge) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Service Trip Fee (no post)</span>
                    <span className="text-gray-900">${Number(order.noPostSurcharge).toFixed(2)}</span>
                  </div>
                )}
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

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mt-6">
          <Link href="/dashboard/order-history" className="flex-1">
            <Button variant="outline" className="w-full">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Orders
            </Button>
          </Link>
          {order.status !== 'completed' && order.status !== 'cancelled' && (
            <Link href={`/dashboard/orders/${order.id}/edit`} className="flex-1">
              <Button variant="outline" className="w-full">
                <Pencil className="w-4 h-4 mr-2" />
                Edit Order
              </Button>
            </Link>
          )}
          {/* Change Install Date — narrow date-only update, separate from the
              full Edit Order wizard so it still works on an already-invoiced
              order (the wizard blocks those since it touches pricing). */}
          {order.status !== 'completed' && order.status !== 'cancelled' && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setRescheduleOpen(true)}
            >
              <CalendarClock className="w-4 h-4 mr-2" />
              Change Install Date
            </Button>
          )}
          {order.status === 'completed' && (
            <Link href="/dashboard" className="flex-1">
              <Button className="w-full">View Installation</Button>
            </Link>
          )}
          {order.status !== 'completed' && order.status !== 'cancelled' && (
            <Link href="/dashboard/place-order" className="flex-1">
              <Button className="w-full">Place Another Order</Button>
            </Link>
          )}
          {canCancel(order) && (
            <Button
              variant="outline"
              className="flex-1 border-red-500 text-red-600 hover:bg-red-50 focus:ring-red-500"
              onClick={() => setCancelOpen(true)}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Cancel Order
            </Button>
          )}
        </div>
      </div>

      <CancelOrderModal
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        orderId={order.id}
        amount={Number(order.total)}
        onSuccess={() => {
          setCancelOpen(false)
          fetchOrder()
        }}
      />

      <RescheduleModal
        isOpen={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        orderId={order.id}
        currentDate={order.scheduledDate}
        onSuccess={() => {
          setRescheduleOpen(false)
          fetchOrder()
        }}
      />
    </div>
  )
}

interface CancelOrderModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  amount: number
  onSuccess: () => void
}

type CancelStep = 'initial' | 'high-value' | 'submitting' | 'done' | 'error'

function CancelOrderModal({ isOpen, onClose, orderId, amount, onSuccess }: CancelOrderModalProps) {
  const [step, setStep] = useState<CancelStep>('initial')
  const [reason, setReason] = useState('')
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Reset state whenever the modal is reopened
  useEffect(() => {
    if (isOpen) {
      setStep('initial')
      setReason('')
      setConfirmMessage(null)
      setErrorMessage(null)
    }
  }, [isOpen])

  async function submit(confirmed: boolean) {
    setStep('submitting')
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed, reason: reason.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data?.requiresConfirmation) {
        setConfirmMessage(data.message || 'This order is $250 or more. Please confirm the refund.')
        setStep('high-value')
        return
      }

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to cancel order')
      }

      setStep('done')
      onSuccess()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong')
      setStep('error')
    }
  }

  const submitting = step === 'submitting'

  return (
    <Modal isOpen={isOpen} onClose={submitting ? () => {} : onClose} title="Cancel Order">
      {step === 'high-value' ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-md bg-amber-50 border border-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">{confirmMessage}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Keep Order
            </Button>
            <Button
              variant="danger"
              onClick={() => submit(true)}
              isLoading={submitting}
            >
              Yes, Refund ${amount.toFixed(2)}
            </Button>
          </div>
        </div>
      ) : step === 'error' ? (
        <div className="space-y-4">
          <p className="text-sm text-error">{errorMessage}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => setStep('initial')}>Try Again</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Cancel this order? This will refund{' '}
            <span className="font-semibold">${amount.toFixed(2)}</span> to your card.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              rows={3}
              maxLength={500}
              className="block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all duration-200"
              placeholder="Tell us why you're cancelling (optional)"
            />
            <p className="text-xs text-gray-400 mt-1">{reason.length} / 500</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Keep Order
            </Button>
            <Button
              variant="danger"
              onClick={() => submit(false)}
              isLoading={submitting}
            >
              Confirm Cancellation
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

interface RescheduleModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  currentDate: string | null
  onSuccess: () => void
}

function RescheduleModal({ isOpen, onClose, orderId, currentDate, onSuccess }: RescheduleModalProps) {
  const [date, setDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setDate(currentDate ? currentDate.slice(0, 10) : '')
      setSubmitting(false)
      setErrorMessage(null)
    }
  }, [isOpen, currentDate])

  async function submit() {
    if (!date) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requested_date: date }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to update install date')
      }
      onSuccess()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={submitting ? () => {} : onClose} title="Change Install Date">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Pick a new install date. This only updates the schedule — items and pricing on this order don&apos;t change.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">New date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="block w-full rounded-md border border-gray-300 bg-white px-4 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all duration-200"
          />
        </div>
        {errorMessage && (
          <p className="text-sm text-error">{errorMessage}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !date} isLoading={submitting}>
            Save New Date
          </Button>
        </div>
      </div>
    </Modal>
  )
}
