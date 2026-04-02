'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Info } from 'lucide-react'
import {
  RiderSourceToggle,
  PopularRiders,
  RiderCategoryAccordion,
  CustomRiderInput,
  SelectedRidersList,
} from './components'
import { useRiderSelection } from './hooks/useRiderSelection'
import { RIDER_CATEGORIES, RIDERS, getRidersByCategory, RIDER_PRICING } from './constants'
import type { RiderSelectorProps } from './types'

export function RiderSelector({
  selectedRiders: externalRiders,
  onSelectionChange,
  customerInventory = [],
  rentalPrice = RIDER_PRICING.rental,
  installPrice = RIDER_PRICING.install,
  disabled = false,
}: RiderSelectorProps) {
  const {
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
  } = useRiderSelection({
    initialRiders: externalRiders,
    customerInventory,
    rentalPrice,
    installPrice,
  })

  // Sync with parent whenever selection changes
  useMemo(() => {
    onSelectionChange(selectedRiders)
  }, [selectedRiders, onSelectionChange])

  const price = getRiderPrice()
  const hasInventory = customerInventory.length > 0

  // Get custom riders that require input
  const customRiders = RIDERS.filter(r => r.requiresInput)

  // Categories to show (exclude popular since it's shown separately, exclude custom since we handle it below)
  const categoriesToShow = RIDER_CATEGORIES.filter(c => c.id !== 'popular' && c.id !== 'custom')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Add Riders</h2>
        <p className="text-gray-600">
          Optional - Select any riders you&apos;d like to add to your installation.
        </p>
      </div>

      {/* Pricing Info */}
      <div className="flex items-start gap-3 p-4 bg-pink-50 rounded-lg">
        <Info className="w-5 h-5 text-pink-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-gray-900">Rider Pricing</p>
          <p className="text-gray-600">
            Install your own riders for <span className="font-semibold">${installPrice}</span> each,
            or rent one of our riders for <span className="font-semibold">${rentalPrice}</span>!
          </p>
          <Link
            href="/riders#terms"
            target="_blank"
            className="text-pink-600 hover:text-pink-700 underline mt-1 inline-block"
          >
            View Rental Terms & Conditions
          </Link>
        </div>
      </div>

      {/* Inventory Status */}
      {hasInventory ? (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 font-medium">
            You have riders in your inventory ({customerInventory.map(inv => `${inv.quantity}x ${inv.riderType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`).join(', ')})
          </p>
          <p className="text-xs text-green-700 mt-0.5">Select &ldquo;My Riders&rdquo; below to install from your inventory at ${installPrice} each.</p>
        </div>
      ) : (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">No riders currently in your inventory. You can rent riders below, or contact your admin to add riders to your account.</p>
        </div>
      )}

      {/* Source Toggle */}
      <RiderSourceToggle
        source={source}
        onSourceChange={setSource}
        hasInventory={hasInventory}
      />

      {/* Popular Riders */}
      <PopularRiders
        source={source}
        price={price}
        isSelected={isRiderSelected}
        isAvailable={isRiderAvailable}
        onToggle={toggleRider}
      />

      {/* Category Accordions */}
      <div className="space-y-2">
        {categoriesToShow.map(category => {
          const riders = getRidersByCategory(category.id)
          if (riders.length === 0) return null

          return (
            <RiderCategoryAccordion
              key={category.id}
              category={category}
              riders={riders}
              isExpanded={expandedCategories.has(category.id)}
              onToggleExpand={() => toggleCategory(category.id)}
              source={source}
              price={price}
              isSelected={isRiderSelected}
              isAvailable={isRiderAvailable}
              onToggle={toggleRider}
              selectedCount={getSelectedCount(category.id)}
            />
          )
        })}
      </div>

      {/* Custom Riders Section */}
      {customRiders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Custom Riders</h3>
          <div className="space-y-3">
            {customRiders.map(rider => {
              const isSelected = isRiderSelected(rider.id)
              const customValue = selectedRiders.find(r => r.riderId === rider.id)?.customValue as number | undefined

              return (
                <CustomRiderInput
                  key={rider.id}
                  rider={rider}
                  isSelected={isSelected}
                  value={customValue || null}
                  onChange={(value) => updateAcres(rider.id, value)}
                  price={price}
                  source={source}
                  isRiderAvailable={isRiderAvailable}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Selected Riders Summary */}
      <SelectedRidersList
        selectedRiders={selectedRiders}
        onRemove={removeRider}
        onClearAll={clearAll}
        totalPrice={totalPrice}
      />
    </div>
  )
}
