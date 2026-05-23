'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Header } from '@/components/dashboard'
import { OrderWizard } from '@/components/order-flow'

interface AgentBrief {
  id: string
  fullName: string | null
  email: string
  company: string | null
}

// Outer default export wraps the inner client component in <Suspense> —
// required by Next.js 14 App Router when any descendant uses useSearchParams,
// or the production build fails at static prerender time.
export default function PlaceOrderPage() {
  return (
    <Suspense
      fallback={
        <div>
          <Header title="Place New Order" />
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      }
    >
      <PlaceOrderPageInner />
    </Suspense>
  )
}

function PlaceOrderPageInner() {
  const searchParams = useSearchParams()
  const onBehalfOf = searchParams.get('on_behalf_of') || undefined

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

  const [agent, setAgent] = useState<AgentBrief | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const inventoryUrl = onBehalfOf
          ? `/api/inventory?on_behalf_of=${encodeURIComponent(onBehalfOf)}`
          : '/api/inventory'

        const requests: Promise<Response>[] = [
          fetch(inventoryUrl),
          fetch('/api/payments/methods'),
          fetch('/api/profile'),
        ]
        // If placing on behalf, fetch the agent's name for the banner
        if (onBehalfOf) {
          requests.push(fetch(`/api/admin/customers/${onBehalfOf}`))
        }
        const [inventoryRes, paymentsRes, profileRes, agentRes] = await Promise.all(requests)

        if (inventoryRes.ok) {
          const data = await inventoryRes.json()
          setInventory(data)
        } else if (inventoryRes.status === 403) {
          setAccessError('You do not have permission to place orders for this agent.')
        }

        if (paymentsRes.ok) {
          const data = await paymentsRes.json()
          setPaymentMethods(data.paymentMethods)
        }

        if (profileRes?.ok) {
          const data = await profileRes.json()
          setCurrentUserRole(data.user?.role || null)
        }

        if (agentRes && agentRes.ok) {
          const data = await agentRes.json()
          setAgent({
            id: data.customer.id,
            fullName: data.customer.full_name,
            email: data.customer.email,
            company: data.customer.company_name,
          })
        }
      } catch (error) {
        console.error('Error fetching data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [onBehalfOf])

  return (
    <div>
      <Header title={agent ? `Place Order for ${agent.fullName || agent.email}` : 'Place New Order'} />

      <div className="p-6">
        {accessError ? (
          <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-800">
            {accessError}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {agent && (
              <div className="mb-6 p-4 bg-pink-50 border border-pink-200 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-pink-700 uppercase tracking-wide">Placing on behalf of</p>
                  <p className="font-semibold text-gray-900">
                    {agent.fullName || agent.email}
                    {agent.company && <span className="text-gray-500 font-normal"> · {agent.company}</span>}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Their inventory is loaded. Your card on file will be charged at checkout.
                  </p>
                </div>
              </div>
            )}
            <OrderWizard
              inventory={inventory}
              paymentMethods={paymentMethods}
              onBehalfOf={onBehalfOf}
              currentUserRole={currentUserRole}
            />
          </>
        )}
      </div>
    </div>
  )
}
