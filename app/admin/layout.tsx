'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  Settings,
  LogOut,
  Menu,
  X,
  Wrench,
  MapPin,
  FileText,
} from 'lucide-react'
import { Logo } from '@/components/shared'
import { cn } from '@/lib/utils'

// Full admin nav for Pink Posts internal admins
const fullNavItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/customers', label: 'Customers', icon: Users },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/admin/invoices', label: 'Invoices', icon: FileText },
  { href: '/admin/service-requests', label: 'Service Requests', icon: Wrench },
  { href: '/admin/inventory', label: 'Inventory', icon: Package },
  { href: '/admin/service-areas', label: 'Service Areas', icon: MapPin },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [role, setRole] = useState<'admin' | null>(null)

  useEffect(() => {
    async function checkRole() {
      try {
        // Only Pink Posts internal admins access the /admin area. team_admin
        // accounts (e.g. Peggy) use the regular dashboard with the cart.
        const res = await fetch('/api/profile')
        if (!res.ok) {
          router.push('/dashboard')
          return
        }
        const data = await res.json()
        if (data.user?.role === 'admin') {
          setRole('admin')
        } else {
          router.push('/dashboard')
        }
      } catch {
        router.push('/dashboard')
      }
    }
    checkRole()
  }, [router])

  const navItems = fullNavItems
  const isAdmin = role !== null

  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 transform transition-transform duration-300 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-4 border-b border-gray-800">
            {/* Logo already renders its own <Link>; don't wrap it in another
                <Link> or we nest <a> inside <a> (invalid HTML → hydration error
                on every admin page). Point the logo's link at /admin instead. */}
            <div className="flex items-center gap-2">
              <Logo variant="light" href="/admin" className="h-8 w-auto" />
              <span className="text-gray-400 font-semibold">Admin</span>
            </div>
            <button
              className="lg:hidden text-gray-400 hover:text-white"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/admin' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-pink-600 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* Bottom links */}
          <div className="p-3 border-t border-gray-800">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white"
            >
              <LogOut className="w-5 h-5" />
              Back to Dashboard
            </Link>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-white border-b border-gray-200 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 text-gray-500 hover:text-gray-700"
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="ml-4 text-lg font-semibold text-gray-900">Admin Panel</span>
        </header>

        {/* Page content */}
        <main className="min-h-screen">{children}</main>
      </div>
    </div>
  )
}
