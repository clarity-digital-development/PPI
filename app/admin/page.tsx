'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Users, ShoppingCart, MapPin, DollarSign, TrendingUp, Clock, Wrench } from 'lucide-react'
import { Card, CardContent } from '@/components/ui'

interface Stats {
  totalCustomers: number
  orders: {
    today: number
    thisWeek: number
    thisMonth: number
    pending: number
  }
  activeInstallations: number
  revenue: {
    today: number
    thisWeek: number
    thisMonth: number
  }
  pendingServiceRequests: number
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/admin/stats')
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch (error) {
        console.error('Error fetching stats:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600">Overview of your business metrics</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Customers</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.totalCustomers || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Links to the Active Posts page (Ryan 2026-09-19). Same
            status='active' predicate on both sides, so the number here and
            the page's total always agree. */}
        <Link href="/admin/installations">
          <Card className="h-full transition-all hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-pink-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Active Installations</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.activeInstallations || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Pending Orders</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.orders.pending || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Link href="/admin/service-requests">
          <Card className={`h-full transition-all hover:shadow-md ${(stats?.pendingServiceRequests || 0) > 0 ? 'ring-2 ring-orange-500' : ''}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                  <Wrench className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Service Requests</p>
                  <p className="text-2xl font-bold text-orange-600">{stats?.pendingServiceRequests || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Revenue (Month)</p>
                <p className="text-2xl font-bold text-gray-900">
                  ${(stats?.revenue.thisMonth || 0).toFixed(2)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Orders & Revenue Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Orders */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <ShoppingCart className="w-5 h-5 text-pink-500" />
              <h2 className="text-lg font-semibold text-gray-900">Orders</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-gray-600">Today</span>
                <span className="text-xl font-bold text-gray-900">{stats?.orders.today || 0}</span>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-gray-600">This Week</span>
                <span className="text-xl font-bold text-gray-900">{stats?.orders.thisWeek || 0}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-gray-600">This Month</span>
                <span className="text-xl font-bold text-gray-900">{stats?.orders.thisMonth || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Revenue */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <TrendingUp className="w-5 h-5 text-green-500" />
              <h2 className="text-lg font-semibold text-gray-900">Revenue</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-gray-600">Today</span>
                <span className="text-xl font-bold text-green-600">
                  ${(stats?.revenue.today || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-gray-600">This Week</span>
                <span className="text-xl font-bold text-green-600">
                  ${(stats?.revenue.thisWeek || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-gray-600">This Month</span>
                <span className="text-xl font-bold text-green-600">
                  ${(stats?.revenue.thisMonth || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
