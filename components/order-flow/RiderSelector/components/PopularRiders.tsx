'use client'

import { Star } from 'lucide-react'
import { RiderChip } from './RiderChip'
import { RIDERS, POPULAR_RIDER_IDS } from '../constants'
import type { RiderOption, RiderSource } from '../types'

interface PopularRidersProps {
  source: RiderSource
  getPrice: (riderId: string) => number
  isSelected: (riderId: string) => boolean
  isAvailable: (rider: RiderOption) => boolean
  onToggle: (rider: RiderOption) => void
}

export function PopularRiders({
  source,
  getPrice,
  isSelected,
  isAvailable,
  onToggle,
}: PopularRidersProps) {
  const popularRiders = RIDERS.filter(r => POPULAR_RIDER_IDS.includes(r.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Star className="w-4 h-4 text-amber-500" />
        <span>Popular</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {popularRiders.map(rider => {
          const available = isAvailable(rider)
          return (
            <RiderChip
              key={rider.id}
              rider={rider}
              isSelected={isSelected(rider.id)}
              isDisabled={!available}
              price={getPrice(rider.id)}
              source={source}
              onClick={() => available && onToggle(rider)}
              disabledReason={!available ? 'Not in stock' : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}
