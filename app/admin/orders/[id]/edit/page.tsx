'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, Button } from '@/components/ui'
import { ArrowLeft, AlertCircle, ShieldAlert } from 'lucide-react'
import { OrderWizard } from '@/components/order-flow'
import type { OrderFormData } from '@/components/order-flow'
import {
  orderToFormData,
  augmentInventoryWithOrder,
  type OrderLike,
  type WizardInventory,
} from '@/lib/orders/order-to-formdata'

/**
 * Admin-side mirror of /dashboard/orders/[id]/edit. Per Ryan's ask:
 * admin can fix items/notes/dates on a pending order without emailing the
 * agent. Same wizard, same PATCH /api/orders/[id]/edit (which now allows
 * admin role), same [EDITED] re-notification to install crew — PLUS a new
 * "Order Updated by Support" email to the customer when admin is the editor
 * (handled server-side by the edit route's actor.role check).
 *
 * Inventory caveat: the wizard's "from inventory" pickers call /api/inventory
 * which is scoped to the LOGGED-IN user — so admin sees their own (likely
 * empty) inventory, not the customer's. Existing line items merge in via
 * augmentInventoryWithOrder so they still display correctly. For v1 most
 * admin edits are address / notes / scheduling fixes, not item swaps. A
 * follow-up could add /api/admin/users/[userId]/inventory if item swaps
 * become common.
 */
export default function AdminEditOrderPage() {
  const params = useParams()
  const orderId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState<OrderFormData | null>(null)
  const [inventory, setInventory] = useState<WizardInventory | undefined>()
  const [editMeta, setEditMeta] = useState<{ orderNumber: string; originalTotal: number } | null>(null)
  const [freeLockboxInstall, setFreeLockboxInstall] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        const [orderRes, inventoryRes] = await Promise.all([
          fetch(`/api/orders/${orderId}`),
          fetch('/api/inventory'),
        ])

        if (!orderRes.ok) {
          throw new Error(orderRes.status === 404 ? 'Order not found' : 'Failed to load order')
        }

        const orderData = await orderRes.json()
        const order = orderData.order as OrderLike & { id: string; orderNumber: string; status: string; total: number | string }

        if (order.status === 'completed' || order.status === 'cancelled') {
          throw new Error('This order can no longer be edited (completed or cancelled).')
        }

        const rawInventory: WizardInventory | undefined = inventoryRes.ok
          ? await inventoryRes.json()
          : undefined

        setInventory(augmentInventoryWithOrder(rawInventory, order))
        setFormData(orderToFormData(order))
        setEditMeta({ orderNumber: order.orderNumber, originalTotal: Number(order.total) })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [orderId])

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error || !formData) {
    return (
      <div className="p-6">
        <Link
          href={`/admin/orders/${orderId}`}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Order
        </Link>
        <Card variant="bordered">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
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
      <Link
        href={`/admin/orders/${orderId}`}
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Order
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Edit Order{editMeta ? ` ${editMeta.orderNumber}` : ''}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Editing on behalf of the customer. They&apos;ll get an &quot;Order Updated by Support&quot; email when you save.
      </p>

      {/* Admin caveat banner — the inventory pickers show the admin's own
          inventory, not the customer's. For property/notes/scheduling edits
          this doesn't matter; for item swaps the existing line items still
          display via augmentInventoryWithOrder but new items would come
          from the admin's inventory list. */}
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900">
          <p className="font-medium mb-1">Heads up — inventory scoping</p>
          <p>
            The existing line items on this order will load correctly. But if you need to swap to a different
            stored sign / rider / lockbox, the picker shows YOUR inventory list, not the customer&apos;s. For most
            admin edits (property address, notes, scheduling) this is fine.
          </p>
        </div>
      </div>

      <div className="mb-6 p-4 bg-pink-50 border border-pink-200 rounded-xl">
        <p className="text-sm text-pink-900">
          Step through any page to make corrections. Use the numbered steps above to jump straight to a
          section. Save your changes on the final step. The customer will receive an updated confirmation
          email and our install crew will get a fresh [EDITED] notification.
        </p>
      </div>

      <OrderWizard
        mode="edit"
        orderId={orderId}
        initialFormData={formData}
        inventory={inventory}
        editMeta={editMeta ?? undefined}
        lockboxInstallFee={freeLockboxInstall ? 0 : undefined}
      />
    </div>
  )
}
