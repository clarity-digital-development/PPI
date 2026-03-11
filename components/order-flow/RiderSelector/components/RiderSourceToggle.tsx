'use client'

import { Package, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RiderSource } from '../types'
import { RIDER_PRICING } from '../constants'

interface RiderSourceToggleProps {
  source: RiderSource
  onSourceChange: (source: RiderSource) => void
  hasInventory: boolean
}

export function RiderSourceToggle({
  source,
  onSourceChange,
  hasInventory,
}: RiderSourceToggleProps) {
  return (
    <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
      {hasInventory && (
        <button
          type="button"
          onClick={() => onSourceChange('owned')}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all',
            source === 'owned'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          )}
        >
          <Package className="w-4 h-4" />
          <div className="text-left">
            <div>My Riders</div>
            <div className="text-xs text-gray-500">${RIDER_PRICING.install} each</div>
          </div>
        </button>
      )}
      <button
        type="button"
        onClick={() => onSourceChange('rental')}
        className={cn(
          'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all',
          source === 'rental'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-600 hover:text-gray-900'
        )}
      >
        <Tag className="w-4 h-4" />
        <div className="text-left">
          <div>Rent Riders</div>
          <div className="text-xs text-gray-500">${RIDER_PRICING.rental} each</div>
        </div>
      </button>
    </div>
  )
}
