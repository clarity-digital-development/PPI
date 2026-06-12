'use client'

import { useEffect, useMemo, useState } from 'react'
import { Header, OrderHistoryTable } from '@/components/dashboard'
import type { OrderData } from '@/components/dashboard/order-history-table'
import { Input, Select } from '@/components/ui'
import { Loader2, Download, Filter } from 'lucide-react'
import { exportOrderHistoryPdf } from '@/lib/orders/order-history-pdf'

const ITEMS_PER_PAGE = 20
// Used for the PDF export — pulls every order that matches the filter in one
// shot regardless of the paginated screen view.
const EXPORT_LIMIT = 1000

interface RosterMember { id: string; name: string }

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState<OrderData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  // team_admin only: roster for the "filter by agent" control (filters on the
  // placed-for agent name) + company name for the PDF cover line.
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [members, setMembers] = useState<RosterMember[]>([])
  const [agentFilter, setAgentFilter] = useState('') // '' = all agents

  // Date + price filters power both the on-screen list and the PDF export.
  // All empty by default so the page behaves the same as before until filters
  // are touched.
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [exporting, setExporting] = useState(false)

  // Resolve role + roster once.
  useEffect(() => {
    let cancelled = false
    async function fetchRoleAndRoster() {
      try {
        const profileRes = await fetch('/api/profile')
        const profile = profileRes.ok ? await profileRes.json() : null
        const role = profile?.user?.role
        if (!cancelled) setCompanyName(profile?.user?.company || profile?.user?.fullName || null)
        if (role === 'team_admin') {
          if (!cancelled) setIsTeamAdmin(true)
          const teamsRes = await fetch('/api/teams')
          if (teamsRes.ok) {
            const data = await teamsRes.json()
            if (!cancelled) {
              setMembers(Array.isArray(data.members) ? data.members.map((m: RosterMember) => ({ id: m.id, name: m.name })) : [])
            }
          }
        }
      } catch (err) {
        console.error('Error loading team roster:', err)
      }
    }
    fetchRoleAndRoster()
    return () => { cancelled = true }
  }, [])

  // Reset to the first page whenever any filter changes.
  useEffect(() => { setPage(0) }, [agentFilter, startDate, endDate, minPrice, maxPrice])

  // Build the shared filter query string once per filter change.
  const filterParams = useMemo(() => {
    const p = new URLSearchParams()
    if (agentFilter) p.set('agent', agentFilter)
    if (startDate) p.set('startDate', startDate)
    if (endDate) p.set('endDate', endDate)
    if (minPrice) p.set('minPrice', minPrice)
    if (maxPrice) p.set('maxPrice', maxPrice)
    return p
  }, [agentFilter, startDate, endDate, minPrice, maxPrice])

  useEffect(() => {
    let cancelled = false
    async function fetchOrders() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams(filterParams)
        params.set('limit', String(ITEMS_PER_PAGE))
        params.set('offset', String(page * ITEMS_PER_PAGE))
        const res = await fetch(`/api/orders?${params.toString()}`)
        if (!res.ok) throw new Error('Failed to fetch orders')
        const data = await res.json()
        if (cancelled) return
        const fetchedOrders: OrderData[] = data.orders || []
        setOrders(fetchedOrders)
        setHasMore(fetchedOrders.length === ITEMS_PER_PAGE)
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching orders:', err)
          setError(err instanceof Error ? err.message : 'Failed to load order history')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchOrders()
    return () => { cancelled = true }
  }, [page, filterParams])

  const handlePrevious = () => {
    if (page > 0) setPage(page - 1)
  }

  const handleNext = () => {
    if (hasMore) setPage(page + 1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      // Re-fetch with a high limit so the PDF reflects every matching order,
      // not just the currently-displayed page.
      const params = new URLSearchParams(filterParams)
      params.set('limit', String(EXPORT_LIMIT))
      params.set('offset', '0')
      const res = await fetch(`/api/orders?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch orders for export')
      const data = await res.json()
      const all: OrderData[] = data.orders || []
      const today = new Date().toISOString().slice(0, 10)
      exportOrderHistoryPdf({
        orders: all,
        startDate: startDate || (all.length ? all[all.length - 1].createdAt.slice(0, 10) : today),
        endDate: endDate || today,
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
        agentFilter: agentFilter || null,
        companyName,
      })
    } catch (err) {
      console.error('Export failed:', err)
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const hasActiveFilters = !!(startDate || endDate || minPrice || maxPrice || agentFilter)
  const clearFilters = () => {
    setStartDate('')
    setEndDate('')
    setMinPrice('')
    setMaxPrice('')
    setAgentFilter('')
  }

  return (
    <div>
      <Header title="Order History" />

      <div className="p-6">
        {/* Filter / export bar */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-pink-500" />
            <h2 className="text-sm font-semibold text-gray-900">Filter &amp; Export</h2>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto text-xs font-medium text-gray-500 hover:text-pink-600"
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
            <Input
              type="date"
              label="Start date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate || undefined}
            />
            <Input
              type="date"
              label="End date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              label="Min price ($)"
              placeholder="e.g. 63.95"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
            <Input
              type="number"
              step="0.01"
              min="0"
              label="Max price ($)"
              placeholder="Any"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
            {isTeamAdmin && (
              <Select
                label="Agent"
                placeholder=""
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                options={[
                  { value: '', label: 'All agents' },
                  ...members.map((m) => ({ value: m.name, label: m.name })),
                ]}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || loading || orders.length === 0}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-pink-500 text-white hover:bg-pink-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {exporting ? 'Building PDF...' : 'Export PDF'}
            </button>
            <p className="text-xs text-gray-500">
              PDF includes order #, date, address, items installed, agent, and price.
            </p>
          </div>
        </div>

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
              {hasActiveFilters ? 'No orders match these filters.' : 'No orders found. Place your first order to see it here!'}
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
