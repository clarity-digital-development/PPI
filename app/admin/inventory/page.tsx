'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, Package, Tag, Lock, FileBox, User } from 'lucide-react'
import { Input, Badge, Card, CardContent } from '@/components/ui'

interface InventoryItem {
  id: string
  type: 'sign' | 'rider' | 'lockbox' | 'brochure_box'
  description: string
  customer_id: string
  customer_name: string
  in_storage: boolean
  created_at: string
  quantity: number
}

interface InventorySummary {
  signs: number
  riders: number
  lockboxes: number
  brochureBoxes: number
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [summary, setSummary] = useState<InventorySummary>({
    signs: 0,
    riders: 0,
    lockboxes: 0,
    brochureBoxes: 0,
  })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'sign' | 'rider' | 'lockbox' | 'brochure_box'>('all')

  useEffect(() => {
    async function fetchInventory() {
      try {
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        if (filter !== 'all') params.set('type', filter)

        const res = await fetch(`/api/admin/inventory?${params}`)
        if (res.ok) {
          const data = await res.json()
          setInventory(data.items)
          setSummary(data.summary)
        }
      } catch (error) {
        console.error('Error fetching inventory:', error)
      } finally {
        setLoading(false)
      }
    }

    const debounce = setTimeout(fetchInventory, 300)
    return () => clearTimeout(debounce)
  }, [search, filter])

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'sign':
        return <Package className="w-4 h-4" />
      case 'rider':
        return <Tag className="w-4 h-4" />
      case 'lockbox':
        return <Lock className="w-4 h-4" />
      case 'brochure_box':
        return <FileBox className="w-4 h-4" />
      default:
        return <Package className="w-4 h-4" />
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'sign':
        return 'Sign'
      case 'rider':
        return 'Rider'
      case 'lockbox':
        return 'Lockbox'
      case 'brochure_box':
        return 'Brochure Box'
      default:
        return type
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
        <p className="text-gray-600">Overview of all customer inventory in storage</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Signs</p>
                <p className="text-2xl font-bold text-gray-900">{summary.signs}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                <Tag className="w-5 h-5 text-pink-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Riders</p>
                <p className="text-2xl font-bold text-gray-900">{summary.riders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Lock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Lockboxes</p>
                <p className="text-2xl font-bold text-gray-900">{summary.lockboxes}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <FileBox className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Brochure Boxes</p>
                <p className="text-2xl font-bold text-gray-900">{summary.brochureBoxes}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="w-full md:w-72">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search inventory..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex gap-2">
          {(['all', 'sign', 'rider', 'lockbox', 'brochure_box'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                filter === type
                  ? 'bg-pink-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {type === 'all' ? 'All' : getTypeLabel(type)}
            </button>
          ))}
        </div>
      </div>

      {/* Inventory Table */}
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
                    Type
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {inventory.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                          {getTypeIcon(item.type)}
                        </div>
                        <span className="font-medium text-gray-900">{getTypeLabel(item.type)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900">
                        {item.description}
                        {item.quantity > 1 && (
                          <span className="ml-2 text-sm font-medium text-gray-500">×{item.quantity}</span>
                        )}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <Link
                        href={`/admin/customers/${item.customer_id}`}
                        className="flex items-center gap-1 text-pink-600 hover:text-pink-700"
                      >
                        <User className="w-3.5 h-3.5" />
                        {item.customer_name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant={item.in_storage ? 'success' : 'warning'}>
                        {item.in_storage ? 'In Storage' : 'In Use'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/admin/customers/${item.customer_id}`}
                        className="text-sm text-gray-600 hover:text-gray-900"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
                {inventory.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                      No inventory items found
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
