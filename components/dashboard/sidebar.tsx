'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  LayoutDashboard,
  FileText,
  Tag,
  Lock,
  Calendar,
  History,
  Receipt,
  User,
  LogOut,
  Menu,
  X,
  Wrench,
  Package,
  Users,
} from 'lucide-react'
import { Logo } from '@/components/shared'
import { cn } from '@/lib/utils'

const mainNavItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'My Inventory',
    href: '/dashboard/inventory',
    icon: Package,
  },
  {
    label: 'Post Options',
    href: '/dashboard/post-options',
    icon: FileText,
  },
  {
    label: 'Rider Options',
    href: '/dashboard/rider-options',
    icon: Tag,
  },
  {
    label: 'Lockbox Options',
    href: '/dashboard/lockbox-options',
    icon: Lock,
  },
]

const orderNavItems = [
  {
    label: 'Place Order',
    href: '/dashboard/place-order',
    icon: Calendar,
  },
  {
    label: 'Order History',
    href: '/dashboard/order-history',
    icon: History,
  },
  {
    label: 'Service Requests',
    href: '/dashboard/service-requests',
    icon: Wrench,
  },
  {
    label: 'Billing',
    href: '/dashboard/billing',
    icon: Receipt,
  },
]

const accountNavItems = [
  {
    label: 'Profile',
    href: '/dashboard/profile',
    icon: User,
  },
]

const Sidebar = () => {
  const pathname = usePathname()
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)

  // Fetch the current user's role to drive team_admin-only nav. We render the
  // default (customer) labels until this resolves so there's no crash if the
  // request fails — only team_admins ever see the relabeled/extra items.
  useEffect(() => {
    let cancelled = false
    fetch('/api/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setRole(data?.user?.role ?? null)
      })
      .catch(() => {
        // Leave role null — default customer nav stays in place.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const isTeamAdmin = role === 'team_admin'

  // team_admins see "Team Inventory" instead of "My Inventory"; everyone else
  // keeps the default. Built per-render so it updates once the role resolves.
  const resolvedMainNavItems = mainNavItems.map((item) =>
    item.href === '/dashboard/inventory' && isTeamAdmin
      ? { ...item, label: 'Team Inventory' }
      : item
  )

  // "My Team" lives in the account area and is team_admin-only.
  const resolvedAccountNavItems = isTeamAdmin
    ? [
        ...accountNavItems,
        { label: 'My Team', href: '/dashboard/teams', icon: Users },
      ]
    : accountNavItems

  const NavLink = ({
    href,
    icon: Icon,
    label,
  }: {
    href: string
    icon: typeof LayoutDashboard
    label: string
  }) => {
    const isActive = pathname === href

    return (
      <Link
        href={href}
        onClick={() => setIsMobileOpen(false)}
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
          isActive
            ? 'bg-pink-500 text-white'
            : 'text-gray-700 hover:bg-pink-200 hover:text-pink-900'
        )}
      >
        <Icon className="w-5 h-5" />
        {label}
      </Link>
    )
  }

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="p-6 border-b border-pink-200">
        <Logo variant="dark" size="md" href="/" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-6 overflow-y-auto">
        {/* Main Navigation */}
        <div className="space-y-1">
          {resolvedMainNavItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-pink-200" />

        {/* Orders */}
        <div className="space-y-1">
          {orderNavItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-pink-200" />

        {/* Account */}
        <div className="space-y-1">
          {resolvedAccountNavItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>
      </nav>

      {/* Logout */}
      <div className="p-4 border-t border-pink-200">
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex items-center gap-3 px-4 py-2.5 w-full rounded-lg text-sm font-medium text-gray-700 hover:bg-pink-200 hover:text-pink-900 transition-all"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-pink-500 text-white rounded-lg shadow-lg"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={cn(
          'lg:hidden fixed inset-y-0 left-0 z-50 w-64 bg-pink-50 flex flex-col transition-transform duration-300 border-r border-pink-200',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <button
          onClick={() => setIsMobileOpen(false)}
          className="absolute top-4 right-4 p-2 text-gray-600 hover:bg-pink-200 rounded-lg"
        >
          <X className="w-5 h-5" />
        </button>
        <SidebarContent />
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-pink-50 border-r border-pink-200">
        <SidebarContent />
      </aside>
    </>
  )
}

export { Sidebar }
