import type { PropertyType } from '@/types/database'

export interface RiderSelection {
  rider_type: string
  is_rental: boolean
  source?: 'rental' | 'owned' | 'at_property' // tri-state; is_rental kept for back-compat
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
  post_type: 'White Vinyl Post' | 'Black Vinyl Post' | 'Signature Pink Post' | 'Metal Frame Sign' | 'Wood Panel Post' | 'open_house' | undefined

  // Wood Panel Post add-ons (only used when post_type === 'Wood Panel Post')
  wood_panel_sign_build: boolean // +$55 if Pink Posts builds the sign
  wood_panel_materials: boolean  // +$55 if Pink Posts supplies materials (4x4 posts, screws, washers)

  // Sign Selection
  sign_option: 'stored' | 'at_property' | 'none'
  stored_sign_id?: string
  sign_description?: string

  // Rider Selection
  riders: RiderSelection[]

  // Lockbox Selection
  lockbox_option: 'sentrilock' | 'mechanical_own' | 'mechanical_rent' | 'at_property' | 'none'
  lockbox_type?: string
  lockbox_code?: string
  customer_lockbox_id?: string

  // Wire Frame Signs
  wire_frame_quantity: number
  wire_frame_notes?: string

  // Solar Lighting
  solar_lighting_quantity: number

  // Second Post (optional add-on after Riders step)
  second_post_enabled: boolean
  second_post_install_location?: string
  second_post_sign_option: 'stored' | 'at_property' | 'none'
  second_post_stored_sign_id?: string
  second_post_riders: RiderSelection[]
  second_post_wire_frame_quantity: number
  second_post_solar_lighting_quantity: number

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
  // Stored discount amount as last computed. Stays in sync with the live
  // items via the review-step's recompute (uses promo_discount_type +
  // promo_discount_value below). Pre-Round 27 this was set once at promo-
  // apply time and never re-derived — silently drifting whenever the
  // customer changed items afterwards.
  discount?: number
  // Promo's rate/value, captured at apply time so the review-step can
  // recompute the dollar discount as items change. Mirrors the columns on
  // the PromoCode model that the server uses to recompute at create/edit
  // time, so client preview and server save stay aligned.
  promo_discount_type?: 'percentage' | 'fixed'
  promo_discount_value?: number
  fuel_surcharge_waived?: boolean

  // Team-admin only: the name of the agent on the team who sold this property.
  // Captured at checkout so each order in a batch can be attributed.
  placed_for_agent_name?: string
}

export interface StepProps {
  formData: OrderFormData
  updateFormData: (updates: Partial<OrderFormData>) => void
  inventory?: {
    signs: Array<{ id: string; description: string; size: string | null }>
    riders: Array<{ id: string; rider_type: string; quantity: number }>
    lockboxes: Array<{ id: string; lockbox_type: string; lockbox_type_name?: string; lockbox_code: string | null; serial_number?: string | null }>
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
  // Optional: when an admin / team_admin is placing the order for an agent,
  // this is the agent's user id. Passed through to the API on submit.
  onBehalfOf?: string
  // TeamMember.id (NOT a User id) the order is being placed for in the
  // team_admin gate path. Used as the cart row's agentId for edit-time
  // inventory scoping. See OrderWizard's props for the full reasoning.
  placedForMemberId?: string
  // Current user's role — controls team-admin specific UX (cart, agent name input)
  currentUserRole?: string | null
  // Edit mode: when 'edit', the wizard edits an existing order in place
  // (PATCH instead of POST, no re-charge) rather than creating a new one.
  mode?: 'create' | 'edit'
  orderId?: string
  // Display-only metadata about the order being edited (review step shows the
  // original total alongside the recomputed one).
  // flatFeeBase / flatFeeFuel: the ORDER's own locked flat-fee base
  // (Order.subtotal) and fuel rate (Order.fuelSurcharge) when flatFee is
  // true — lets the review-step preview match what the server will
  // actually save for a pre-rate-bump order instead of showing the current
  // global FLAT_FEE_BASE / fuel constant. Undefined for create mode (uses
  // the current constants, correct for a brand-new order).
  editMeta?: { orderNumber: string; originalTotal: number; flatFeeBase?: number; flatFeeFuel?: number }
  // Per-broker override for the OWNED-lockbox install fee (sentri/supra,
  // mechanical-owned, at-property). Defaults to PRICING.lockbox_install ($5).
  // Some brokers (e.g. Semonin) get it free ($0). Rental is unaffected.
  lockboxInstallFee?: number
  // CR4: flat-fee account — review step shows the flat $66.07 breakdown instead
  // of itemized pricing (server clamps the charge regardless).
  flatFee?: boolean
  // When true, the review step shows internal distance-check breadcrumb info
  // alongside the out-of-area fee (which service center triggered it + the
  // estimated drive time). Customer view hides this since seeing "Bardstown
  // (~51 min)" on a Harrodsburg install was confusing — they thought the
  // install was routed through Bardstown. Admin edit shell passes true so
  // admins can still see which center triggered the fee when reviewing an order.
  adminView?: boolean
  // When set, the review step updates this existing cart row in place
  // (with a hold diff) instead of creating a new one.
  editingCartItemId?: string
}

export const PRICING = {
  posts: {
    'White Vinyl Post': 59,
    'Black Vinyl Post': 59,
    'Signature Pink Post': 65,
    'Metal Frame Sign': 40,
    'Wood Panel Post': 95,
  },
  wood_panel_sign_build: 55,
  wood_panel_materials: 55,
  no_post_surcharge: 40,
  sign_install: 3,
  rider_rental: 5,
  rider_install: 2,
  lockbox_install: 5,
  lockbox_rental: 10,
  wire_frame_sign: 5,
  solar_lighting: 5,
  second_post: 25,
  brochure_box_purchase: 24,
  brochure_box_install: 3,
  fuel_surcharge: 3.49,
  expedite_fee: 50,
  tax_rate: 0.06, // Kentucky 6% sales tax
} as const
