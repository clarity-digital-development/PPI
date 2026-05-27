'use client'

import { Package, ShoppingCart, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import { PRICING } from '../types'

export function BrochureBoxStep({ formData, updateFormData }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Brochure Box</h2>
        <p className="text-gray-600">Optional - Add a brochure box to your installation.</p>
      </div>

      <div className="space-y-3">
        {/* Purchase brochure box */}
        <button
          type="button"
          onClick={() => updateFormData({ brochure_option: 'purchase' })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.brochure_option === 'purchase'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.brochure_option === 'purchase' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <ShoppingCart className={cn(
              'w-5 h-5',
              formData.brochure_option === 'purchase' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Purchase a brochure box</h3>
            <p className="text-sm text-gray-600">We provide and install a brochure box for you to keep</p>
            <p className="text-sm font-medium text-pink-600 mt-1">
              ${PRICING.brochure_box_purchase.toFixed(2)} <span className="text-gray-500 font-normal">(includes ${PRICING.brochure_box_install} install fee)</span>
            </p>
          </div>
        </button>

        {/* Install your own brochure box */}
        <button
          type="button"
          onClick={() => updateFormData({ brochure_option: 'own' })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.brochure_option === 'own'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.brochure_option === 'own' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <Package className={cn(
              'w-5 h-5',
              formData.brochure_option === 'own' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">Install my own brochure box</h3>
            <p className="text-sm text-gray-600">Bring your own brochure box and we&apos;ll install it</p>
            <p className="text-sm font-medium text-pink-600 mt-1">
              ${PRICING.brochure_box_install.toFixed(2)} install fee
            </p>
          </div>
        </button>

        {/* No brochure box */}
        <button
          type="button"
          onClick={() => updateFormData({ brochure_option: 'none' })}
          className={cn(
            'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left',
            formData.brochure_option === 'none'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            formData.brochure_option === 'none' ? 'bg-pink-500' : 'bg-gray-100'
          )}>
            <X className={cn(
              'w-5 h-5',
              formData.brochure_option === 'none' ? 'text-white' : 'text-gray-400'
            )} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">No brochure box needed</h3>
            <p className="text-sm text-gray-600">Skip brochure box for this installation</p>
          </div>
        </button>
      </div>
    </div>
  )
}
