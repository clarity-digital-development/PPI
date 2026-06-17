'use client'

import { Lock, Key, ShoppingCart, X, Package } from 'lucide-react'
import { Input } from '@/components/ui'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'

export function LockboxStep({ formData, updateFormData, inventory, lockboxInstallFee }: StepProps) {
  const storedLockboxes = inventory?.lockboxes || []
  const hasStored = storedLockboxes.length > 0
  // Owned-lockbox install fee — normally $5, but $0 for free-install brokers.
  const installFee = lockboxInstallFee ?? PRICING.lockbox_install
  const installFeeLabel = installFee === 0 ? 'Free' : `$${installFee.toFixed(2)}`

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

      {/* Inventory lockboxes — searchable dropdown instead of a stacked list.
          Brokers can have many lockboxes (each unique per record because they
          carry their own code / serial), so a long auto-list pushed the
          rental / at-property / none options below the fold. Dropdown +
          search keeps the page compact while letting them filter by code. */}
      {hasStored && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-pink-600" />
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              From your inventory
            </h3>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Pick the specific lockbox you want installed. Install fee: {installFeeLabel}.
          </p>
          <SearchableSelect
            value={formData.customer_lockbox_id || ''}
            onChange={(next) => {
              const picked = storedLockboxes.find((lb) => lb.id === next)
              if (picked) handlePickStored(picked)
            }}
            options={storedLockboxes.map((lb) => {
              const isSentri = lb.lockbox_type === 'sentrilock'
              const typeLabel = isSentri ? 'Sentrilock/Supra' : (lb.lockbox_type_name || 'Mechanical Lockbox')
              const codeLabel = lb.lockbox_code ? `Code ${lb.lockbox_code}` : 'No code on file'
              return { value: lb.id, label: `${typeLabel} — ${codeLabel}` }
            })}
            placeholder={`Select a lockbox from your inventory (${storedLockboxes.length} available)…`}
            searchPlaceholder="Filter by type or code…"
            emptyText="No lockboxes match"
          />
          {/* Confirmation card — when a lockbox is picked, show the same
              visual richness the prior auto-list rows had (icon + code + fee)
              so the user gets clear feedback that this specific lockbox is
              the one we'll install. Re-clicking the dropdown above swaps it. */}
          {(() => {
            const picked = storedLockboxes.find((lb) => lb.id === formData.customer_lockbox_id)
            if (!picked) return null
            const isSentri = picked.lockbox_type === 'sentrilock'
            const typeLabel = isSentri ? 'Sentrilock/Supra' : (picked.lockbox_type_name || 'Mechanical Lockbox')
            return (
              <div className="mt-3 flex items-center gap-4 p-4 rounded-xl border-2 border-pink-500 bg-pink-50">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-pink-500">
                  {isSentri
                    ? <Lock className="w-5 h-5 text-white" />
                    : <Key className="w-5 h-5 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{typeLabel}</p>
                  {picked.lockbox_code ? (
                    <p className="text-sm text-gray-600">
                      Code / serial: <span className="font-mono font-medium text-gray-900">{picked.lockbox_code}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400">No code on file</p>
                  )}
                </div>
                <p className="text-sm font-medium text-pink-600 flex-shrink-0">
                  {installFeeLabel}
                </p>
              </div>
            )
          })()}
        </div>
      )}

      {/* Rent a lockbox (we provide one) */}
      <div className="space-y-3">
        {!hasStored && (
          <p className="text-xs uppercase tracking-wide font-semibold text-gray-500">
            Other options
          </p>
        )}

        {/* Available for pickup / at property — customer's own lockbox that
            isn't in our storage; we install it on-site */}
        <button
          type="button"
          onClick={() => updateFormData({
            lockbox_option: 'at_property',
            lockbox_type: undefined,
            lockbox_code: '',
            customer_lockbox_id: undefined,
          })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.lockbox_option === 'at_property'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.lockbox_option === 'at_property' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <Key className={cn(
              'w-5 h-5',
              formData.lockbox_option === 'at_property' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Lockbox at property / available for pickup</h3>
            <p className="text-sm text-gray-600">Your lockbox is on-site or we&apos;ll pick it up — we&apos;ll install it</p>
            <p className="text-sm font-medium text-pink-600 mt-1">Install fee: {installFeeLabel}</p>
          </div>
        </button>

        {formData.lockbox_option === 'at_property' && (
          <div className="ml-14 p-4 bg-gray-50 rounded-lg">
            <Input
              label="Lockbox code (optional)"
              value={formData.lockbox_code || ''}
              onChange={(e) => updateFormData({ lockbox_code: e.target.value })}
              placeholder="e.g., 1234"
              helperText="If you know the code, enter it so we can access it"
            />
          </div>
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

        {formData.lockbox_option === 'mechanical_rent' && (
          <div className="ml-14 p-4 bg-gray-50 rounded-lg">
            <Input
              label="Lockbox code (optional)"
              value={formData.lockbox_code || ''}
              onChange={(e) => updateFormData({ lockbox_code: e.target.value })}
              placeholder="e.g., 1234"
              helperText="Preferred code for the rental lockbox, if you have one"
            />
          </div>
        )}

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
        <p><strong>Note:</strong> Install your own lockbox (Bluetooth or mechanical) for {installFee === 0 ? 'free' : `$${installFee}`}, or rent and install our mechanical lockbox for ${PRICING.lockbox_rental} (includes lockbox + installation).</p>
      </div>
    </div>
  )
}
