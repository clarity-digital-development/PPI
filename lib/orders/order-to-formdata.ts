/**
 * Reverse-maps an existing Order (with its orderItems, postType, scheduling and
 * property columns) back into an `OrderFormData` object so the place-order
 * wizard can be reused for EDITING an order page-by-page.
 *
 * Most structured data (property, scheduling, post type) lives on the Order
 * row. Everything else (sign / riders / lockbox / brochure / wire frame /
 * solar / second post) only exists as `orderItems` line rows, so we
 * reconstruct it by inspecting item_type / item_category / description — the
 * same conventions the wizard's ReviewStep uses when it BUILDS those items.
 *
 * Keep this in sync with `components/order-flow/steps/review-step.tsx`
 * (handleSubmit item builder) — they are the two halves of the same mapping.
 */
import type { OrderFormData, RiderSelection } from '@/components/order-flow/types'

export interface OrderItemLike {
  itemType: string
  itemCategory: string | null
  description: string
  quantity: number
  unitPrice: number | string
  totalPrice: number | string
  customerSignId?: string | null
  customerRiderId?: string | null
  customerLockboxId?: string | null
  customerBrochureBoxId?: string | null
  customValue?: string | null
}

export interface OrderLike {
  propertyType: string
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  propertyNotes: string | null
  installationLocation?: string | null
  installationLocationImage?: string | null
  isGatedCommunity: boolean
  gateCode?: string | null
  hasMarkerPlaced: boolean
  signOrientation?: string | null
  signOrientationOther?: string | null
  scheduledDate?: string | null
  isExpedited: boolean
  fuelSurcharge: number | string
  discount: number | string
  noPostSurcharge: number | string
  postType?: { name: string } | null
  // Wider shape so the review-step's live-recompute path has the promo's
  // rate/value to recompute discount against the current items on edit.
  // Backward-compatible: callers passing just { code } still type-check;
  // the populated fields default to undefined in orderToFormData below.
  promoCode?: {
    code: string
    id?: string
    discountType?: string
    discountValue?: number | string
  } | null
  orderItems: OrderItemLike[]
}

export interface WizardInventory {
  signs: Array<{ id: string; description: string; size: string | null }>
  riders: Array<{ id: string; rider_type: string; quantity: number }>
  lockboxes: Array<{ id: string; lockbox_type: string; lockbox_type_name?: string; lockbox_code: string | null }>
  brochureBoxes: { quantity: number } | null
}

// Line items belonging to the SECOND post are prefixed "Second Post ..." by the
// ReviewStep item builder, which is how we separate them from the main post.
function isSecondPost(desc: string): boolean {
  return desc.startsWith('Second Post')
}

// A rider's display name is built from its slug (slug.split('-') -> Title Case),
// so reversing it (lower-case + hyphenate) recovers the original slug exactly.
function nameToSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

// Parse a MAIN-post rider item: "Rider Rental: For Sale",
// "Rider Install: Coming Soon (from storage)", "Rider Install: 5 Acres (pickup)",
// "Rider Install: Custom: Love It/Buy It (pickup)"
function parseMainRider(item: OrderItemLike): RiderSelection {
  let body = item.description.replace(/^Rider (Rental|Install):\s*/i, '')
  // Accept either "(pickup)" (current) or "(at property)" (legacy) as the
  // pickup/at-property marker so older orders still round-trip correctly.
  const atProperty = /\((pickup|at property)\)\s*$/i.test(body)
  body = body.replace(/\s*\((from storage|at property|pickup)\)\s*$/i, '').trim()

  const source: RiderSelection['source'] = item.itemCategory === 'rental'
    ? 'rental'
    : atProperty
      ? 'at_property'
      : 'owned'

  // Free-text custom rider — "Custom: <name>" round-trips into a synthetic
  // custom-text id so the wizard re-emits the same display name on edit.
  const customMatch = body.match(/^Custom:\s*(.+)$/i)
  if (customMatch) {
    return {
      rider_type: `custom-text-restored-${item.description.length}-${customMatch[1].length}`,
      is_rental: source === 'rental',
      source,
      quantity: 1,
      custom_value: customMatch[1].trim(),
      customer_rider_id: item.customerRiderId || undefined,
    }
  }

  // Custom acreage riders render as "<number> Acres"
  const acresMatch = body.match(/^([\d.]+)\s+Acres$/i)
  const slug = acresMatch ? 'custom-acres' : nameToSlug(body)
  const customValue = acresMatch
    ? acresMatch[1]
    : (item.customValue || undefined)

  return {
    rider_type: slug,
    is_rental: source === 'rental',
    source,
    quantity: 1,
    custom_value: customValue || undefined,
    customer_rider_id: item.customerRiderId || undefined,
  }
}

