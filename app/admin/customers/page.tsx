'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, Eye, Package, Mail, Phone } from 'lucide-react'
import { Input, Badge } from '@/components/ui'

interface Customer {
  id: string
  full_name: string
  email: string
  phone: string
  company_name: string | null
  sign_count: number
  rider_count: number
  lockbox_count: number
  order_count: number
  created_at: string
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetchCustomers() {
      try {
        const params = new URLSearchParams()
        if (search) params.set('search', search)

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
  }, [search])

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
                        <p className="font-medium text-gray-900">{customer.full_name}</p>
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
