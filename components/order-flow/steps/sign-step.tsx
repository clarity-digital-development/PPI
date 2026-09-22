'use client'

import { useState } from 'react'
import { Package, MapPin, X, AlertCircle } from 'lucide-react'
import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'
import { SignLocationPicker } from './SignLocationPicker'

export function SignStep({ formData, updateFormData, inventory, pickupFee, flatFee }: StepProps) {
  const hasStoredSigns = inventory?.signs && inventory.signs.length > 0
  const [showNoSignsError, setShowNoSignsError] = useState(false)
  const fee = pickupFee ?? PRICING.pickup_fee

  const handleStoredSignClick = () => {
    if (hasStoredSigns) {
      // Clear the at-property sub-choice so a stale pickup can't ride along.
      updateFormData({ sign_option: 'stored', sign_description: '', sign_location: undefined, sign_pickup_address: '' })
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
                <p className="text-sm text-gray-600">
                  {inventory!.brokeragePool
                    ? `${inventory!.signs.length} sign(s) available — yours plus ${inventory!.brokeragePool.name}`
                    : `We have ${inventory!.signs.length} sign(s) in storage for you`}
                </p>
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
              options={(() => {
                // Group signs by description so duplicates only appear once --
                // but key on description AND source. A brokerage pool (Ryan,
                // 2026-09-08) can hold a sign described identically to the
                // agent's own; grouping on description alone collapsed the two
                // into a single option carrying whichever id sorted first, so
                // the agent could never actually choose the brokerage sign and
                // might consume the wrong physical one.
                const grouped: Record<string, { id: string; label: string }> = {}
                for (const sign of inventory!.signs) {
                  const base = `${sign.description}${sign.size ? ` (${sign.size})` : ''}`
                  // 'on-order' is the row this order already holds. It gets its own
                  // option so it can never mask a same-described sign from either
                  // pool, and is labelled so the agent can tell it apart.
                  const label =
                    sign.source === 'brokerage'
                      ? `${base} — ${sign.source_label || 'Brokerage'}`
                      : sign.source === 'on-order'
                        ? `${base} — currently on this order`
                        : base
                  const key = `${base}::${sign.source ?? 'own'}`
                  if (!grouped[key]) {
                    grouped[key] = { id: sign.id, label }
                  }
                }
                return Object.values(grouped).map(g => ({ value: g.id, label: g.label }))
              })()}
            />
            {!formData.stored_sign_id && (
              <p className="mt-2 text-xs text-amber-700">
                Please pick which sign you want installed before continuing.
              </p>
            )}
          </div>
        )}

        {/* Sign at property */}
        <button
          type="button"
          onClick={() => {
            // sign_location is deliberately kept: re-tapping the tile (or
            // re-opening a cart row) must not wipe an answer already given.
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

        {formData.sign_option === 'at_property' && (
          <SignLocationPicker
            id="sign"
            location={formData.sign_location}
            address={formData.sign_pickup_address}
            onLocationChange={(sign_location) => updateFormData({ sign_location })}
            onAddressChange={(sign_pickup_address) => updateFormData({ sign_pickup_address })}
            fee={
              fee <= 0
                ? { kind: 'waived' }
                : flatFee
                  // The server still records the line, but the flat total
                  // ignores items — nothing extra is charged.
                  ? { kind: 'included' }
                  : { kind: 'charged', amount: fee }
            }
          />
        )}

        {/* No sign */}
        <button
          type="button"
          onClick={() => {
            updateFormData({ sign_option: 'none', stored_sign_id: undefined, sign_description: '', sign_location: undefined, sign_pickup_address: '' })
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
            <p className="text-sm text-amber-600">Attention: No sign will be attached and only the post will be installed at your property.</p>
          </div>
        </button>
      </div>
    </div>
  )
}
