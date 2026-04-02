'use client'

import { useState } from 'react'
import { Package, MapPin, X, AlertCircle } from 'lucide-react'
import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'

export function SignStep({ formData, updateFormData, inventory }: StepProps) {
  const hasStoredSigns = inventory?.signs && inventory.signs.length > 0
  const [showNoSignsError, setShowNoSignsError] = useState(false)

  const handleStoredSignClick = () => {
    if (hasStoredSigns) {
      updateFormData({ sign_option: 'stored', sign_description: '' })
      setShowNoSignsError(false)
    } else {
      setShowNoSignsError(true)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Sign Selection</h2>
        <p className="text-gray-600">Do you have a sign for us to install?</p>
      </div>

      <div className="space-y-3">
        {/* Use stored sign - always visible */}
        <button
          type="button"
          onClick={handleStoredSignClick}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.sign_option === 'stored'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.sign_option === 'stored' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <Package className={cn(
              'w-5 h-5',
              formData.sign_option === 'stored' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Sign in inventory</h3>
            {hasStoredSigns ? (
              <>
                <p className="text-sm text-gray-600">We have {inventory!.signs.length} sign(s) in storage for you</p>
                <p className="text-sm font-medium text-pink-600 mt-1">Install fee: ${PRICING.sign_install.toFixed(2)}</p>
              </>
            ) : (
              <p className="text-sm text-gray-500">Use a sign from your stored inventory</p>
            )}
          </div>
        </button>

        {/* No signs error message */}
        {showNoSignsError && !hasStoredSigns && (
          <div className="ml-14 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">No signs currently in inventory. Contact your admin to add signs to your account.</p>
          </div>
        )}

        {formData.sign_option === 'stored' && hasStoredSigns && (
          <div className="ml-14 p-4 bg-gray-50 rounded-lg">
            <Select
              label="Select sign"
              value={formData.stored_sign_id || ''}
              onChange={(e) => updateFormData({ stored_sign_id: e.target.value })}
              options={[
                { value: '', label: 'Choose a sign...' },
                ...inventory!.signs.map((sign) => ({
                  value: sign.id,
                  label: `${sign.description}${sign.size ? ` (${sign.size})` : ''}`,
                })),
              ]}
            />
          </div>
        )}

        {/* Sign at property */}
        <button
          type="button"
          onClick={() => {
            updateFormData({ sign_option: 'at_property', stored_sign_id: undefined })
            setShowNoSignsError(false)
          }}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.sign_option === 'at_property'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.sign_option === 'at_property' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <MapPin className={cn(
              'w-5 h-5',
              formData.sign_option === 'at_property' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Sign will be at the property or pickup from another location</h3>
            <p className="text-sm font-medium text-pink-600 mt-1">Install fee: ${PRICING.sign_install.toFixed(2)}</p>
          </div>
        </button>

        {/* No sign */}
        <button
          type="button"
          onClick={() => {
            updateFormData({ sign_option: 'none', stored_sign_id: undefined, sign_description: '' })
            setShowNoSignsError(false)
          }}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.sign_option === 'none'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.sign_option === 'none' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <X className={cn(
              'w-5 h-5',
              formData.sign_option === 'none' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">No sign needed</h3>
            <p className="text-sm text-gray-600">Post only installation</p>
          </div>
        </button>
      </div>
    </div>
  )
}