// Parse a SECOND-post rider item: "Second Post Rider: <slug>[ (<custom>)][ suffix]"
// (the second-post builder uses the raw slug in the description, not a Title-cased name)
function parseSecondPostRider(item: OrderItemLike): RiderSelection {
  let body = item.description.replace(/^Second Post Rider:\s*/i, '')
  // Accept either "(pickup)" (current) or "(at property)" (legacy) marker.
  const atProperty = /\((pickup|at property)\)\s*$/i.test(body)
  // Drop trailing source suffix and any "(custom)" annotation; the slug is the
  // leading token up to the first " ("
  body = body.replace(/\s*\((from storage|at property|pickup)\)\s*$/i, '').trim()

  const source: RiderSelection['source'] = item.itemCategory === 'rental'
    ? 'rental'
    : atProperty
      ? 'at_property'
      : 'owned'

  // "Custom: <name>" round-trips into a synthetic custom-text id (mirrors the
  // main-post rider parser) so the wizard re-emits the same name on edit.
  const customMatch = body.match(/^Custom:\s*(.+)$/i)
  if (customMatch) {
    return {
      rider_type: `custom-text-restored-${item.description.length}-${customMatch[1].length}`,
      is_rental: source === 'rental',
      source,
      quantity: 1,
      custom_value: customMatch[1].trim(),
      customer_rider_id: item.customerRiderId || undefined,
    }
  }

  const slug = body.split(' (')[0].trim()
  return {
    rider_type: slug,
    is_rental: source === 'rental',
    source,
    quantity: 1,
    custom_value: item.customValue || undefined,
    customer_rider_id: item.customerRiderId || undefined,
  }
}

function num(v: number | string): number {
  return typeof v === 'string' ? parseFloat(v) || 0 : v
}

