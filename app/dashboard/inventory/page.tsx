'use client'

import { useState, useEffect } from 'react'
import { Header } from '@/components/dashboard'
import { Card, CardContent } from '@/components/ui'
import { Package, FileImage, Tag, Lock, Archive, Info } from 'lucide-react'

interface InventoryData {
  signs: Array<{ id: string; description: string; size: string | null }>
  riders: Array<{ id: string; rider_type: string; quantity: number }>
  lockboxes: Array<{ id: string; lockbox_type: string; lockbox_code: string | null }>
  brochureBoxes: { quantity: number } | null
}

/**
 * Inventory list that truncates visual height to ~5 rows and scrolls within
 * the card instead of expanding it. Keeps the cards balanced on the grid
 * even when an agent has 50+ items in one category.
 */
function ScrollableList({ itemCount, children }: { itemCount: number; children: React.ReactNode }) {
  const SCROLL_AFTER = 5
  const shouldScroll = itemCount > SCROLL_AFTER
  return (
    <div>
      <ul
        className={
          shouldScroll
            // 5 rows × ~52px (p-3 + line-height + space-y-3 gap) ≈ 280px
            ? 'space-y-3 max-h-[280px] overflow-y-auto pr-1 -mr-1 scroll-smooth'
            : 'space-y-3'
        }
      >
        {children}
      </ul>
      {shouldScroll && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          Showing all {itemCount} — scroll to see more
        </p>
      )}
    </div>
  )
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchInventory() {
      try {
        const res = await fetch('/api/inventory')
        if (res.ok) {
          const data = await res.json()
          setInventory(data)
        }
      } catch (error) {
        console.error('Error fetching inventory:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchInventory()
  }, [])

  const hasInventory = inventory && (
    inventory.signs.length > 0 ||
    inventory.riders.length > 0 ||
    inventory.lockboxes.length > 0 ||
    (inventory.brochureBoxes && inventory.brochureBoxes.quantity > 0)
  )

  const formatRiderType = (type: string) => {
    return type
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const formatLockboxType = (type: string) => {
    return type
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  return (
    <div>
      <Header title="My Inventory" />

      <div className="p-4 lg:p-6 space-y-6">
        {/* Info Banner */}
        <Card variant="bordered" className="bg-pink-50 border-pink-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-pink-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-gray-700">
                  This page shows items that Pink Posts Installations currently has in storage for you.
                  These items can be selected when placing a new order.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !hasInventory ? (
          <Card variant="bordered">
            <CardContent className="p-12 text-center">
              <Archive className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Items in Storage</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                You don&apos;t have any items stored with us yet. When you have signs, riders, lockboxes,
                or brochure boxes in our storage, they&apos;ll appear here and be available to use in your orders.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Signs */}
            <Card variant="bordered">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                    <FileImage className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Signs</h3>
                    <p className="text-sm text-gray-500">{inventory?.signs.length || 0} in storage</p>
                  </div>
                </div>

                {inventory?.signs && inventory.signs.length > 0 ? (
                  <ScrollableList itemCount={inventory.signs.length}>
                    {inventory.signs.map((sign) => (
                      <li key={sign.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                        <Package className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-700">{sign.description}</span>
                      </li>
                    ))}
                  </ScrollableList>
                ) : (
                  <p className="text-sm text-gray-500 italic">No signs in storage</p>
                )}
              </CardContent>
            </Card>

            {/* Riders */}
            <Card variant="bordered">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                    <Tag className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Riders</h3>
                    <p className="text-sm text-gray-500">
                      {inventory?.riders.reduce((sum, r) => sum + r.quantity, 0) || 0} in storage
                    </p>
                  </div>
                </div>

                {inventory?.riders && inventory.riders.length > 0 ? (
                  <ScrollableList itemCount={inventory.riders.length}>
                    {inventory.riders.map((rider) => (
                      <li key={rider.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Tag className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{formatRiderType(rider.rider_type)}</span>
                        </div>
                        <span className="text-sm font-medium text-pink-600">x{rider.quantity}</span>
                      </li>
                    ))}
                  </ScrollableList>
                ) : (
                  <p className="text-sm text-gray-500 italic">No riders in storage</p>
                )}
              </CardContent>
            </Card>

            {/* Lockboxes */}
            <Card variant="bordered">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                    <Lock className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Lockboxes</h3>
                    <p className="text-sm text-gray-500">{inventory?.lockboxes.length || 0} in storage</p>
                  </div>
                </div>

                {inventory?.lockboxes && inventory.lockboxes.length > 0 ? (
                  <ScrollableList itemCount={inventory.lockboxes.length}>
                    {inventory.lockboxes.map((lockbox) => (
                      <li key={lockbox.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Lock className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{formatLockboxType(lockbox.lockbox_type)}</span>
                        </div>
                        {lockbox.lockbox_code && (
                          <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded">
                            {lockbox.lockbox_code}
                          </span>
                        )}
                      </li>
                    ))}
                  </ScrollableList>
                ) : (
                  <p className="text-sm text-gray-500 italic">No lockboxes in storage</p>
                )}
              </CardContent>
            </Card>

            {/* Brochure Boxes */}
            <Card variant="bordered">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                    <Archive className="w-5 h-5 text-pink-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Brochure Boxes</h3>
                    <p className="text-sm text-gray-500">
                      {inventory?.brochureBoxes?.quantity || 0} in storage
                    </p>
                  </div>
                </div>

                {inventory?.brochureBoxes && inventory.brochureBoxes.quantity > 0 ? (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Archive className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-700">Brochure Box</span>
                      </div>
                      <span className="text-sm font-medium text-pink-600">
                        x{inventory.brochureBoxes.quantity}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">No brochure boxes in storage</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* How it works */}
        <Card variant="bordered">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">How Inventory Works</h3>
            <div className="space-y-4 text-sm text-gray-600">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-pink-600">1</span>
                </div>
                <p>
                  <strong className="text-gray-900">Items are stored for you</strong> - When a sign is removed or you provide
                  items for future use, we store them at our facility.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-pink-600">2</span>
                </div>
                <p>
                  <strong className="text-gray-900">Select during checkout</strong> - When placing a new order, you can choose
                  to use items from your storage instead of providing new ones.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-pink-600">3</span>
                </div>
                <p>
                  <strong className="text-gray-900">Save time and money</strong> - Using stored items means we already have
                  what we need to complete your installation quickly.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
