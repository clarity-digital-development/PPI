'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Header, CompletePaymentButton } from '@/components/dashboard'
import { Card, CardContent, Button, Badge } from '@/components/ui'
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

  useEffect(() => {
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

    fetchOrder()
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
                  <p className="text-red-700">
                    This order was cancelled. Please contact support if you have questions.
                  </p>
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
        </div>
      </div>
    </div>
  )
}
