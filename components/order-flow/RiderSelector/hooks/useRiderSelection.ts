'use client'

import { useState, useCallback, useMemo } from 'react'
import type {
  SelectedRider,
  RiderSource,
  RiderCategory,
  CustomerRiderInventory,
  RiderOption
} from '../types'
import { generateRiderInstanceId } from '../types'
import { RIDERS, RIDER_PRICING } from '../constants'

interface UseRiderSelectionOptions {
  initialRiders?: SelectedRider[]
  customerInventory?: CustomerRiderInventory[]
  rentalPrice?: number
  installPrice?: number
}

interface UseRiderSelectionReturn {
  // State
  selectedRiders: SelectedRider[]
  source: RiderSource
  expandedCategories: Set<RiderCategory>

  // Actions
  setSource: (source: RiderSource) => void
  toggleRider: (rider: RiderOption, customValue?: string | number) => void
  removeRider: (instanceId: string) => void
  clearAll: () => void
  updateAcres: (riderId: string, value: number | null) => void
  toggleCategory: (category: RiderCategory) => void
  addCustomTextRider: (name: string) => void

  // Computed
  totalPrice: number
  isRiderSelected: (riderId: string) => boolean
  isRiderAvailable: (rider: RiderOption) => boolean
  getSelectedCount: (category: RiderCategory) => number
  getRiderPrice: () => number
  getDisplayPrice: (riderId: string) => number
}

// Collapses accidental duplicate riderIds down to the first occurrence. The
// UI never lets a customer intentionally select the same rider twice
// (toggleRider's own dedup check prevents it), so a duplicate is always
// leftover corruption from a prior bad save. Logged so a self-heal is
// traceable instead of silently vanishing a line item off an order.
function dedupeByRiderId(riders: SelectedRider[]): SelectedRider[] {
  const seen = new Set<string>()
  const deduped = riders.filter(r => {
    if (seen.has(r.riderId)) return false
    seen.add(r.riderId)
    return true
  })
  const dropped = riders.length - deduped.length
  if (dropped > 0 && typeof console !== 'undefined') {
    console.warn(
      `[useRiderSelection] Dropped ${dropped} duplicate rider entr${dropped === 1 ? 'y' : 'ies'} sharing a riderId — this should never happen from normal selection, only from leftover corrupted data.`
    )
  }
  return deduped
}

