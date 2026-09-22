'use client'

import { Select } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { SignLocation } from '@/lib/orders/sign-descriptions'

// How the $10 pickup fee applies to THIS picker's pickup choice.
export type PickupFeeState =
  | { kind: 'charged'; amount: number } // choosing pickup here adds the fee
  | { kind: 'waived' } // the payer's team has the waiver
  | { kind: 'already_on_order' } // the other post's sign already carries it
  | { kind: 'included' } // flat-fee account: the fixed per-order price covers it

interface SignLocationPickerProps {
  id: string
  location?: SignLocation
  address?: string
  onLocationChange: (location: SignLocation) => void
  onAddressChange: (address: string) => void
  fee: PickupFeeState
  // Indent under the Sign step's tile icons; off inside the Second Post panel.
  indent?: boolean
}

/**
 * The dropdown under "Sign will be at the property or pickup from another
 * location" (Ryan, 2026-09-15). Wording is his, verbatim where he gave it.
 */
export function SignLocationPicker({ id, location, address, onLocationChange, onAddressChange, fee, indent = true }: SignLocationPickerProps) {
  const pickupSuffix =
    fee.kind === 'charged'
      ? ` — $${fee.amount.toFixed(2)}`
      : fee.kind === 'waived'
        ? ' — no pickup fee for your account'
        : fee.kind === 'included'
          ? ' — included in your flat rate'
          : ' — no extra fee'

  return (
    <div className={cn('p-4 bg-gray-50 rounded-lg space-y-3', indent && 'ml-14')}>
      <Select
        id={`${id}-location`}
        label="Where is the sign?"
        placeholder="Select an option"
        value={location ?? ''}
        onChange={(e) => onLocationChange(e.target.value as SignLocation)}
        options={[
          { value: 'listing', label: 'Sign will be at the listing property' },
          { value: 'ppi_storage', label: 'Sign will be delivered to a Pink Posts Storage location' },
          {
            value: 'pickup',
            label: `Sign needs to be picked up from another location (agent home or office)${pickupSuffix}`,
          },
        ]}
      />
      {!location && (
        <p className="text-xs text-amber-700">Please choose where the sign will be before continuing.</p>
      )}

      {location === 'pickup' && (
        <div className="space-y-2">
          <label htmlFor={`${id}-address`} className="block text-sm font-medium text-gray-700">
            Please state pickup address
          </label>
          <textarea
            id={`${id}-address`}
            value={address ?? ''}
            // Currency symbols are stripped as typed: the address is copied
            // into the install crew's dispatch email, which blanks anything
            // that looks like an amount. Full clean-up happens on save.
            onChange={(e) => onAddressChange(e.target.value.replace(/[$＄€£]/g, ''))}
            placeholder="Street, city — and anything the crew needs to find the sign"
            rows={2}
            maxLength={300}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent resize-none"
          />
          {!address?.trim() && (
            <p className="text-xs text-amber-700">Please enter the pickup address before continuing.</p>
          )}
          {fee.kind === 'charged' ? (
            <>
              <p className="text-sm font-medium text-pink-600">Pickup fee: ${fee.amount.toFixed(2)}</p>
              <p className="text-xs text-gray-600">
                If this is your first order, we do offer one complimentary pickup. Call/text{' '}
                <a href="tel:8593958188" className="font-medium text-pink-600 hover:underline">859-395-8188</a>{' '}
                to arrange inventory pickup. Subject to availability.
              </p>
            </>
          ) : fee.kind === 'waived' ? (
            <p className="text-sm text-gray-600">Pickup fee waived for your account.</p>
          ) : fee.kind === 'included' ? (
            <p className="text-sm text-gray-600">No extra charge — included in your flat rate.</p>
          ) : (
            <p className="text-sm text-gray-600">No extra fee — one pickup fee covers both posts on this order.</p>
          )}
        </div>
      )}
    </div>
  )
}
