'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RiderOption, RiderSource } from '../types'

interface RiderChipProps {
  rider: RiderOption
  isSelected: boolean
  isDisabled: boolean
  price: number
  source: RiderSource
  onClick: () => void
  disabledReason?: string
}

export function RiderChip({
  rider,
  isSelected,
  isDisabled,
  price,
  onClick,
  disabledReason,
}: RiderChipProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isSelected}
      aria-label={`${rider.name} rider, $${price}, ${isSelected ? 'selected' : 'not selected'}`}
      disabled={isDisabled}
      onClick={onClick}
      className={cn(
        'relative flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 transition-all w-full text-center min-h-[60px]',
        isSelected && 'border-pink-500 bg-pink-50',
        !isSelected && !isDisabled && 'border-gray-200 hover:border-gray-300 bg-white',
        isDisabled && 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
      )}
    >
      {isSelected && (
        <Check className="absolute top-1.5 left-1.5 w-3.5 h-3.5 text-pink-500 flex-shrink-0" />
      )}
      <span className={cn(
        'text-sm font-medium leading-tight',
        isSelected ? 'text-pink-700' : 'text-gray-900',
        isDisabled && 'text-gray-400'
      )}>
        {rider.name}
      </span>
      <span className={cn(
        'absolute top-1.5 right-2 text-xs font-medium',
        isSelected ? 'text-pink-600' : 'text-gray-500',
        isDisabled && 'text-gray-400'
      )}>
        {isDisabled ? disabledReason || 'N/A' : `$${price.toFixed(0)}`}
      </span>
    </button>
  )
}
