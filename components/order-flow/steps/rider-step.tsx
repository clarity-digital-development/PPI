'use client'

import { useCallback, useMemo } from 'react'
import { Minus, Plus, MapPin } from 'lucide-react'
import { RiderSelector, RIDERS, type SelectedRider } from '../RiderSelector'
import type { StepProps, RiderSelection } from '../types'
import { PRICING } from '../types'

// Convert from RiderSelector format to order form format
function toRiderSelection(selected: SelectedRider): RiderSelection {
  const rider = RIDERS.find(r => r.id === selected.riderId)
  return {
    rider_type: rider?.slug || selected.riderId,
    is_rental: selected.source === 'rental',
    quantity: 1,
    custom_value: selected.customValue?.toString(),
  }
}

// Convert from order form format to RiderSelector format
function toSelectedRider(selection: RiderSelection): SelectedRider | null {
  // Find the rider by slug (try popular version first, then regular)
  let rider = RIDERS.find(r => r.slug === selection.rider_type && r.category === 'popular')
  if (!rider) {
    rider = RIDERS.find(r => r.slug === selection.rider_type)
  }

  if (!rider) return null

  return {
    riderId: rider.id,
    source: selection.is_rental ? 'rental' : 'owned',
    price: selection.is_rental ? PRICING.rider_rental : PRICING.rider_install,
    customValue: selection.custom_value ? parseFloat(selection.custom_value) || selection.custom_value : undefined,
  }
}

export function RiderStep({ formData, updateFormData, inventory }: StepProps) {
  // Convert inventory riders to CustomerRiderInventory format
  const customerInventory = useMemo(() => {
    return inventory?.riders?.map(rider => ({
      id: rider.id,
      riderType: rider.rider_type,
      quantity: rider.quantity,
    })) || []
  }, [inventory?.riders])

  // Convert form data riders to SelectedRider format
  const selectedRiders = useMemo(() => {
    return formData.riders
      .map(toSelectedRider)
      .filter((r): r is SelectedRider => r !== null)
  }, [formData.riders])

  // Handle selection changes from RiderSelector
  const handleSelectionChange = useCallback((newSelection: SelectedRider[]) => {
    const riderSelections = newSelection.map(toRiderSelection)
    updateFormData({ riders: riderSelections })
  }, [updateFormData])

  return (
    <div className="space-y-8">
      <RiderSelector
        selectedRiders={selectedRiders}
        onSelectionChange={handleSelectionChange}
        customerInventory={customerInventory}
        rentalPrice={PRICING.rider_rental}
        installPrice={PRICING.rider_install}
      />

      {/* Wire Frame Signs */}
      <div className="border-t border-gray-200 pt-6">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-pink-500" />
          <h3 className="text-lg font-semibold text-gray-900">Wire Frame Sign Install</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Place directional/for sale/open house signs at the property or heading into the neighborhood from the road. ${PRICING.wire_frame_sign} each.
        </p>

        <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-4">
          <div className="flex-1">
            <p className="font-medium text-gray-900">Quantity</p>
            {formData.wire_frame_quantity > 0 && (
              <p className="text-sm text-pink-600 font-medium">
                ${(formData.wire_frame_quantity * PRICING.wire_frame_sign).toFixed(2)} total
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => updateFormData({ wire_frame_quantity: Math.max(0, formData.wire_frame_quantity - 1) })}
              disabled={formData.wire_frame_quantity === 0}
              className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center text-lg font-semibold text-gray-900">
              {formData.wire_frame_quantity}
            </span>
            <button
              type="button"
              onClick={() => updateFormData({ wire_frame_quantity: formData.wire_frame_quantity + 1 })}
              className="w-9 h-9 rounded-lg border border-pink-300 bg-pink-50 flex items-center justify-center text-pink-600 hover:bg-pink-100 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
