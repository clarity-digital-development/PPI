'use client'

import { useCallback, useMemo, useState } from 'react'
import { Minus, Plus, MapPin, Sun, ChevronDown, ChevronUp, Package } from 'lucide-react'
import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import { RiderSelector, RIDERS, type SelectedRider } from '../RiderSelector'
import { ExpandableImage } from '../ExpandableImage'
import type { StepProps, RiderSelection } from '../types'
import { PRICING } from '../types'

function toRiderSelection(selected: SelectedRider): RiderSelection {
  const rider = RIDERS.find(r => r.id === selected.riderId)
  return {
    rider_type: rider?.slug || selected.riderId,
    is_rental: selected.source === 'rental',
    quantity: 1,
    custom_value: selected.customValue?.toString(),
  }
}

function toSelectedRider(selection: RiderSelection): SelectedRider | null {
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

interface CollapsibleProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
  badge?: string
}

function Collapsible({ title, defaultOpen = false, children, badge }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">{title}</span>
          {badge && (
            <span className="text-xs font-medium text-pink-600 bg-pink-50 px-2 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
      </button>
      {open && <div className="p-4 bg-white">{children}</div>}
    </div>
  )
}

export function SecondPostStep({ formData, updateFormData, inventory }: StepProps) {
  const enabled = formData.second_post_enabled

  const customerInventory = useMemo(() => {
    return inventory?.riders?.map(rider => ({
      id: rider.id,
      riderType: rider.rider_type,
      quantity: rider.quantity,
    })) || []
  }, [inventory?.riders])

  const selectedRiders = useMemo(() => {
    return formData.second_post_riders
      .map(toSelectedRider)
      .filter((r): r is SelectedRider => r !== null)
  }, [formData.second_post_riders])

  const handleSelectionChange = useCallback((newSelection: SelectedRider[]) => {
    const riderSelections = newSelection.map(toRiderSelection)
    updateFormData({ second_post_riders: riderSelections })
  }, [updateFormData])

  const hasStoredSigns = inventory?.signs && inventory.signs.length > 0

  // Group signs by description for the dropdown
  const signOptions = useMemo(() => {
    if (!hasStoredSigns) return []
    const grouped: Record<string, { id: string; label: string }> = {}
    for (const sign of inventory!.signs) {
      const label = `${sign.description}${sign.size ? ` (${sign.size})` : ''}`
      if (!grouped[label]) grouped[label] = { id: sign.id, label }
    }
    return Object.values(grouped).map(g => ({ value: g.id, label: g.label }))
  }, [hasStoredSigns, inventory])

  const ridersCount = formData.second_post_riders.length
  const wireFrameCount = formData.second_post_wire_frame_quantity
  const solarCount = formData.second_post_solar_lighting_quantity
  const hasAnyExtras = ridersCount > 0 || wireFrameCount > 0 || solarCount > 0
  const hasSign = formData.second_post_sign_option !== 'none'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Second Post</h2>
        <p className="text-gray-600">Need a second post installed at the same property?</p>
      </div>

      {/* Yes/No toggle */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => updateFormData({ second_post_enabled: false })}
          className={cn(
            'p-4 rounded-xl border-2 text-left transition-all',
            !enabled
              ? 'border-pink-500 bg-pink-50 ring-2 ring-pink-200'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <p className="font-semibold text-gray-900">No, just one post</p>
          <p className="text-sm text-gray-600 mt-1">Continue to lockbox selection</p>
        </button>

        <button
          type="button"
          onClick={() => updateFormData({ second_post_enabled: true })}
          className={cn(
            'p-4 rounded-xl border-2 text-left transition-all',
            enabled
              ? 'border-pink-500 bg-pink-50 ring-2 ring-pink-200'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <p className="font-semibold text-gray-900">Yes, add a second post</p>
          <p className="text-sm font-medium text-pink-600 mt-1">+${PRICING.second_post}</p>
        </button>
      </div>

      {enabled && (
        <div className="space-y-4">
          {/* Install location notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Install Location</label>
            <textarea
              value={formData.second_post_install_location || ''}
              onChange={(e) => updateFormData({ second_post_install_location: e.target.value })}
              placeholder="Install location"
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Sign for second post */}
          <Collapsible
            title="Sign"
            defaultOpen={hasSign}
            badge={hasSign ? formData.second_post_sign_option === 'stored' ? 'From inventory' : 'At property' : undefined}
          >
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => updateFormData({ second_post_sign_option: 'none', second_post_stored_sign_id: undefined })}
                className={cn(
                  'w-full p-3 rounded-lg border-2 text-left transition-all',
                  formData.second_post_sign_option === 'none'
                    ? 'border-pink-500 bg-pink-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <p className="font-medium text-gray-900">No sign</p>
              </button>

              <button
                type="button"
                onClick={() => updateFormData({ second_post_sign_option: 'at_property', second_post_stored_sign_id: undefined })}
                className={cn(
                  'w-full p-3 rounded-lg border-2 text-left transition-all',
                  formData.second_post_sign_option === 'at_property'
                    ? 'border-pink-500 bg-pink-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <p className="font-medium text-gray-900">Sign at property or pickup from another location</p>
                <p className="text-sm text-pink-600 mt-1">Install fee: ${PRICING.sign_install.toFixed(2)}</p>
              </button>

              {hasStoredSigns && (
                <button
                  type="button"
                  onClick={() => updateFormData({ second_post_sign_option: 'stored' })}
                  className={cn(
                    'w-full p-3 rounded-lg border-2 text-left transition-all',
                    formData.second_post_sign_option === 'stored'
                      ? 'border-pink-500 bg-pink-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-500" />
                    <p className="font-medium text-gray-900">Use sign from inventory</p>
                  </div>
                  <p className="text-sm text-pink-600 mt-1">Install fee: ${PRICING.sign_install.toFixed(2)}</p>
                </button>
              )}

              {formData.second_post_sign_option === 'stored' && hasStoredSigns && (
                <div className="p-3 bg-gray-50 rounded-lg">
                  <Select
                    label="Select sign"
                    value={formData.second_post_stored_sign_id || ''}
                    onChange={(e) => updateFormData({ second_post_stored_sign_id: e.target.value })}
                    options={signOptions}
                  />
                </div>
              )}
            </div>
          </Collapsible>

          {/* Riders for second post */}
          <Collapsible title="Riders" defaultOpen={ridersCount > 0} badge={ridersCount > 0 ? `${ridersCount} selected` : undefined}>
            <RiderSelector
              selectedRiders={selectedRiders}
              onSelectionChange={handleSelectionChange}
              customerInventory={customerInventory}
              rentalPrice={PRICING.rider_rental}
              installPrice={PRICING.rider_install}
            />
          </Collapsible>

          {/* Wire Frame Signs for second post */}
          <Collapsible title="Wire Frame Signs" defaultOpen={wireFrameCount > 0} badge={wireFrameCount > 0 ? `×${wireFrameCount}` : undefined}>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                ${PRICING.wire_frame_sign} each. Place directional/for sale/open house signs.
              </p>
              <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-4">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Quantity</p>
                  {wireFrameCount > 0 && (
                    <p className="text-sm text-pink-600 font-medium">
                      ${(wireFrameCount * PRICING.wire_frame_sign).toFixed(2)} total
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => updateFormData({ second_post_wire_frame_quantity: Math.max(0, wireFrameCount - 1) })}
                    disabled={wireFrameCount === 0}
                    className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center text-lg font-semibold text-gray-900">{wireFrameCount}</span>
                  <button
                    type="button"
                    onClick={() => updateFormData({ second_post_wire_frame_quantity: wireFrameCount + 1 })}
                    className="w-9 h-9 rounded-lg border border-pink-300 bg-pink-50 flex items-center justify-center text-pink-600 hover:bg-pink-100 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </Collapsible>

          {/* Solar Lighting for second post */}
          <Collapsible title="Solar Lighting" defaultOpen={solarCount > 0} badge={solarCount > 0 ? `×${solarCount}` : undefined}>
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-4">
                <ExpandableImage
                  src="/images/posts/solar-light.jpg"
                  alt="Solar lighting"
                />
                <p className="text-sm text-gray-600 flex-1">
                  ${PRICING.solar_lighting} per light. If one is chosen, it will be placed for the most directional traffic. Select two for both directions.
                </p>
              </div>

              <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-4">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Quantity</p>
                  {solarCount > 0 && (
                    <p className="text-sm text-pink-600 font-medium">
                      ${(solarCount * PRICING.solar_lighting).toFixed(2)} total
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => updateFormData({ second_post_solar_lighting_quantity: Math.max(0, solarCount - 1) })}
                    disabled={solarCount === 0}
                    className="w-9 h-9 rounded-lg border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-8 text-center text-lg font-semibold text-gray-900">{solarCount}</span>
                  <button
                    type="button"
                    onClick={() => updateFormData({ second_post_solar_lighting_quantity: solarCount + 1 })}
                    className="w-9 h-9 rounded-lg border border-pink-300 bg-pink-50 flex items-center justify-center text-pink-600 hover:bg-pink-100 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  )
}