export function useRiderSelection({
  initialRiders = [],
  customerInventory = [],
  rentalPrice = RIDER_PRICING.rental,
  installPrice = RIDER_PRICING.install,
}: UseRiderSelectionOptions = {}): UseRiderSelectionReturn {
  const [selectedRiders, setSelectedRidersState] = useState<SelectedRider[]>(() => dedupeByRiderId(initialRiders))
  // Every mutation funnels through this so "no two entries share a riderId"
  // holds continuously, not just at mount — the mount-only version of this
  // check (dedupeByRiderId inside useState's initializer alone) only made an
  // EXISTING duplicate removable/self-healing on next remount; it did nothing
  // to stop a duplicate from re-forming mid-session if whatever produced the
  // original bug (still not fully root-caused — see the useMemo->useEffect
  // fix in RiderSelector.tsx) fired again before the component unmounted.
  const setSelectedRiders = useCallback(
    (updater: SelectedRider[] | ((prev: SelectedRider[]) => SelectedRider[])) => {
      setSelectedRidersState(prev => {
        const next = typeof updater === 'function' ? (updater as (p: SelectedRider[]) => SelectedRider[])(prev) : updater
        return dedupeByRiderId(next)
      })
    },
    []
  )
  // Boot to 'at_property' (safe / no billing surprise) unless we're resuming an
  // in-progress order that already has a chosen source. Old default was 'rental'
  // which meant admins placing team_admin on-behalf-of orders would silently
  // rent riders even when the target agent had matching inventory (Randi Means
  // 2026-07-07). Ryan: "Make them click if they want inventory or to rent."
  const [source, setSourceState] = useState<RiderSource>(
    initialRiders[0]?.source ?? 'at_property'
  )
  const [expandedCategories, setExpandedCategories] = useState<Set<RiderCategory>>(
    new Set<RiderCategory>(['popular'])
  )

  const getRiderPrice = useCallback(() => {
    return source === 'rental' ? rentalPrice : installPrice
  }, [source, rentalPrice, installPrice])

  const toggleRider = useCallback((rider: RiderOption, customValue?: string | number) => {
    setSelectedRiders(prev => {
      // Check if this rider (by slug) is already selected
      const existingIndex = prev.findIndex(r => {
        const riderData = RIDERS.find(rd => rd.id === r.riderId)
        // For riders not in RIDERS constants, match by riderId directly against slug
        return riderData ? riderData.slug === rider.slug : r.riderId === rider.id
      })

      if (existingIndex >= 0) {
        // Deselect - remove from array
        return prev.filter((_, i) => i !== existingIndex)
      } else {
        // Select - add to array
        const price = source === 'rental' ? rentalPrice : installPrice

        const newRider: SelectedRider = {
          instanceId: generateRiderInstanceId(),
          riderId: rider.id,
          source,
          price,
          customValue: rider.requiresInput ? customValue : undefined
        }

        return [...prev, newRider]
      }
    })
  }, [source, rentalPrice, installPrice, setSelectedRiders])

  // Removes by instanceId, not riderId — two entries can end up sharing a
  // riderId (legacy corrupted orders; see dedupeByRiderId above), and filtering
  // by riderId would delete every one of them at once instead of just the
  // single chip the customer clicked "remove" on (Ryan, 2026-07-16: "When I
  // clicked remove on one, it removed both").
  const removeRider = useCallback((instanceId: string) => {
    setSelectedRiders(prev => prev.filter(r => r.instanceId !== instanceId))
  }, [setSelectedRiders])

  const clearAll = useCallback(() => {
    setSelectedRiders([])
  }, [setSelectedRiders])

  const updateAcres = useCallback((riderId: string, value: number | null) => {
    if (value === null) {
      setSelectedRiders(prev => prev.filter(r => r.riderId !== riderId))
    } else {
      setSelectedRiders(prev => {
        const existingIndex = prev.findIndex(r => r.riderId === riderId)
        if (existingIndex >= 0) {
          const updated = [...prev]
          updated[existingIndex] = { ...updated[existingIndex], customValue: value }
          return updated
        } else {
          // Add new acres rider
          const price = source === 'rental' ? rentalPrice : installPrice
          return [...prev, { instanceId: generateRiderInstanceId(), riderId, source, price, customValue: value }]
        }
      })
    }
  }, [source, rentalPrice, installPrice, setSelectedRiders])

  // Switches which pricing tier NEW selections use — it must never touch
  // riders already in the array (including ones loaded from a saved order).
  // It used to map over every selectedRider and force its source/price to
  // match the newly active tab, so re-opening an edit and just browsing a
  // different tab silently repriced (and, for "owned", could delete) riders
  // the customer never touched (Ryan, 2026-07-11).
  const setSource = useCallback((newSource: RiderSource) => {
    setSourceState(newSource)
  }, [])

  // Add a free-text custom rider (pickup/at-property only). Each call mints a
  // unique riderId so multiple custom names can coexist; the typed name lives
  // in customValue and flows through to the order item description.
  const addCustomTextRider = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = `custom-text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const price = source === 'rental' ? rentalPrice : installPrice
    setSelectedRiders(prev => [
      ...prev,
      { instanceId: generateRiderInstanceId(), riderId: id, source, price, customValue: trimmed },
    ])
  }, [source, rentalPrice, installPrice, setSelectedRiders])

  const toggleCategory = useCallback((category: RiderCategory) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }, [])

  const isRiderSelected = useCallback((riderId: string) => {
    const rider = RIDERS.find(r => r.id === riderId)
    if (!rider) {
      // For riders not in RIDERS constants (inventory-only), check by riderId directly
      return selectedRiders.some(selected => selected.riderId === riderId)
    }

    return selectedRiders.some(selected => {
      const selectedRider = RIDERS.find(r => r.id === selected.riderId)
      return selectedRider?.slug === rider.slug
    })
  }, [selectedRiders])

  const isRiderAvailable = useCallback((rider: RiderOption) => {
    // 'rental' = we provide it, always available
    // 'at_property' = customer brings it to the property, always available
    // 'owned' = must be in the customer's inventory
    if (source === 'rental' || source === 'at_property') return true
    if (customerInventory.length === 0) return false
    return customerInventory.some(inv => inv.riderType === rider.slug && inv.quantity > 0)
  }, [source, customerInventory])

  const getSelectedCount = useCallback((category: RiderCategory) => {
    const categoryRiders = RIDERS.filter(r => r.category === category)
    return selectedRiders.filter(selected => {
      const rider = RIDERS.find(r => r.id === selected.riderId)
      return rider && categoryRiders.some(cr => cr.slug === rider.slug)
    }).length
  }, [selectedRiders])

  // Chip/input price display. A rider stays selected globally regardless of
  // which tab is active (isRiderSelected, above), so once it's selected its
  // OWN stored price must be shown — not the currently-browsed tab's price —
  // or the label would contradict what SelectedRidersList (and the actual
  // charge) show for it. Only unselected riders fall back to the active
  // tab's price. Without this, browsing a different tab after selecting a
  // rider elsewhere would silently mislabel its price again, one layer up
  // from the setSource bug this was written alongside (Ryan, 2026-07-11).
  const getDisplayPrice = useCallback((riderId: string) => {
    const rider = RIDERS.find(r => r.id === riderId)
    const existing = rider
      ? selectedRiders.find(selected => {
          const selectedRider = RIDERS.find(r => r.id === selected.riderId)
          return selectedRider ? selectedRider.slug === rider.slug : selected.riderId === riderId
        })
      : selectedRiders.find(selected => selected.riderId === riderId)
    if (existing) return existing.price
    return source === 'rental' ? rentalPrice : installPrice
  }, [selectedRiders, source, rentalPrice, installPrice])

  const totalPrice = useMemo(() => {
    return selectedRiders.reduce((sum, rider) => sum + rider.price, 0)
  }, [selectedRiders])

  return {
    selectedRiders,
    source,
    expandedCategories,
    setSource,
    toggleRider,
    removeRider,
    clearAll,
    updateAcres,
    toggleCategory,
    addCustomTextRider,
    totalPrice,
    isRiderSelected,
    isRiderAvailable,
    getSelectedCount,
    getRiderPrice,
    getDisplayPrice,
  }
}
