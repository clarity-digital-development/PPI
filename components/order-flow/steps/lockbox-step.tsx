'use client'

import { Lock, Key, ShoppingCart, X, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'

export function LockboxStep({ formData, updateFormData, inventory }: StepProps) {
  const storedLockboxes = inventory?.lockboxes || []
  const hasStored = storedLockboxes.length > 0

  // Pick a stored lockbox: derive the lockbox_option from its type so pricing
  // (install vs rental) flows through correctly elsewhere.
  const handlePickStored = (lockbox: { id: string; lockbox_type: string; lockbox_code: string | null }) => {
    const option: 'sentrilock' | 'mechanical_own' = lockbox.lockbox_type === 'sentrilock'
      ? 'sentrilock'
      : 'mechanical_own'
    updateFormData({
      lockbox_option: option,
      lockbox_type: lockbox.lockbox_type,
      lockbox_code: lockbox.lockbox_code || '',
      customer_lockbox_id: lockbox.id,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Lockbox Selection</h2>
        <p className="text-gray-600">Optional - Add a lockbox to your installation.</p>
      </div>

      {/* Inventory lockboxes — listed individually so customer picks WHICH one */}
      {hasStored && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-pink-600" />
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              From your inventory
            </h3>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Pick the specific lockbox you want installed. Install fee: ${PRICING.lockbox_install.toFixed(2)}.
          </p>
          <div className="space-y-2">
            {storedLockboxes.map((lockbox) => {
              const isPicked = formData.customer_lockbox_id === lockbox.id
              const isSentri = lockbox.lockbox_type === 'sentrilock'
              const label = lockbox.lockbox_type_name || (isSentri ? 'SentriLock' : 'Mechanical Lockbox')
              return (
                <button
                  key={lockbox.id}
                  type="button"
                  onClick={() => handlePickStored(lockbox)}
                  className={cn(
                    'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
                    isPicked
                      ? 'border-pink-500 bg-pink-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <div className={cn(
                    'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
                    isPicked ? 'bg-pink-500' : 'bg-gray-100'
                  )}>
                    {isSentri
                      ? <Lock className={cn('w-5 h-5', isPicked ? 'text-white' : 'text-gray-400')} />
                      : <Key className={cn('w-5 h-5', isPicked ? 'text-white' : 'text-gray-400')} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{label}</p>
                    {lockbox.lockbox_code ? (
                      <p className="text-sm text-gray-600">
                        Code / serial: <span className="font-mono font-medium text-gray-900">{lockbox.lockbox_code}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">No code on file</p>
                    )}
                  </div>
                  <p className="text-sm font-medium text-pink-600 flex-shrink-0">
                    ${PRICING.lockbox_install.toFixed(2)}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Rent a lockbox (we provide one) */}
      <div className="space-y-3">
        {!hasStored && (
          <p className="text-xs uppercase tracking-wide font-semibold text-gray-500">
            Other options
          </p>
        )}

        <button
          type="button"
          onClick={() => updateFormData({
            lockbox_option: 'mechanical_rent',
            lockbox_type: 'mechanical',
            lockbox_code: '',
            customer_lockbox_id: undefined,
          })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.lockbox_option === 'mechanical_rent'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.lockbox_option === 'mechanical_rent' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <ShoppingCart className={cn(
              'w-5 h-5',
              formData.lockbox_option === 'mechanical_rent' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Rent Mechanical Lockbox</h3>
            <p className="text-sm text-gray-600">We&apos;ll provide a mechanical lockbox for your listing</p>
            <p className="text-sm font-medium text-pink-600 mt-1">Rental fee: ${PRICING.lockbox_rental.toFixed(2)}</p>
          </div>
        </button>

        {/* No lockbox */}
        <button
          type="button"
          onClick={() => updateFormData({
            lockbox_option: 'none',
            lockbox_type: undefined,
            lockbox_code: '',
            customer_lockbox_id: undefined,
          })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.lockbox_option === 'none'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.lockbox_option === 'none' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <X className={cn(
              'w-5 h-5',
              formData.lockbox_option === 'none' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">No lockbox needed</h3>
            <p className="text-sm text-gray-600">Skip lockbox for this installation</p>
          </div>
        </button>
      </div>

      <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
        <p><strong>Note:</strong> Install your own lockbox (Bluetooth or mechanical) for ${PRICING.lockbox_install}, or rent and install our mechanical lockbox for ${PRICING.lockbox_rental} (includes lockbox + installation).</p>
      </div>
    </div>
  )
}
