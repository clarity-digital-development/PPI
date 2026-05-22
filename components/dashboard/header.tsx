'use client'

import { User, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui'
import Link from 'next/link'
import { NotificationDropdown } from './notification-dropdown'
import { useCart } from '@/lib/cart'

interface HeaderProps {
  title: string
  action?: {
    label: string
    href: string
  }
}

const Header = ({ title, action }: HeaderProps) => {
  // Cart badge — only shows when items are present (so non-cart users never see it)
  const { count } = useCart()
  return (
    <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-4">
      {/* Add padding-left on mobile to clear hamburger menu button */}
      <div className="flex items-center justify-between pl-12 lg:pl-0">
        <h1 className="text-xl lg:text-2xl font-bold text-gray-900 truncate">{title}</h1>

        <div className="flex items-center gap-2 lg:gap-4 shrink-0">
          {action && (
            <Link href={action.href}>
              <Button size="sm" className="text-xs lg:text-sm whitespace-nowrap">
                <span className="hidden sm:inline">{action.label}</span>
                <span className="sm:hidden">+ Order</span>
              </Button>
            </Link>
          )}

          {/* Cart (hidden when empty) */}
          {count > 0 && (
            <Link
              href="/dashboard/cart"
              className="relative p-2 rounded-full hover:bg-gray-100 transition-colors"
              aria-label={`Cart (${count} items)`}
            >
              <ShoppingCart className="w-5 h-5 text-gray-700" />
              <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-pink-600 text-white text-xs font-bold flex items-center justify-center">
                {count}
              </span>
            </Link>
          )}

          {/* Notifications */}
          <NotificationDropdown />

          {/* User Menu */}
          <Link href="/dashboard/profile">
            <div className="flex items-center gap-3 pl-2 lg:pl-4 border-l border-gray-200">
              <div className="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-pink-100 flex items-center justify-center">
                <User className="w-4 h-4 lg:w-5 lg:h-5 text-pink-600" />
              </div>
            </div>
          </Link>
        </div>
      </div>
    </header>
  )
}

export { Header }
