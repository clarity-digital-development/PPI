import { z } from 'zod'

export const profileSchema = z.object({
  full_name: z.string().min(1, 'Full name is required'),
  phone: z.string().min(10, 'Valid phone number is required'),
  company_name: z.string().optional(),
  license_number: z.string().optional(),
})

export const propertySchema = z.object({
  property_type: z.enum(['commercial', 'residential', 'land', 'multi_family', 'house', 'construction', 'bare_land']),
  property_address: z.string().min(1, 'Street address is required'),
  property_city: z.string().min(1, 'City is required'),
  property_state: z.string().default('KY'),
  property_zip: z.string().min(5, 'ZIP code is required'),
  installation_location: z.string().optional(),
  installation_location_image: z.string().optional(), // base64 encoded image
  installation_notes: z.string().optional(),
})

export const orderItemSchema = z.object({
  item_type: z.enum(['post', 'sign', 'rider', 'lockbox', 'brochure_box', 'wire_frame_sign', 'trip']),
  item_category: z.enum(['rental', 'owned', 'new', 'storage', 'purchase', 'install']).optional(),
  description: z.string(),
  quantity: z.number().min(1).default(1),
  unit_price: z.number().min(0),
  total_price: z.number().min(0),
  customer_sign_id: z.string().optional(),
  customer_rider_id: z.string().optional(),
  customer_lockbox_id: z.string().optional(),
  customer_brochure_box_id: z.string().optional(),
  custom_value: z.string().optional(),
})

export const createOrderSchema = z.object({
  ...propertySchema.shape,
  post_type: z.string().optional(), // Post is now optional - users can order other services
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
  requested_date: z.string().optional(),
  is_expedited: z.boolean().default(false),
  payment_method_id: z.string().optional(),
  save_payment_method: z.boolean().default(false),
  promo_code: z.string().optional(),
  promo_code_id: z.string().optional(),
  fuel_surcharge_waived: z.boolean().default(false),
  // Installation details
  is_gated_community: z.boolean().default(false),
  gate_code: z.string().optional(),
  has_marker_placed: z.boolean().default(false),
  sign_orientation: z.string().optional(),
  sign_orientation_other: z.string().optional(),
})

export const schedulingSchema = z.object({
  schedule_type: z.enum(['next_available', 'specific_date', 'expedited']),
  requested_date: z.string().optional(),
})

export const signSelectionSchema = z.object({
  use_stored_sign: z.boolean().default(false),
  stored_sign_id: z.string().optional(),
  sign_at_property: z.boolean().default(false),
  sign_description: z.string().optional(),
  no_sign: z.boolean().default(false),
})

export const riderSelectionSchema = z.object({
  riders: z.array(z.object({
    rider_type: z.string(),
    is_rental: z.boolean(),
    quantity: z.number().min(1).default(1),
    custom_value: z.string().optional(),
    customer_rider_id: z.string().optional(),
  })).optional(),
})

export const lockboxSelectionSchema = z.object({
  lockbox_type: z.string().optional(),
  is_rental: z.boolean().default(false),
  lockbox_code: z.string().optional(),
  customer_lockbox_id: z.string().optional(),
})

export const brochureBoxSchema = z.object({
  use_stored: z.boolean().default(false),
  customer_brochure_box_id: z.string().optional(),
  buy_new: z.boolean().default(false),
})

// Admin schemas
export const customerSignSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  size: z.string().optional(),
  quantity: z.number().min(1).default(1),
  notes: z.string().optional(),
})

export const customerRiderSchema = z.object({
  rider_type: z.string().min(1, 'Rider type is required'),
  quantity: z.number().min(1).default(1),
})

export const customerLockboxSchema = z.object({
  lockbox_type: z.string().min(1, 'Lockbox type is required'),
  lockbox_code: z.string().optional(),
  quantity: z.number().min(1).default(1),
})

export const customerBrochureBoxSchema = z.object({
  quantity: z.number().min(1).default(1),
})

export type ProfileFormData = z.infer<typeof profileSchema>
export type PropertyFormData = z.infer<typeof propertySchema>
export type CreateOrderFormData = z.infer<typeof createOrderSchema>
export type OrderItemFormData = z.infer<typeof orderItemSchema>
export type SchedulingFormData = z.infer<typeof schedulingSchema>
export type SignSelectionFormData = z.infer<typeof signSelectionSchema>
export type RiderSelectionFormData = z.infer<typeof riderSelectionSchema>
export type LockboxSelectionFormData = z.infer<typeof lockboxSelectionSchema>
export type BrochureBoxFormData = z.infer<typeof brochureBoxSchema>
export type CustomerSignFormData = z.infer<typeof customerSignSchema>
export type CustomerRiderFormData = z.infer<typeof customerRiderSchema>
export type CustomerLockboxFormData = z.infer<typeof customerLockboxSchema>
export type CustomerBrochureBoxFormData = z.infer<typeof customerBrochureBoxSchema>
