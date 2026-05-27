'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Badge, Select } from '@/components/ui'
import { Package, FileImage, Tag, Lock, Archive, Info } from 'lucide-react'

interface InventoryData {
  signs: Array<{ id: string; description: string; size: string | null }>
  riders: Array<{ id: string; rider_type: string; quantity: number }>
  lockboxes: Array<{ id: string; lockbox_type: string; lockbox_code: string | null }>
  brochureBoxes: { quantity: number } | null
}

// Shapes returned by /api/teams/inventory — INDIVIDUAL items (not aggregated).
interface TeamMemberOption {
  id: string
  name: string
}

interface TeamItem {
  id: string
  label: string
  code?: string | null
  inStorage: boolean
  assignedToMemberId: string | null
}

interface TeamInventoryData {
  members: TeamMemberOption[]
  signs: TeamItem[]
  riders: TeamItem[]
  lockboxes: TeamItem[]
  brochureBoxes: TeamItem[]
}

type AssignableType = 'sign' | 'rider' | 'lockbox' | 'brochure_box'

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

// Shared "How Inventory Works" footer — rendered in both views.
function HowInventoryWorks() {
  return (
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
  )
}

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [isTeamAdmin, setIsTeamAdmin] = useState(false)
  // Resolved once we know the role, so we render the correct view without a flash.
  const [roleResolved, setRoleResolved] = useState(false)

  // Team-admin view state
  const [teamInventory, setTeamInventory] = useState<TeamInventoryData | null>(null)
  const [teamLoading, setTeamLoading] = useState(false)
  const [agentFilter, setAgentFilter] = useState('') // '' = all, 'unassigned', or a member id
  // Per-item in-flight + error tracking, keyed by `${type}:${id}`.
  const [savingItems, setSavingItems] = useState<Record<string, boolean>>({})
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({})

  // Resolve role first; the role decides which data source we hit.
  useEffect(() => {
    async function fetchRole() {
      try {
        const res = await fetch('/api/profile')
        if (res.ok) {
          const data = await res.json()
          setIsTeamAdmin(data.user?.role === 'team_admin')
        }
      } catch (error) {
        console.error('Error fetching profile:', error)
      } finally {
        setRoleResolved(true)
      }
    }

    fetchRole()
  }, [])

  // Customer view: fetch the aggregated inventory once we know we are NOT a team admin.
  useEffect(() => {
    if (!roleResolved || isTeamAdmin) return

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
  }, [roleResolved, isTeamAdmin])

  // Team-admin view: fetch individual items, re-fetching whenever the agent filter changes.
  useEffect(() => {
    if (!roleResolved || !isTeamAdmin) return

    async function fetchTeamInventory() {
      setTeamLoading(true)
      try {
        const qs = agentFilter ? `?member_id=${encodeURIComponent(agentFilter)}` : ''
        const res = await fetch(`/api/teams/inventory${qs}`)
        if (res.ok) {
          const data = await res.json()
          setTeamInventory(data)
        }
      } catch (error) {
        console.error('Error fetching team inventory:', error)
      } finally {
        setTeamLoading(false)
        setLoading(false)
      }
    }

    fetchTeamInventory()
  }, [roleResolved, isTeamAdmin, agentFilter])

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

  // ----- Team-admin helpers -----

  const memberName = (memberId: string | null) => {
    if (!memberId) return 'Unassigned'
    return teamInventory?.members.find((m) => m.id === memberId)?.name ?? 'Unassigned'
  }

  // Assign (or unassign) a single item. Optimistically updates local state and
  // rolls back on failure.
  async function assignItem(type: AssignableType, item: TeamItem, rawValue: string) {
    if (!teamInventory) return
    const key = `${type}:${item.id}`
    const memberId = rawValue === '' ? null : rawValue
    const previous = item.assignedToMemberId

    // Optimistic update
    setItemErrors((e) => {
      const next = { ...e }
      delete next[key]
      return next
    })
    setSavingItems((s) => ({ ...s, [key]: true }))
    updateLocalAssignment(type, item.id, memberId)

    try {
      const res = await fetch('/api/teams/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id: item.id, memberId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to assign')
      }
      // If a filter is active, the item may no longer match — re-fetch to reflect it.
      if (agentFilter) {
        const qs = `?member_id=${encodeURIComponent(agentFilter)}`
        const refetch = await fetch(`/api/teams/inventory${qs}`)
        if (refetch.ok) setTeamInventory(await refetch.json())
      }
    } catch (err) {
      // Roll back the optimistic change and surface the error inline.
      updateLocalAssignment(type, item.id, previous)
      setItemErrors((e) => ({
        ...e,
        [key]: err instanceof Error ? err.message : 'Failed to assign',
      }))
    } finally {
      setSavingItems((s) => {
        const next = { ...s }
        delete next[key]
        return next
      })
    }
  }

  function updateLocalAssignment(type: AssignableType, id: string, memberId: string | null) {
    setTeamInventory((prev) => {
      if (!prev) return prev
      const apply = (items: TeamItem[]) =>
        items.map((it) => (it.id === id ? { ...it, assignedToMemberId: memberId } : it))
      switch (type) {
        case 'sign':
          return { ...prev, signs: apply(prev.signs) }
        case 'rider':
          return { ...prev, riders: apply(prev.riders) }
        case 'lockbox':
          return { ...prev, lockboxes: apply(prev.lockboxes) }
        case 'brochure_box':
          return { ...prev, brochureBoxes: apply(prev.brochureBoxes) }
      }
    })
  }

  // ----- Team-admin view -----
  if (roleResolved && isTeamAdmin) {
    const members = teamInventory?.members ?? []
    const hasMembers = members.length > 0
    const memberOptions = [
      { value: '', label: 'Unassigned' },
      ...members.map((m) => ({ value: m.id, label: m.name })),
    ]
    const filterOptions = [
      { value: '', label: 'All agents' },
      ...members.map((m) => ({ value: m.id, label: m.name })),
      { value: 'unassigned', label: 'Unassigned' },
    ]

    const hasTeamInventory = teamInventory && (
      teamInventory.signs.length > 0 ||
      teamInventory.riders.length > 0 ||
      teamInventory.lockboxes.length > 0 ||
      teamInventory.brochureBoxes.length > 0
    )

    // Reusable item row with an inline assign Select.
    const renderItem = (type: AssignableType, item: TeamItem) => {
      const key = `${type}:${item.id}`
      const saving = !!savingItems[key]
      const error = itemErrors[key]
      return (
        <li key={item.id} className="p-3 bg-gray-50 rounded-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Package className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 truncate">{item.label}</span>
              {item.code && (
                <span className="text-xs font-mono bg-gray-200 px-2 py-1 rounded flex-shrink-0">
                  {item.code}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant={item.assignedToMemberId ? 'info' : 'neutral'}>
                {memberName(item.assignedToMemberId)}
              </Badge>
              {hasMembers && (
                <Select
                  className="py-1.5 text-sm"
                  placeholder=""
                  options={memberOptions}
                  value={item.assignedToMemberId ?? ''}
                  disabled={saving}
                  onChange={(e) => assignItem(type, item, e.target.value)}
                  aria-label={`Assign ${item.label}`}
                />
              )}
            </div>
          </div>
          {!hasMembers && (
            <p className="mt-2 text-xs text-gray-500">
              <Link href="/dashboard/teams" className="text-pink-600 hover:underline">
                Add team members on the My Team page
              </Link>{' '}
              to assign this item.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
        </li>
      )
    }

    return (
      <div>
        <Header title="Team Inventory" />

        <div className="p-4 lg:p-6 space-y-6">
          {/* Info Banner */}
          <Card variant="bordered" className="bg-pink-50 border-pink-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-pink-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-700">
                    These are items Pink Posts Installations currently has in storage for your team.
                    Assign individual items to team members so everyone knows what&apos;s theirs.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Agent filter */}
          <Card variant="bordered">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <label className="text-sm font-medium text-gray-700 sm:w-auto">
                  Filter by agent
                </label>
                <div className="sm:max-w-xs w-full">
                  <Select
                    placeholder=""
                    options={filterOptions}
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {loading || teamLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !hasTeamInventory ? (
            <Card variant="bordered">
              <CardContent className="p-12 text-center">
                <Archive className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Items in Storage</h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  {agentFilter
                    ? 'No items match this filter. Try selecting a different agent.'
                    : "You don't have any items stored with us yet. When you have signs, riders, lockboxes, or brochure boxes in our storage, they'll appear here and can be assigned to your team."}
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
                      <p className="text-sm text-gray-500">{teamInventory?.signs.length || 0} in storage</p>
                    </div>
                  </div>

                  {teamInventory?.signs && teamInventory.signs.length > 0 ? (
                    <ScrollableList itemCount={teamInventory.signs.length}>
                      {teamInventory.signs.map((sign) => renderItem('sign', sign))}
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
                      <p className="text-sm text-gray-500">{teamInventory?.riders.length || 0} in storage</p>
                    </div>
                  </div>

                  {teamInventory?.riders && teamInventory.riders.length > 0 ? (
                    <ScrollableList itemCount={teamInventory.riders.length}>
                      {teamInventory.riders.map((rider) => renderItem('rider', rider))}
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
                      <p className="text-sm text-gray-500">{teamInventory?.lockboxes.length || 0} in storage</p>
                    </div>
                  </div>

                  {teamInventory?.lockboxes && teamInventory.lockboxes.length > 0 ? (
                    <ScrollableList itemCount={teamInventory.lockboxes.length}>
                      {teamInventory.lockboxes.map((lockbox) => renderItem('lockbox', lockbox))}
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
                      <p className="text-sm text-gray-500">{teamInventory?.brochureBoxes.length || 0} in storage</p>
                    </div>
                  </div>

                  {teamInventory?.brochureBoxes && teamInventory.brochureBoxes.length > 0 ? (
                    <ScrollableList itemCount={teamInventory.brochureBoxes.length}>
                      {teamInventory.brochureBoxes.map((box) => renderItem('brochure_box', box))}
                    </ScrollableList>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No brochure boxes in storage</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* How it works */}
          <HowInventoryWorks />
        </div>
      </div>
    )
  }

  // ----- Customer (non-team-admin) view — unchanged -----
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
        <HowInventoryWorks />
      </div>
    </div>
  )
}
