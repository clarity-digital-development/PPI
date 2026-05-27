'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Button } from '@/components/ui'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { OrderWizard } from '@/components/order-flow'
import type { OrderFormData } from '@/components/order-flow'
import {
  orderToFormData,
  augmentInventoryWithOrder,
  type OrderLike,
  type WizardInventory,
} from '@/lib/orders/order-to-formdata'

export default function EditOrderPage() {
  const params = useParams()
  const orderId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState<OrderFormData | null>(null)
  const [inventory, setInventory] = useState<WizardInventory | undefined>()
  const [editMeta, setEditMeta] = useState<{ orderNumber: string; originalTotal: number } | null>(null)

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
          throw new Error('This order can no longer be edited')
        }

        const rawInventory: WizardInventory | undefined = inventoryRes.ok
          ? await inventoryRes.json()
          : undefined

        // Merge the items already on THIS order back into the inventory lists
        // (they're out of storage, so the inventory API wouldn't return them)
        // so the wizard can show them as the current selection.
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
      <div>
        <Header title="Edit Order" />
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error || !formData) {
    return (
      <div>
        <Header title="Edit Order" />
        <div className="p-6">
          <Card variant="bordered">
            <CardContent className="p-8 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
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

  return (
    <div>
      <Header title={`Edit Order${editMeta ? ` ${editMeta.orderNumber}` : ''}`} />

      <div className="p-6">
        <Link
          href={`/dashboard/orders/${orderId}`}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Order Details
        </Link>

        <div className="mb-6 p-4 bg-pink-50 border border-pink-200 rounded-xl">
          <p className="text-sm text-pink-900">
            Step through any page to make corrections — property, post, sign, riders,
            second post, lockbox, brochure box, or scheduling. Use the numbered steps
            above to jump straight to a section. Save your changes on the final step.
          </p>
        </div>

        <OrderWizard
          mode="edit"
          orderId={orderId}
          initialFormData={formData}
          inventory={inventory}
          editMeta={editMeta ?? undefined}
        />
      </div>
    </div>
  )
}
