'use client'

import { X } from 'lucide-react'
import type { SelectedRider } from '../types'
import { RIDERS } from '../constants'

interface SelectedRidersListProps {
  selectedRiders: SelectedRider[]
  onRemove: (instanceId: string) => void
  onClearAll: () => void
  totalPrice: number
}

export function SelectedRidersList({
  selectedRiders,
  onRemove,
  onClearAll,
  totalPrice,
}: SelectedRidersListProps) {
  if (selectedRiders.length === 0) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg text-center">
        <p className="text-gray-500 text-sm">No riders selected</p>
        <p className="text-gray-400 text-xs mt-1">Select riders above or skip this step</p>
      </div>
    )
  }

  return (
    <div className="p-4 bg-gray-50 rounded-lg" role="list" aria-label="Selected riders">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-gray-900">
          Selected Riders ({selectedRiders.length})
        </h4>
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-gray-500 hover:text-red-500 transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {selectedRiders.map(rider => {
          const riderData = RIDERS.find(r => r.id === rider.riderId)
          // Custom free-text rider (pickup/at-property) — riderId is a synthetic
          // "custom-text-..." key and customValue holds the typed name verbatim.
          const isCustomText = rider.riderId.startsWith('custom-text-')
          // Round 23 fix: when a rider's slug isn't in the RIDERS catalog
          // (e.g., Semonin's admin-managed agent-name riders), riderId IS the
          // slug. Humanize it ("robert-butler-w-photo" → "Robert Butler W Photo")
          // so the selected pill is readable instead of showing raw slug.
          const humanizedSlug = rider.riderId
            .split('-')
            .map(w => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
            .join(' ')
          const displayName = isCustomText
            ? String(rider.customValue || 'Custom rider')
            : rider.customValue
              ? `${rider.customValue} Acres`
              : riderData?.name || humanizedSlug
          const sourceLabel = rider.source === 'rental'
            ? 'Rental'
            : rider.source === 'at_property'
              ? 'Pickup'
              : 'Own'

          return (
            <div
              key={rider.instanceId}
              role="listitem"
              className="flex items-center gap-2 bg-pink-100 text-pink-800 px-3 py-1.5 rounded-full text-sm"
            >
              <span>{displayName}</span>
              <span className="text-pink-600 text-xs">
                {sourceLabel} ${rider.price}
              </span>
              <button
                type="button"
                onClick={() => onRemove(rider.instanceId)}
                aria-label={`Remove ${displayName} rider`}
                className="text-pink-600 hover:text-pink-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex justify-end pt-3 border-t border-gray-200">
        <div className="text-right">
          <span className="text-sm text-gray-600">Rider Total:</span>
          <span className="ml-2 text-lg font-bold text-pink-600">
            ${totalPrice.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}
