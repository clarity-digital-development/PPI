'use client'

import { useRef } from 'react'
import Image from 'next/image'
import { Building2, Home, HardHat, Building, LandPlot, Paperclip, X } from 'lucide-react'
import { Input } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { StepProps } from '../types'
import type { PropertyType } from '@/types/database'

const propertyTypes: Array<{
  value: PropertyType
  label: string
  description: string
  icon: React.ElementType
}> = [
  {
    value: 'commercial',
    label: 'Commercial Property',
    description: 'A business location',
    icon: Building2,
  },
  {
    value: 'house',
    label: 'House / Mobile Home',
    description: 'Single family dwelling',
    icon: Home,
  },
  {
    value: 'construction',
    label: 'Active Construction Site',
    description: 'New build in progress',
    icon: HardHat,
  },
  {
    value: 'multi_family',
    label: 'Multi-Family Dwelling',
    description: 'Condo, apartment, etc.',
    icon: Building,
  },
  {
    value: 'bare_land',
    label: 'Bare Land',
    description: 'No structure on property',
    icon: LandPlot,
  },
]

export function PropertyStep({ formData, updateFormData }: StepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be less than 5MB')
      return
    }

    const reader = new FileReader()
    reader.onloadend = () => {
      updateFormData({ installation_location_image: reader.result as string })
    }
    reader.readAsDataURL(file)
  }

  const removeImage = () => {
    updateFormData({ installation_location_image: undefined })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Property Information</h2>
        <p className="text-gray-600">Tell us about the property where you need the sign installed.</p>
      </div>

      {/* Property Type Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Property Type *
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {propertyTypes.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => updateFormData({ property_type: type.value })}
              className={cn(
                'flex flex-col items-center p-4 rounded-xl border-2 transition-all text-center',
                formData.property_type === type.value
                  ? 'border-pink-500 bg-pink-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              )}
            >
              <type.icon
                className={cn(
                  'w-8 h-8 mb-2',
                  formData.property_type === type.value
                    ? 'text-pink-500'
                    : 'text-gray-400'
                )}
              />
              <span className="text-sm font-medium text-gray-900">{type.label}</span>
              <span className="text-xs text-gray-500 mt-1">{type.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Address Fields */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Input
            label="Street Address *"
            value={formData.property_address}
            onChange={(e) => updateFormData({ property_address: e.target.value })}
            placeholder="123 Main Street"
          />
        </div>
        <Input
          label="City *"
          value={formData.property_city}
          onChange={(e) => updateFormData({ property_city: e.target.value })}
          placeholder="Lexington"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="State"
            value={formData.property_state}
            onChange={(e) => updateFormData({ property_state: e.target.value })}
            placeholder="KY"
          />
          <Input
            label="ZIP Code *"
            value={formData.property_zip}
            onChange={(e) => updateFormData({ property_zip: e.target.value })}
            placeholder="40502"
          />
        </div>
      </div>

      {/* Gated Community */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Is the property in a gated community? *
          </label>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => updateFormData({ is_gated_community: true })}
              className={cn(
                'flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all',
                formData.is_gated_community === true
                  ? 'border-pink-500 bg-pink-50 text-pink-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-700'
              )}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => updateFormData({ is_gated_community: false, gate_code: '' })}
              className={cn(
                'flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all',
                formData.is_gated_community === false
                  ? 'border-pink-500 bg-pink-50 text-pink-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-700'
              )}
            >
              No
            </button>
          </div>
        </div>

        {formData.is_gated_community && (
          <div>
            <Input
              label="Gate Code *"
              value={formData.gate_code || ''}
              onChange={(e) => updateFormData({ gate_code: e.target.value })}
              placeholder="Enter gate code or access instructions"
            />
          </div>
        )}
      </div>

      {/* Marker Placement */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Did you leave a marker where you want the post placed? *
        </label>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => updateFormData({ has_marker_placed: true })}
            className={cn(
              'flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all',
              formData.has_marker_placed === true
                ? 'border-pink-500 bg-pink-50 text-pink-700'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            )}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => updateFormData({ has_marker_placed: false })}
            className={cn(
              'flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all',
              formData.has_marker_placed === false
                ? 'border-pink-500 bg-pink-50 text-pink-700'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            )}
          >
            No
          </button>
        </div>
      </div>

      {/* Sign Orientation */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          How should the sign be placed relative to the street? *
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { value: 'perpendicular', label: 'Perpendicular', description: '90 degree angle to the street' },
            { value: 'parallel', label: 'Parallel', description: 'Sign runs along the street' },
            { value: 'corner', label: 'Corner Angle', description: 'Angled toward intersection center' },
            { value: 'installer_decides', label: 'Let Installer Decide', description: 'Best placement for visibility' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => updateFormData({ sign_orientation: option.value as any, sign_orientation_other: '' })}
              className={cn(
                'flex flex-col items-start p-4 rounded-lg border-2 text-left transition-all',
                formData.sign_orientation === option.value
                  ? 'border-pink-500 bg-pink-50'
                  : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <span className="font-medium text-gray-900">{option.label}</span>
              <span className="text-sm text-gray-500">{option.description}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => updateFormData({ sign_orientation: 'other' })}
          className={cn(
            'mt-3 w-full flex flex-col items-start p-4 rounded-lg border-2 text-left transition-all',
            formData.sign_orientation === 'other'
              ? 'border-pink-500 bg-pink-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <span className="font-medium text-gray-900">Other</span>
          <span className="text-sm text-gray-500">I have specific instructions</span>
        </button>

        {formData.sign_orientation === 'other' && (
          <div className="mt-3">
            <Input
              label="Please describe"
              value={formData.sign_orientation_other || ''}
              onChange={(e) => updateFormData({ sign_orientation_other: e.target.value })}
              placeholder="Describe how you'd like the sign placed..."
            />
          </div>
        )}
      </div>

      {/* Installation Details */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Installation Location
          </label>
          <div className="relative">
            <input
              type="text"
              value={formData.installation_location}
              onChange={(e) => updateFormData({ installation_location: e.target.value })}
              placeholder="e.g., Front yard near mailbox"
              className="w-full px-4 py-2.5 pr-12 rounded-lg border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none transition-all"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-pink-500 transition-colors"
              title="Attach image"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageAttach}
              className="hidden"
            />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Where on the property should we install the sign?
          </p>

          {/* Image Preview */}
          {formData.installation_location_image && (
            <div className="mt-3 relative inline-block">
              <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-gray-200">
                <Image
                  src={formData.installation_location_image}
                  alt="Installation location"
                  fill
                  className="object-cover"
                />
              </div>
              <button
                type="button"
                onClick={removeImage}
                className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                title="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Special Instructions
          </label>
          <textarea
            value={formData.installation_notes}
            onChange={(e) => updateFormData({ installation_notes: e.target.value })}
            placeholder="Gate codes, access instructions, or other notes..."
            rows={3}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 focus:border-pink-500 focus:ring-2 focus:ring-pink-200 outline-none transition-all resize-none"
          />
        </div>
      </div>
    </div>
  )
}
