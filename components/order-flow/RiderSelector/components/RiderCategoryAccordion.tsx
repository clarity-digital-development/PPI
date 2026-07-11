'use client'

import { ChevronDown, ChevronUp, Tag, Bed, Home, Key, Sparkles, Edit } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RiderChip } from './RiderChip'
import type { RiderCategoryConfig, RiderOption, RiderSource } from '../types'

const iconMap: Record<string, typeof Tag> = {
  Tag,
  Bed,
  Home,
  Key,
  Sparkles,
  Edit,
}

interface RiderCategoryAccordionProps {
  category: RiderCategoryConfig
  riders: RiderOption[]
  isExpanded: boolean
  onToggleExpand: () => void
  source: RiderSource
  getPrice: (riderId: string) => number
  isSelected: (riderId: string) => boolean
  isAvailable: (rider: RiderOption) => boolean
  onToggle: (rider: RiderOption) => void
  selectedCount: number
}

export function RiderCategoryAccordion({
  category,
  riders,
  isExpanded,
  onToggleExpand,
  source,
  getPrice,
  isSelected,
  isAvailable,
  onToggle,
  selectedCount,
}: RiderCategoryAccordionProps) {
  const Icon = category.icon ? iconMap[category.icon] || Tag : Tag

  // Filter out custom riders that need special handling
  const standardRiders = riders.filter(r => !r.requiresInput)

  if (standardRiders.length === 0) return null

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-controls={`category-${category.id}-content`}
        className={cn(
          'w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors'
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-gray-500" />
          <span className="font-medium text-gray-900">{category.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <span className="text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">
              {selectedCount}/{standardRiders.length}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div
          id={`category-${category.id}-content`}
          role="group"
          className="p-4 grid grid-cols-2 md:grid-cols-3 gap-2"
        >
          {standardRiders.map(rider => {
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
      )}
    </div>
  )
}
