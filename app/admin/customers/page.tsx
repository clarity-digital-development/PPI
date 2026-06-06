'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Eye, Package, Mail, Phone } from 'lucide-react'
import { Input, Badge } from '@/components/ui'

// Narrowed role filter; '' === All.
type RoleFilter = '' | 'customer' | 'team_admin'

const ROLE_PILLS: { value: RoleFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'team_admin', label: 'Brokers' },
  { value: 'customer', label: 'Customers' },
]

interface Customer {
  id: string
  full_name: string
  email: string
  phone: string
  company_name: string | null
  role: 'customer' | 'team_admin'
  sign_count: number
  rider_count: number
  lockbox_count: number
  order_count: number
  created_at: string
}

// Wrapped in <Suspense> because useSearchParams() requires it during
// static prerender (Next.js 14 bails out otherwise).
export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersPageInner />
    </Suspense>
  )
}

function CustomersPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Hydrate role from URL so reloads + shared links persist the filter.
  const initialRole: RoleFilter = (() => {
    const r = searchParams.get('role')
    return r === 'customer' || r === 'team_admin' ? r : ''
  })()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(initialRole)

  // Push role into the URL without scroll/navigation thrash.
  function selectRole(next: RoleFilter) {
    setRoleFilter(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set('role', next)
    else params.delete('role')
    const qs = params.toString()
    router.replace(qs ? `/admin/customers?${qs}` : '/admin/customers', { scroll: false })
  }

  useEffect(() => {
    async function fetchCustomers() {
      try {
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        if (roleFilter) params.set('role', roleFilter)

        const res = await fetch(`/api/admin/customers?${params}`)
        if (res.ok) {
          const data = await res.json()
          setCustomers(data.customers)
          setTotal(data.total ?? data.customers.length)
        }
      } catch (error) {
        console.error('Error fetching customers:', error)
      } finally {
        setLoading(false)
      }
    }

    const debounce = setTimeout(fetchCustomers, 300)
    return () => clearTimeout(debounce)
  }, [search, roleFilter])

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
          <p className="text-gray-600">
            Manage customer accounts and inventory
            {!loading && customers.length > 0 && (
              <span className="ml-2 text-gray-500">
                · {customers.length === total ? `${total} total` : `Showing ${customers.length} of ${total}`}
              </span>
            )}
          </p>
        </div>
        <div className="w-full md:w-72">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* Role filter pills - mirrors /admin/inventory type filter */}
      <div className="flex gap-2 mb-4">
        {ROLE_PILLS.map((pill) => (
          <button
            key={pill.value || 'all'}
            onClick={() => selectRole(pill.value)}
            className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              roleFilter === pill.value
                ? 'bg-pink-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {pill.label}
          </button>
        ))}
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
                    Customer
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Signs
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Riders
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Lockboxes
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Orders
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{customer.full_name}</p>
                          {customer.role === 'team_admin' && (
                            <Badge variant="info">Team Admin</Badge>
                          )}
                        </div>
                        {customer.company_name && (
                          <p className="text-sm text-gray-500">{customer.company_name}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <Mail className="w-3.5 h-3.5" />
                          {customer.email}
                        </div>
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <Phone className="w-3.5 h-3.5" />
                          {customer.phone}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant={customer.sign_count > 0 ? 'info' : 'neutral'}>
                        {customer.sign_count}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant={customer.rider_count > 0 ? 'info' : 'neutral'}>
                        {customer.rider_count}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant={customer.lockbox_count > 0 ? 'info' : 'neutral'}>
                        {customer.lockbox_count}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-medium text-gray-900">{customer.order_count}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="inline-flex items-center gap-1 text-pink-600 hover:text-pink-700 font-medium text-sm"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      No customers found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