export function orderToFormData(order: OrderLike): OrderFormData {
  const items = order.orderItems

  // ---- Post ----
  let post_type: OrderFormData['post_type']
  if (order.postType?.name) {
    post_type = order.postType.name as OrderFormData['post_type']
  } else if (num(order.noPostSurcharge) > 0) {
    post_type = undefined // explicit "no post" (service trip fee applies)
  } else {
    post_type = 'open_house' // no post + no surcharge = open house / wire frame only
  }
  const wood_panel_sign_build = items.some(i => i.itemType === 'post' && /sign build/i.test(i.description))
  const wood_panel_materials = items.some(i => i.itemType === 'post' && /materials/i.test(i.description))

  // ---- Main sign ----
  const signItem = items.find(i => i.itemType === 'sign' && !isSecondPost(i.description))
  let sign_option: OrderFormData['sign_option'] = 'none'
  let stored_sign_id: string | undefined
  if (signItem) {
    const fromStorage = signItem.itemCategory === 'storage' || !!signItem.customerSignId || /from storage/i.test(signItem.description)
    sign_option = fromStorage ? 'stored' : 'at_property'
    stored_sign_id = signItem.customerSignId || undefined
  }

  // ---- Main riders ----
  const riders: RiderSelection[] = items
    .filter(i => i.itemType === 'rider' && !isSecondPost(i.description))
    .map(parseMainRider)

  // ---- Lockbox ----
  const lockboxItem = items.find(i => i.itemType === 'lockbox')
  let lockbox_option: OrderFormData['lockbox_option'] = 'none'
  let lockbox_type: string | undefined
  let lockbox_code = ''
  let customer_lockbox_id: string | undefined
  if (lockboxItem) {
    const desc = lockboxItem.description.toLowerCase()
    if (lockboxItem.itemCategory === 'rental') {
      lockbox_option = 'mechanical_rent'
      lockbox_type = 'mechanical'
      lockbox_code = lockboxItem.customValue || ''
    } else if (desc.includes('at property') || desc.includes('pickup')) {
      lockbox_option = 'at_property'
      lockbox_code = lockboxItem.customValue || ''
    } else if (desc.includes('sentrilock')) {
      lockbox_option = 'sentrilock'
      lockbox_type = 'sentrilock'
      customer_lockbox_id = lockboxItem.customerLockboxId || undefined
      lockbox_code = lockboxItem.customValue || ''
    } else {
      lockbox_option = 'mechanical_own'
      lockbox_type = 'mechanical'
      customer_lockbox_id = lockboxItem.customerLockboxId || undefined
      lockbox_code = lockboxItem.customValue || ''
    }
  }

  // ---- Brochure box ----
  const brochureItem = items.find(i => i.itemType === 'brochure_box')
  let brochure_option: OrderFormData['brochure_option'] = 'none'
  let customer_brochure_box_id: string | undefined
  if (brochureItem) {
    if (brochureItem.itemCategory === 'purchase') {
      brochure_option = 'purchase'
    } else {
      brochure_option = 'own'
      customer_brochure_box_id = brochureItem.customerBrochureBoxId || undefined
    }
  }

  // ---- Wire frame + solar (main) ----
  const wireFrameItem = items.find(i => i.itemType === 'wire_frame_sign' && !isSecondPost(i.description))
  const wire_frame_quantity = wireFrameItem ? wireFrameItem.quantity : 0
  let wire_frame_notes: string | undefined
  if (wireFrameItem) {
    const noteMatch = wireFrameItem.description.match(/—\s*(.+)$/) // text after the em dash
    wire_frame_notes = noteMatch ? noteMatch[1].trim() : undefined
  }
  const solarItem = items.find(i => i.itemType === 'solar_lighting' && !isSecondPost(i.description))
  const solar_lighting_quantity = solarItem ? solarItem.quantity : 0

  // ---- Second post ----
  const secondPostItem = items.find(i => i.itemType === 'second_post')
  const second_post_enabled = !!secondPostItem
  let second_post_install_location = ''
  if (secondPostItem) {
    const locMatch = secondPostItem.description.match(/Second Post\s*—\s*(.+)$/)
    second_post_install_location = locMatch ? locMatch[1].trim() : ''
  }
  const spSignItem = items.find(i => i.itemType === 'sign' && isSecondPost(i.description))
  let second_post_sign_option: OrderFormData['second_post_sign_option'] = 'none'
  let second_post_stored_sign_id: string | undefined
  if (spSignItem) {
    const fromStorage = spSignItem.itemCategory === 'storage' || !!spSignItem.customerSignId || /from storage/i.test(spSignItem.description)
    second_post_sign_option = fromStorage ? 'stored' : 'at_property'
    second_post_stored_sign_id = spSignItem.customerSignId || undefined
  }
  const second_post_riders: RiderSelection[] = items
    .filter(i => i.itemType === 'rider' && isSecondPost(i.description))
    .map(parseSecondPostRider)
  const spWireFrame = items.find(i => i.itemType === 'wire_frame_sign' && isSecondPost(i.description))
  const second_post_wire_frame_quantity = spWireFrame ? spWireFrame.quantity : 0
  const spSolar = items.find(i => i.itemType === 'solar_lighting' && isSecondPost(i.description))
  const second_post_solar_lighting_quantity = spSolar ? spSolar.quantity : 0

  // ---- Scheduling ----
  let schedule_type: OrderFormData['schedule_type'] = 'next_available'
  let requested_date: string | undefined
  if (order.isExpedited) {
    schedule_type = 'expedited'
  } else if (order.scheduledDate) {
    schedule_type = 'specific_date'
    // scheduledDate is stored at noon UTC — the date portion is the chosen day
    requested_date = String(order.scheduledDate).slice(0, 10)
  }

  return {
    // Property
    property_type: order.propertyType as OrderFormData['property_type'],
    property_address: order.propertyAddress || '',
    property_city: order.propertyCity || '',
    property_state: order.propertyState || 'KY',
    property_zip: order.propertyZip || '',
    installation_location: order.installationLocation || '',
    installation_location_image: order.installationLocationImage || undefined,
    installation_notes: order.propertyNotes || '',
    is_gated_community: order.isGatedCommunity,
    gate_code: order.gateCode || '',
    has_marker_placed: order.hasMarkerPlaced,
    sign_orientation: (order.signOrientation as OrderFormData['sign_orientation']) || 'installer_decides',
    sign_orientation_other: order.signOrientationOther || '',
    // Post
    post_type,
    wood_panel_sign_build,
    wood_panel_materials,
    // Sign
    sign_option,
    stored_sign_id,
    sign_description: '',
    // Riders
    riders,
    // Wire frame + solar
    wire_frame_quantity,
    wire_frame_notes,
    solar_lighting_quantity,
    // Second post
    second_post_enabled,
    second_post_install_location,
    second_post_sign_option,
    second_post_stored_sign_id,
    second_post_riders,
    second_post_wire_frame_quantity,
    second_post_solar_lighting_quantity,
    // Lockbox
    lockbox_option,
    lockbox_type,
    lockbox_code,
    customer_lockbox_id,
    // Brochure
    brochure_option,
    customer_brochure_box_id,
    // Scheduling
    schedule_type,
    requested_date,
    // Payment — not used in edit mode (orders are not re-charged on edit)
    payment_method_id: undefined,
    save_payment_method: false,
    // Promo — carried for display AND live recompute. The id + discountType +
    // discountValue let the review-step recompute the dollar discount as the
    // customer changes items in edit mode (so display matches the server's
    // recomputation on save). Without these the recompute falls back to the
    // frozen `discount` value, drifting silently from the server total.
    promo_code: order.promoCode?.code,
    promo_code_id: order.promoCode?.id,
    promo_discount_type: order.promoCode?.discountType === 'percentage' || order.promoCode?.discountType === 'fixed'
      ? order.promoCode.discountType
      : undefined,
    promo_discount_value: order.promoCode?.discountValue !== undefined
      ? Number(order.promoCode.discountValue)
      : undefined,
    discount: num(order.discount) || undefined,
    fuel_surcharge_waived: num(order.fuelSurcharge) === 0,
    placed_for_agent_name: '',
  }
}

