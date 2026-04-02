'use client'

import { useState, useEffect } from 'react'
import { Mountain, Car, X, Check } from 'lucide-react'
import { Input } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { RiderSource, RiderOption } from '../types'

interface CustomRiderInputProps {
  rider: RiderOption
  isSelected: boolean
  value: number | null
  onChange: (value: number | null) => void
  price: number
  source: RiderSource
  isRiderAvailable: (rider: RiderOption) => boolean
}

const ICONS: Record<string, typeof Mountain> = {
  Mountain: Mountain,
  Car: Car,
}

export function CustomRiderInput({
  rider,
  isSelected,
  value,
  onChange,
  price,
  source,
  isRiderAvailable,
}: CustomRiderInputProps) {
  const [inputValue, setInputValue] = useState(value?.toString() || '')
  const Icon = ICONS[rider.icon || 'Mountain'] || Mountain
  const isDisabled = source === 'owned' && !isRiderAvailable(rider)

  // Sync input value when external value changes
  useEffect(() => {
    if (value !== null && value.toString() !== inputValue) {
      setInputValue(value.toString())
    }
  }, [value])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)

    if (val === '') {
      onChange(null)
    } else {
      const num = parseFloat(val)
      if (!isNaN(num) && num > 0) {
        onChange(num)
      }
    }
  }

  const handleRemove = () => {
    setInputValue('')
    onChange(null)
  }

  const displayValue = value
    ? rider.id === 'custom-car-garage'
      ? `${value} Car Garage`
      : `${value} Acres`
    : null

  return (
    <div className={cn(
      'border-2 rounded-lg p-4 transition-all',
      isDisabled
        ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
        : isSelected ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
            isSelected ? 'bg-pink-100' : 'bg-gray-100'
          )}>
            <Icon className={cn(
              'w-5 h-5',
              isSelected ? 'text-pink-600' : 'text-gray-500'
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-gray-900">{rider.name}</h4>
              {isSelected && (
                <Check className="w-4 h-4 text-pink-500" />
              )}
            </div>
            <p className="text-sm text-gray-500 mb-3">
              {rider.id === 'custom-car-garage'
                ? 'Add a custom garage size rider to your sign'
                : 'Add a custom acres rider to your sign'}
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="1"
                step={rider.id === 'custom-car-garage' ? '1' : '0.1'}
                value={inputValue}
                onChange={handleInputChange}
                placeholder={rider.id === 'custom-car-garage' ? 'Enter # of cars' : 'Enter acres'}
                className="flex-1 max-w-[150px]"
                disabled={isDisabled}
              />
              <span className="text-sm text-gray-500">{rider.inputSuffix}</span>
            </div>
            {isSelected && displayValue && (
              <p className="text-sm text-pink-600 mt-2">
                Your rider will display: &quot;{displayValue}&quot;
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={cn(
            'text-sm font-medium',
            isSelected ? 'text-pink-600' : 'text-gray-500'
          )}>
            ${price.toFixed(0)}
          </span>
          {isSelected && (
            <button
              type="button"
              onClick={handleRemove}
              className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
