'use client'

import { useEffect, useState } from 'react'
import { Header, OrderHistoryTable } from '@/components/dashboard'
import type { OrderData } from '@/components/dashboard/order-history-table'
import { Select } from '@/components/ui'
import { Loader2 } from 'lucide-react'

const ITEMS_PER_PAGE = 20

interface RosterMember { id: string; name: string }

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState<OrderData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  // team_admin only: roster for the "filter by agent" control (filters on the
  // placed-for agent name).
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)
  const [members, setMembers] = useState<RosterMember[]>([])
  const [agentFilter, setAgentFilter] = useState('') // '' = all agents

  // Resolve role + roster once.
  useEffect(() => {
    async function fetchRoleAndRoster() {
      try {
        const profileRes = await fetch('/api/profile')
        const role = profileRes.ok ? (await profileRes.json()).user?.role : null
        if (role === 'team_admin') {
          setIsTeamAdmin(true)
          const teamsRes = await fetch('/api/teams')
          if (teamsRes.ok) {
            const data = await teamsRes.json()
            setMembers(Array.isArray(data.members) ? data.members.map((m: RosterMember) => ({ id: m.id, name: m.name })) : [])
          }
        }
      } catch (err) {
        console.error('Error loading team roster:', err)
      }
    }
    fetchRoleAndRoster()
  }, [])

  // Reset to the first page whenever the agent filter changes.
  useEffect(() => { setPage(0) }, [agentFilter])

  useEffect(() => {
    async function fetchOrders() {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          limit: String(ITEMS_PER_PAGE),
          offset: String(page * ITEMS_PER_PAGE),
        })
        if (agentFilter) params.set('agent', agentFilter)
        const res = await fetch(`/api/orders?${params.toString()}`)
        if (!res.ok) {
          throw new Error('Failed to fetch orders')
        }

        const data = await res.json()
        const fetchedOrders: OrderData[] = data.orders || []
        setOrders(fetchedOrders)
        setHasMore(fetchedOrders.length === ITEMS_PER_PAGE)
      } catch (err) {
        console.error('Error fetching orders:', err)
        setError(err instanceof Error ? err.message : 'Failed to load order history')
      } finally {
        setLoading(false)
      }
    }

    fetchOrders()
  }, [page, agentFilter])

  const handlePrevious = () => {
    if (page > 0) setPage(page - 1)
  }

  const handleNext = () => {
    if (hasMore) setPage(page + 1)
  }

  return (
    <div>
      <Header title="Order History" />

      <div className="p-6">
        {/* team_admin: filter the list by the agent an order was placed for */}
        {isTeamAdmin && (
          <div className="mb-4 max-w-xs">
            <Select
              label="Filter by agent"
              placeholder=""
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              options={[
                { value: '', label: 'All agents' },
                ...members.map((m) => ({ value: m.name, label: m.name })),
              ]}
            />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
              <p className="text-gray-500">Loading order history...</p>
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <p className="text-red-700">{error}</p>
            <button
              onClick={() => setPage(0)}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800"
            >
              Try again
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500">
              {agentFilter ? 'No orders for this agent.' : 'No orders found. Place your first order to see it here!'}
            </p>
          </div>
        ) : (
          <>
            <OrderHistoryTable orders={orders} />

            {/* Pagination */}
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Page {page + 1}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevious}
                  disabled={page === 0}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${
                    page === 0
                      ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                      : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Previous
                </button>
                <button
                  onClick={handleNext}
                  disabled={!hasMore}
                  className={`px-4 py-2 text-sm font-medium rounded-lg ${
                    !hasMore
                      ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                      : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
