'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/dashboard'
import { OrderWizard } from '@/components/order-flow'

export default function PlaceOrderPage() {
  const [inventory, setInventory] = useState<{
    signs: Array<{ id: string; description: string; size: string | null }>
    riders: Array<{ id: string; rider_type: string; quantity: number }>
    lockboxes: Array<{ id: string; lockbox_type: string; lockbox_type_name?: string; lockbox_code: string | null }>
    brochureBoxes: { quantity: number } | null
  } | undefined>()

  const [paymentMethods, setPaymentMethods] = useState<Array<{
    id: string
    card_brand: string | null
    card_last4: string | null
    is_default: boolean
  }> | undefined>()

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [inventoryRes, paymentsRes] = await Promise.all([
          fetch('/api/inventory'),
          fetch('/api/payments/methods'),
        ])

        if (inventoryRes.ok) {
          const data = await inventoryRes.json()
          setInventory(data)
        }

        if (paymentsRes.ok) {
          const data = await paymentsRes.json()
          setPaymentMethods(data.paymentMethods)
        }
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  return (
    <div>
      <Header title="Place New Order" />

      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <OrderWizard
            inventory={inventory}
            paymentMethods={paymentMethods}
          />
        )}
      </div>
    </div>
  )
}
