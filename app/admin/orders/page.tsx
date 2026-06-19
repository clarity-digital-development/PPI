'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Eye, Check, Clock, Truck, XCircle, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { Select, Badge, Button } from '@/components/ui'

const PAGE_SIZE = 25

interface Order {
  id: string
  order_number: string
  status: string
  payment_status: string
  property_address: string
  property_city: string
  total: number
  created_at: string
  scheduled_date: string | null
  edit_charge_status: 'no_change' | 'charged_diff' | 'charge_failed' | 'credit_pending' | 'no_payment_method' | 'invoice_billing_skip' | null
  edit_charge_last_error: string | null
  last_edit_payment_intent_id: string | null
  pending_credit_cents: number
  profiles: {
    full_name: string
    email: string
    phone: string
  }
}

const statusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'pending':
      return <Clock className="w-4 h-4" />
    case 'confirmed':
    case 'scheduled':
      return <Check className="w-4 h-4" />
    case 'in_progress':
      return <Truck className="w-4 h-4" />
    case 'completed':
      return <Check className="w-4 h-4" />
    case 'cancelled':
      return <XCircle className="w-4 h-4" />
    default:
      return null
  }
}

const getStatusVariant = (status: string): 'info' | 'success' | 'warning' | 'error' | 'neutral' => {
  switch (status) {
    case 'pending':
      return 'warning'
    case 'confirmed':
    case 'scheduled':
      return 'info'
    case 'in_progress':
      return 'info'
    case 'completed':
      return 'success'
    case 'cancelled':
      return 'error'
    default:
      return 'neutral'
  }
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  // Edit-charge worklist toggle — when true, only show orders whose latest
  // edit needs admin follow-up (charge_failed / no_payment_method / credit_pending).
  // Matches the email's "see worklist filter" pointer so admin can click
  // straight from a failed-charge email into the actionable list.
  const [chargeIssuesOnly, setChargeIssuesOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)

  // Reset to the first page whenever any filter changes
  useEffect(() => {
    setPage(0)
  }, [statusFilter, chargeIssuesOnly])

  useEffect(() => {
    async function fetchOrders() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (statusFilter) params.set('status', statusFilter)
        if (chargeIssuesOnly) params.set('charge_issues', 'true')
        params.set('limit', String(PAGE_SIZE))
        params.set('offset', String(page * PAGE_SIZE))

        const res = await fetch(`/api/admin/orders?${params}`)
        if (res.ok) {
          const data = await res.json()
          setOrders(data.orders)
          setTotal(data.total ?? data.orders.length)
        }
      } catch (error) {
        console.error('Error fetching orders:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchOrders()
  }, [statusFilter, chargeIssuesOnly, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function updateOrderStatus(orderId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (res.ok) {
        setOrders((prev) =>
          prev.map((order) =>
            order.id === orderId ? { ...order, status: newStatus } : order
          )
        )
      }
    } catch (error) {
      console.error('Error updating order:', error)
    }
  }

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-600">Manage and track all orders</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <Button
            variant={chargeIssuesOnly ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setChargeIssuesOnly((v) => !v)}
            className="gap-2"
            title="Show only orders whose latest edit needs follow-up: failed charge, no card on file, or credit owed back to customer"
          >
            <AlertTriangle className="w-4 h-4" />
            {chargeIssuesOnly ? 'Charge issues only · clear' : 'Charge issues'}
          </Button>
          <div className="w-full sm:w-48">
            <Select
              options={statusOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Install Date
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Property
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payment
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">
                          {order.scheduled_date
                            ? new Date(order.scheduled_date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                            : 'Next Available'}
                        </p>
                        <p className="text-sm text-gray-500">{order.order_number}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{order.profiles.full_name}</p>
                        <p className="text-sm text-gray-500">{order.profiles.phone}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900">
                        {order.property_address}, {order.property_city}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant={getStatusVariant(order.status)} className="gap-1">
                        {getStatusIcon(order.status)}
                        {order.status}
                      </Badge>
                      {order.edit_charge_status === 'charge_failed' && (
                        <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5" title={order.edit_charge_last_error ?? 'Charge failed'}>
                          <AlertTriangle className="w-3 h-3" /> Charge failed
                        </div>
                      )}
                      {order.edit_charge_status === 'no_payment_method' && (
                        <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5" title={order.edit_charge_last_error ?? 'No payment method'}>
                          <AlertTriangle className="w-3 h-3" /> No card
                        </div>
                      )}
                      {order.edit_charge_status === 'credit_pending' && order.pending_credit_cents > 0 && (
                        <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5" title="Customer owed a refund — issue manually via Stripe">
                          Credit ${(order.pending_credit_cents / 100).toFixed(2)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge
                        variant={
                          order.payment_status === 'succeeded'
                            ? 'success'
                            : order.payment_status === 'failed'
                            ? 'error'
                            : 'warning'
                        }
                      >
                        {order.payment_status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-gray-900">
                      ${order.total.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/admin/orders/${order.id}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="w-4 h-4" />
                          </Button>
                        </Link>
                        <select
                          value={order.status}
                          onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                          className="text-sm border border-gray-200 rounded px-2 py-1"
                        >
                          <option value="pending">Pending</option>
                          <option value="confirmed">Confirmed</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      No orders found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
          <p className="text-sm text-gray-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} orders
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <span className="text-sm text-gray-600">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="gap-1"
            >
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
