'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Badge,
} from '@/components/ui'
import { formatDate, formatCurrency } from '@/lib/utils'
import { MapPin, ChevronRight, Pencil } from 'lucide-react'

interface OrderItemData {
  id: string
  itemType: string
  description: string
  quantity: number
  totalPrice: number | string
}

interface OrderData {
  id: string
  orderNumber: string
  createdAt: string
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  status: string
  total: number | string
  orderItems: OrderItemData[]
  postType?: { name: string } | null
  // team view: which agent this order was placed for (free-text attribution)
  placedForAgentName?: string | null
}

interface OrderHistoryTableProps {
  orders: OrderData[]
}

const statusConfig: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral' }> = {
  pending: { label: 'Pending', variant: 'warning' },
  confirmed: { label: 'Confirmed', variant: 'info' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  in_progress: { label: 'In Progress', variant: 'info' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'error' },
}

const isEditable = (status: string) => status !== 'completed' && status !== 'cancelled'

const OrderHistoryTable = ({ orders }: OrderHistoryTableProps) => {
  const router = useRouter()
  const getItemSummary = (items: OrderItemData[]) => {
    const types: string[] = []
    const postItem = items.find(i => i.itemType === 'post')
    const signItem = items.find(i => i.itemType === 'sign')
    const riderItems = items.filter(i => i.itemType === 'rider')
    const lockboxItem = items.find(i => i.itemType === 'lockbox')
    const brochureItem = items.find(i => i.itemType === 'brochure_box')

    if (postItem) types.push('Post')
    if (signItem) types.push('Sign')
    if (riderItems.length > 0) types.push(`${riderItems.length} Rider${riderItems.length > 1 ? 's' : ''}`)
    if (lockboxItem) types.push('Lockbox')
    if (brochureItem) types.push('Brochure Box')

    return types.join(', ') || `${items.length} item${items.length !== 1 ? 's' : ''}`
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {orders.map((order) => {
          const config = statusConfig[order.status] || statusConfig.pending
          return (
            <Link
              key={order.id}
              href={`/dashboard/orders/${order.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">#{order.orderNumber}</p>
                    <Badge variant={config.variant}>{config.label}</Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{formatDate(order.createdAt)}</p>
                  {order.placedForAgentName && (
                    <p className="text-xs text-pink-600 mt-0.5">For: {order.placedForAgentName}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isEditable(order.status) && (
                    // A <button>, not a <Link>: this card is itself wrapped in a
                    // <Link>, and nesting <a> inside <a> is invalid HTML (causes
                    // a hydration error).
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        router.push(`/dashboard/orders/${order.id}/edit`)
                      }}
                      className="p-2 text-gray-400 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-colors"
                      aria-label="Edit order"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </div>
              </div>
              <div className="flex items-start gap-2 mb-2">
                <MapPin className="w-4 h-4 text-pink-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{order.propertyAddress}</p>
                  <p className="text-xs text-gray-500">{order.propertyCity}, {order.propertyState} {order.propertyZip}</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-500">{getItemSummary(order.orderItems)}</p>
                <p className="font-semibold text-gray-900">{formatCurrency(Number(order.total))}</p>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const config = statusConfig[order.status] || statusConfig.pending
                return (
                  <TableRow key={order.id} className="group">
                    <TableCell>
                      <Link href={`/dashboard/orders/${order.id}`} className="font-medium text-pink-600 hover:text-pink-700">
                        {order.orderNumber}
                      </Link>
                      {order.placedForAgentName && (
                        <p className="text-xs text-gray-500 mt-0.5">For: {order.placedForAgentName}</p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-gray-600">
                      {formatDate(order.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-gray-900">{order.propertyAddress}</p>
                        <p className="text-sm text-gray-500">{order.propertyCity}, {order.propertyState} {order.propertyZip}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-gray-600">{getItemSummary(order.orderItems)}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={config.variant}>{config.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(Number(order.total))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/dashboard/orders/${order.id}`}
                          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                          title="View details"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                        {isEditable(order.status) && (
                          <Link
                            href={`/dashboard/orders/${order.id}/edit`}
                            className="p-2 text-gray-400 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-colors"
                            title="Edit order"
                          >
                            <Pencil className="w-4 h-4" />
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {orders.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            No orders found.
          </div>
        )}
      </div>
    </>
  )
}

export { OrderHistoryTable }
export type { OrderData, OrderItemData }
