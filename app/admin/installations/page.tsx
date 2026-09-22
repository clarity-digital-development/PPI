'use client'

// Admin "Active Posts" (Ryan, Slack 2026-09-19): every sign still in the
// ground, searchable by street, oldest first so the ones nobody scheduled a
// pickup for float to the top. Structure copied from app/admin/orders/page.tsx
// (URL as the single source of truth, AbortController fetch) minus its
// orders-specific localStorage persistence.

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { Select, Badge, Button, Input } from '@/components/ui'
import { formatDate } from '@/lib/utils'

const PAGE_SIZE = 25

type StatusFilter = 'active' | 'removal_scheduled' | 'out'
const VALID_STATUSES: StatusFilter[] = ['active', 'removal_scheduled', 'out']
type SortFilter = 'oldest' | 'newest'

interface InstallationRow {
  id: string
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  installedAt: string
  status: 'active' | 'removal_scheduled' | 'removed'
  removalDate: string | null
  userId: string
  user: {
    fullName: string | null
    name: string | null
    email: string
    phone: string | null
    company: string | null
    team: { name: string } | null
  }
  order: { id: string; orderNumber: string; placedForAgentName: string | null }
  serviceRequests: Array<{ id: string; status: string; requestedDate: string | null }>
}

// The three real statuses. active-posts-table.tsx carries a phantom
// 'scheduled' that the enum has never produced; this map mirrors
// InstallationDetailsModal instead.
const statusConfig: Record<string, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  active: { label: 'Active', variant: 'success' },
  removal_scheduled: { label: 'Removal Scheduled', variant: 'warning' },
  removed: { label: 'Removed', variant: 'neutral' },
}

// installedAt is a real instant (stamped when the order was marked completed),
// so local-time math is fine here -- unlike Order.scheduledDate.
function daysOut(installedAt: string): number {
  return Math.floor((Date.now() - new Date(installedAt).getTime()) / 86400000)
}

// Wrapped in <Suspense> because useSearchParams() requires it during static
// prerender (Next.js 14). Same as app/admin/orders/page.tsx.
export default function AdminInstallationsPage() {
  return (
    <Suspense fallback={null}>
      <AdminInstallationsPageInner />
    </Suspense>
  )
}

function AdminInstallationsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // URL is the single source of truth: derive every filter on each render so
  // back/forward and deep links just work.
  const urlStatus = searchParams.get('status')
  const urlSort = searchParams.get('sort')
  const urlSearch = searchParams.get('search') ?? ''
  const urlPage = searchParams.get('page')
  const statusFilter: StatusFilter = VALID_STATUSES.includes(urlStatus as StatusFilter)
    ? (urlStatus as StatusFilter)
    : 'active'
  const sort: SortFilter = urlSort === 'newest' ? 'newest' : 'oldest'
  const page = Math.max(0, Number.parseInt(urlPage ?? '0', 10) || 0)

  const [rows, setRows] = useState<InstallationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  // Local text so typing is instant; pushed to the URL on a 300 ms debounce
  // (app/admin/customers/page.tsx pattern) so router.replace isn't spammed.
  const [searchInput, setSearchInput] = useState(urlSearch)

  // Single writer. Defaults are omitted so Ryan's bookmark of the bare page
  // stays the "active, oldest first" view he asked for.
  function pushUrl(next: { statusFilter: StatusFilter; sort: SortFilter; search: string; page: number }) {
    const params = new URLSearchParams()
    if (next.statusFilter !== 'active') params.set('status', next.statusFilter)
    if (next.sort !== 'oldest') params.set('sort', next.sort)
    if (next.search) params.set('search', next.search)
    if (next.page > 0) params.set('page', String(next.page))
    const qs = params.toString()
    router.replace(qs ? `/admin/installations?${qs}` : '/admin/installations', { scroll: false })
  }

  // Filter changes reset page to 0 atomically so the fetch fires once with the
  // right offset.
  function changeStatus(value: StatusFilter) {
    pushUrl({ statusFilter: value, sort, search: urlSearch, page: 0 })
  }
  function changeSort(value: SortFilter) {
    pushUrl({ statusFilter, sort: value, search: urlSearch, page: 0 })
  }
  function changePage(next: number) {
    pushUrl({ statusFilter, sort, search: urlSearch, page: next })
  }

  // Debounced search -> URL. Only fires when the input actually differs from
  // what the URL already holds, so the mount and the back button don't
  // trigger a spurious replace.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === urlSearch) return
    const t = setTimeout(() => {
      pushUrl({ statusFilter, sort, search: trimmed, page: 0 })
    }, 300)
    return () => clearTimeout(t)
    // pushUrl is a plain closure over the same derived values; listing it
    // would re-create the timer every render. Matches the pre-existing
    // pattern in app/admin/orders/page.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, urlSearch, statusFilter, sort])

  // Back/forward changed the URL underneath us: re-seed the box.
  useEffect(() => {
    setSearchInput((current) => (current.trim() === urlSearch ? current : urlSearch))
  }, [urlSearch])

  // AbortController: rapid pagination or typing cancels the previous in-flight
  // fetch so a slow earlier response can't clobber the latest result.
  useEffect(() => {
    const ac = new AbortController()
    async function fetchInstallations() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('status', statusFilter)
        params.set('sort', sort)
        if (urlSearch) params.set('search', urlSearch)
        params.set('limit', String(PAGE_SIZE))
        params.set('offset', String(page * PAGE_SIZE))

        const res = await fetch(`/api/admin/installations?${params}`, { signal: ac.signal })
        if (res.ok) {
          const data = await res.json()
          setRows(data.installations)
          setTotal(data.total ?? data.installations.length)
        }
      } catch (error) {
        if ((error as { name?: string } | null)?.name !== 'AbortError') {
          console.error('Error fetching installations:', error)
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }

    fetchInstallations()
    return () => ac.abort()
  }, [statusFilter, sort, urlSearch, page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Active Posts</h1>
          <p className="text-gray-600">
            Every sign still in the ground. Oldest first, so the ones nobody scheduled a pickup for float to the top.
            {!loading && total > 0 && (
              <span className="ml-2 text-gray-500">· {total} total</span>
            )}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 w-full md:w-auto">
          <div className="w-full sm:w-72">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search street, city, or zip…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="w-full sm:w-44">
            <Select
              value={statusFilter}
              onChange={(e) => changeStatus(e.target.value as StatusFilter)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'removal_scheduled', label: 'Removal scheduled' },
                { value: 'out', label: 'All still out' },
              ]}
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              value={sort}
              onChange={(e) => changeSort(e.target.value as SortFilter)}
              options={[
                { value: 'oldest', label: 'Oldest first' },
                { value: 'newest', label: 'Newest first' },
              ]}
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
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Agent / Brokerage</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Installed</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Days out</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rows.map((row) => {
                  const days = daysOut(row.installedAt)
                  const customer = row.user.fullName || row.user.name || row.user.email
                  const agent = row.order.placedForAgentName
                  const brokerage = row.user.team?.name || row.user.company || null
                  const pending = row.serviceRequests[0]
                  const cfg = statusConfig[row.status] ?? statusConfig.active
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900">{row.propertyAddress}</p>
                        <p className="text-sm text-gray-500">
                          {row.propertyCity}, {row.propertyState} {row.propertyZip}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/admin/customers/${row.userId}`} className="font-medium text-gray-900 hover:text-pink-600">
                          {customer}
                        </Link>
                        <p className="text-xs text-gray-500">{row.user.email}</p>
                        {row.user.phone && <p className="text-xs text-gray-500">{row.user.phone}</p>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {agent ? (
                          <>
                            <p>{agent}</p>
                            {brokerage && <p className="text-xs text-gray-500">{brokerage}</p>}
                          </>
                        ) : brokerage ? (
                          <p>{brokerage}</p>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 whitespace-nowrap">{formatDate(row.installedAt)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={
                            days >= 60
                              ? 'font-semibold text-red-600'
                              : days >= 30
                                ? 'font-semibold text-amber-600'
                                : 'font-semibold text-gray-700'
                          }
                        >
                          {days}d
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={cfg.variant}>{cfg.label}</Badge>
                          {row.removalDate && (
                            <span className="text-xs text-gray-500">Pickup {formatDate(row.removalDate)}</span>
                          )}
                          {pending && (
                            <Badge variant="info">
                              Removal requested{pending.requestedDate ? ` · ${formatDate(pending.requestedDate)}` : ''}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link href={`/admin/orders/${row.order.id}`} className="inline-flex items-center gap-2">
                          <span className="text-sm text-gray-700">{row.order.orderNumber}</span>
                          <Button variant="ghost" size="sm">
                            <Eye className="w-4 h-4" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {urlSearch ? `No active posts match "${urlSearch}"` : 'No active posts.'}
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
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} posts
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => changePage(Math.max(0, page - 1))}
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
              onClick={() => changePage(page + 1)}
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
