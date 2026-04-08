'use client'

import { useState, useCallback, useMemo } from 'react'
import type {
  SelectedRider,
  RiderSource,
  RiderCategory,
  CustomerRiderInventory,
  RiderOption
} from '../types'
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
  removeRider: (riderId: string) => void
  clearAll: () => void
  updateAcres: (riderId: string, value: number | null) => void
  toggleCategory: (category: RiderCategory) => void

  // Computed
  totalPrice: number
  isRiderSelected: (riderId: string) => boolean
  isRiderAvailable: (rider: RiderOption) => boolean
  getSelectedCount: (category: RiderCategory) => number
  getRiderPrice: () => number
}

export function useRiderSelection({
  initialRiders = [],
  customerInventory = [],
  rentalPrice = RIDER_PRICING.rental,
  installPrice = RIDER_PRICING.install,
}: UseRiderSelectionOptions = {}): UseRiderSelectionReturn {
  const [selectedRiders, setSelectedRiders] = useState<SelectedRider[]>(initialRiders)
  const [source, setSourceState] = useState<RiderSource>('rental')
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
          riderId: rider.id,
          source,
          price,
          customValue: rider.requiresInput ? customValue : undefined
        }

        return [...prev, newRider]
      }
    })
  }, [source, rentalPrice, installPrice])

  const removeRider = useCallback((riderId: string) => {
    setSelectedRiders(prev => prev.filter(r => r.riderId !== riderId))
  }, [])

  const clearAll = useCallback(() => {
    setSelectedRiders([])
  }, [])

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
          return [...prev, { riderId, source, price, customValue: value }]
        }
      })
    }
  }, [source, rentalPrice, installPrice])

  const setSource = useCallback((newSource: RiderSource) => {
    const newPrice = newSource === 'rental' ? rentalPrice : installPrice

    // Update all selected riders to new source/price
    setSelectedRiders(prev => {
      let updated = prev.map(rider => ({
        ...rider,
        source: newSource,
        price: newPrice
      }))

      // If switching to "owned", filter out riders not in inventory
      if (newSource === 'owned' && customerInventory.length > 0) {
        const availableSlugs = customerInventory.map(inv => inv.riderType)
        updated = updated.filter(rider => {
          const riderData = RIDERS.find(r => r.id === rider.riderId)
          // For riders in RIDERS constants, check slug; for inventory-only riders, check riderId
          return riderData
            ? availableSlugs.includes(riderData.slug)
            : availableSlugs.includes(rider.riderId)
        })
      }

      return updated
    })

    setSourceState(newSource)
  }, [customerInventory, rentalPrice, installPrice])

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
    if (source === 'rental') return true
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
    totalPrice,
    isRiderSelected,
    isRiderAvailable,
    getSelectedCount,
    getRiderPrice,
  }
}
