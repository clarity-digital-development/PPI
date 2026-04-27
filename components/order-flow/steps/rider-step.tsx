'use client'

import { useCallback, useMemo } from 'react'
import Image from 'next/image'
import { Minus, Plus, MapPin, Sun } from 'lucide-react'
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

        {formData.wire_frame_quantity > 0 && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Installation Instructions
            </label>
            <textarea
              value={formData.wire_frame_notes || ''}
              onChange={(e) => updateFormData({ wire_frame_notes: e.target.value })}
              placeholder="e.g. open house address, directional sign locations..."
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">Pink Posts is not responsible for any missing or removed signs.</p>
          </div>
        )}
      </div>

      {/* Solar Lighting */}
      <div className="border-t border-gray-200 pt-6">
        <div className="flex items-center gap-2 mb-2">
          <Sun className="w-5 h-5 text-pink-500" />
          <h3 className="text-lg font-semibold text-gray-900">Solar Lighting</h3>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative w-full sm:w-32 h-40 sm:h-32 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
            <Image
              src="/images/posts/solar-light.jpg"
              alt="Solar lighting installed at sign"
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, 128px"
            />
          </div>
          <p className="text-sm text-gray-600 flex-1">
            ${PRICING.solar_lighting} per light. If one is chosen, it will be placed for the most directional traffic. If you want both directions, select two lights.
          </p>
        </div>

        <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-4">
          <div className="flex-1">
            <p className="font-medium text-gray-900">Quantity</p>
            {formData.solar_lighting_quantity > 0 && (
              <p className="text-sm text-pink-600 font-medium">
                ${(formData.solar_lighting_quantity * PRICING.solar_lighting).toFixed(2)} total
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => updateFormData({ solar_lighting_quantity: Math.max(0, formData.solar_lighting_quantity - 1) })}
              disabled={formData.solar_lighting_quantity === 0}
              className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center text-lg font-semibold text-gray-900">
              {formData.solar_lighting_quantity}
            </span>
            <button
              type="button"
              onClick={() => updateFormData({ solar_lighting_quantity: formData.solar_lighting_quantity + 1 })}
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
