import type { PropertyType } from '@/types/database'

export interface RiderSelection {
  rider_type: string
  is_rental: boolean
  quantity: number
  custom_value?: string
  customer_rider_id?: string
}

export interface OrderFormData {
  // Property Info
  property_type: PropertyType | undefined
  property_address: string
  property_city: string
  property_state: string
  property_zip: string
  installation_location: string
  installation_location_image?: string // base64 encoded image
  installation_notes: string

  // Additional Property Questions
  is_gated_community: boolean
  gate_code?: string
  has_marker_placed: boolean
  sign_orientation: 'perpendicular' | 'parallel' | 'corner' | 'installer_decides' | 'other'
  sign_orientation_other?: string

  // Post Selection
  post_type: 'White Vinyl Post' | 'Black Vinyl Post' | 'Signature Pink Post' | 'Metal Frame Sign' | undefined

  // Sign Selection
  sign_option: 'stored' | 'at_property' | 'none'
  stored_sign_id?: string
  sign_description?: string

  // Rider Selection
  riders: RiderSelection[]

  // Lockbox Selection
  lockbox_option: 'sentrilock' | 'mechanical_own' | 'mechanical_rent' | 'none'
  lockbox_type?: string
  lockbox_code?: string
  customer_lockbox_id?: string

  // Wire Frame Signs
  wire_frame_quantity: number

  // Brochure Box
  brochure_option: 'purchase' | 'own' | 'none'
  customer_brochure_box_id?: string

  // Scheduling
  schedule_type: 'next_available' | 'specific_date' | 'expedited'
  requested_date?: string

  // Payment
  payment_method_id?: string
  save_payment_method: boolean

  // Promo Code
  promo_code?: string
  promo_code_id?: string
  discount?: number
  fuel_surcharge_waived?: boolean
}

export interface StepProps {
  formData: OrderFormData
  updateFormData: (updates: Partial<OrderFormData>) => void
  inventory?: {
    signs: Array<{ id: string; description: string; size: string | null }>
    riders: Array<{ id: string; rider_type: string; quantity: number }>
    lockboxes: Array<{ id: string; lockbox_type: string; lockbox_code: string | null }>
    brochureBoxes: { quantity: number } | null
  }
  paymentMethods?: Array<{
    id: string
    card_brand: string | null
    card_last4: string | null
    is_default: boolean
  }>
  isSubmitting?: boolean
  setIsSubmitting?: (value: boolean) => void
}

export const PRICING = {
  posts: {
    'White Vinyl Post': 55,
    'Black Vinyl Post': 55,
    'Signature Pink Post': 65,
    'Metal Frame Sign': 40,
  },
  no_post_surcharge: 40,
  sign_install: 3,
  rider_rental: 5,
  rider_install: 2,
  lockbox_install: 5,
  lockbox_rental: 10,
  wire_frame_sign: 5,
  brochure_box_purchase: 23,
  brochure_box_install: 2,
  fuel_surcharge: 2.47,
  expedite_fee: 50,
  tax_rate: 0.06, // Kentucky 6% sales tax
} as const
