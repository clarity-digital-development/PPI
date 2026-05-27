'use client'

import { useState, useEffect } from 'react'
import { MapPin, Calendar, Clock, DollarSign, Package } from 'lucide-react'
import { Header, StatsCards, ActivePostsTable } from '@/components/dashboard'
import type { Installation } from '@/components/dashboard/active-posts-table'
import Link from 'next/link'
import { Button } from '@/components/ui'

export default function DashboardPage() {
  const [installations, setInstallations] = useState<Installation[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [installRes, ordersRes] = await Promise.all([
          fetch('/api/installations'),
          fetch('/api/orders'),
        ])

        if (installRes.ok) {
          const installData = await installRes.json()
          // Transform API data to match Installation interface
          const transformed = installData.installations.map((inst: any) => ({
            id: inst.id,
            installDate: inst.installedAt,
            address: inst.propertyAddress,
            city: inst.propertyCity,
            state: inst.propertyState,
            zip: inst.propertyZip,
            status: inst.status,
            postType: 'white', // Default, could be from order
          }))
          setInstallations(transformed)
        }

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json()
          setOrders(ordersData.orders || [])
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Calculate stats from real data
  const activeCount = installations.filter((i) => i.status === 'active').length
  const pendingOrders = orders.filter((o) => o.status === 'pending' || o.status === 'confirmed').length
  const scheduledRemovals = installations.filter((i) => i.status === 'removal_scheduled').length
  const thisMonthSpend = orders
    .filter((o) => {
      const orderDate = new Date(o.createdAt)
      const now = new Date()
      return orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear()
    })
    .reduce((sum, o) => sum + Number(o.total || 0), 0)

  const stats = [
    {
      label: 'Active Posts',
      value: activeCount,
      icon: MapPin,
      href: '/dashboard/order-history',
    },
    {
      label: 'Pending Orders',
      value: pendingOrders,
      icon: Clock,
      href: '/dashboard/order-history',
    },
    {
      label: 'Scheduled Removals',
      value: scheduledRemovals,
      icon: Calendar,
      href: '/dashboard/service-requests',
    },
    {
      label: 'This Month',
      value: `$${thisMonthSpend.toFixed(0)}`,
      icon: DollarSign,
      href: '/dashboard/billing',
    },
  ]

  return (
    <div>
      <Header
        title="Dashboard"
        action={{
          label: '+ Place New Order',
          href: '/dashboard/place-order',
        }}
      />

      <div className="p-4 lg:p-6 space-y-6">
        {/* Stats Cards */}
        <StatsCards stats={stats} />

        {/* Active Installations */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Active Installations
            </h2>
            {installations.length > 0 && (
              <input
                type="text"
                placeholder="Search..."
                className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : installations.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Installations</h3>
              <p className="text-gray-500 mb-6">
                You don&apos;t have any active sign installations yet. Place your first order to get started!
              </p>
              <Link href="/dashboard/place-order">
                <Button>Place Your First Order</Button>
              </Link>
            </div>
          ) : (
            <ActivePostsTable installations={installations} />
          )}
        </div>
      </div>
    </div>
  )
}