/**
 * The place-order inventory API only returns items still IN storage. When
 * editing, the items already on THIS order are out of storage, so we merge
 * them back into the inventory lists (using the IDs + descriptions carried on
 * the order items) so the wizard can show them as the current selection.
 */
export function augmentInventoryWithOrder(
  inv: WizardInventory | undefined,
  order: OrderLike,
): WizardInventory {
  const base: WizardInventory = {
    signs: inv?.signs ? [...inv.signs] : [],
    riders: inv?.riders ? [...inv.riders] : [],
    lockboxes: inv?.lockboxes ? [...inv.lockboxes] : [],
    brochureBoxes: inv?.brochureBoxes ?? null,
  }

  // Prepend (unshift) the order's own items so that, where the wizard de-dupes
  // entries by description (the sign dropdown groups same-named signs and keeps
  // the FIRST id), the specific item on this order wins — otherwise the select
  // value (formData.stored_sign_id) wouldn't match any visible option.
  for (const item of order.orderItems) {
    if (item.itemType === 'sign' && item.customerSignId) {
      if (!base.signs.some(s => s.id === item.customerSignId)) {
        const m = item.description.match(/Sign Install:\s*(.+?)\s*\(from storage\)/i)
        const desc = (m ? m[1] : '').trim() || 'Stored sign'
        base.signs.unshift({ id: item.customerSignId, description: desc, size: null })
      }
    }
    if (item.itemType === 'rider' && item.customerRiderId) {
      const slug = isSecondPost(item.description)
        ? parseSecondPostRider(item).rider_type
        : parseMainRider(item).rider_type
      if (!base.riders.some(r => r.id === item.customerRiderId || r.rider_type === slug)) {
        base.riders.unshift({ id: item.customerRiderId, rider_type: slug, quantity: 1 })
      }
    }
    if (item.itemType === 'lockbox' && item.customerLockboxId) {
      if (!base.lockboxes.some(l => l.id === item.customerLockboxId)) {
        const isSentri = /sentri/i.test(item.description)
        base.lockboxes.unshift({
          id: item.customerLockboxId,
          lockbox_type: isSentri ? 'sentrilock' : 'mechanical',
          lockbox_type_name: isSentri ? 'SentriLock' : 'Mechanical Lockbox',
          lockbox_code: item.customValue || null,
        })
      }
    }
  }

  return base
}
