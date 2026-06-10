'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Lock, AlertCircle, Tag, CheckCircle, Loader2, Plus } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { AddCardModal } from '@/components/billing'
import { cn } from '@/lib/utils'
import { getStripe } from '@/lib/stripe/client'
import { useCart } from '@/lib/cart'
import { lockboxDescriptionSuffix } from '@/lib/orders/lockbox-description'
import type { StepProps } from '../types'
import { PRICING } from '../types'

// Post type values are now the display names themselves

export function ReviewStep({
  formData,
  updateFormData,
  inventory,
  paymentMethods,
  isSubmitting,
  setIsSubmitting,
  onBehalfOf,
  currentUserRole,
  mode = 'create',
  orderId,
  editMeta,
  lockboxInstallFee,
  editingCartItemId,
}: StepProps) {
  // Edit mode reuses this step to save changes to an existing order (PATCH,
  // no re-charge) rather than creating + paying for a new one.
  const isEdit = mode === 'edit'
  // Owned-lockbox install fee (sentri/supra, mechanical-owned, at-property).
  // Normally $5; $0 for free-install brokers (e.g. Semonin). Rental unaffected.
  const lockboxInstall = lockboxInstallFee ?? PRICING.lockbox_install
  // Cart + agent-name input are enabled for team-admin accounts AND for
  // Pink Posts internal admins (so admin@pinkposts.com can test/use the
  // same flow). Also enabled when an admin is placing on behalf of a
  // specific agent. Regular customers get the classic single-order flow.
  // Never enabled while editing (an edit is a single in-place update).
  const isTeamAdmin = currentUserRole === 'team_admin' || currentUserRole === 'admin'
  const cartEnabled = (isTeamAdmin || !!onBehalfOf) && !isEdit
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [promoCodeInput, setPromoCodeInput] = useState(formData.promo_code || '')
  const [promoCodeError, setPromoCodeError] = useState<string | null>(null)
  const [promoCodeSuccess, setPromoCodeSuccess] = useState<string | null>(
    formData.promo_code_id ? `Promo code "${formData.promo_code}" applied!` : null
  )
  const [applyingPromo, setApplyingPromo] = useState(false)
  const [showAddCard, setShowAddCard] = useState(false)
  const [localPaymentMethods, setLocalPaymentMethods] = useState(paymentMethods || [])
  const [calculatedTax, setCalculatedTax] = useState<number | null>(null)
  const [taxRate, setTaxRate] = useState<string>('6%') // Default display
  const [loadingTax, setLoadingTax] = useState(false)
  // WHY: cart preview needs the same surcharge the server will inject — otherwise display ≠ charge.
  const [serviceAreaQuote, setServiceAreaQuote] = useState<{
    tier: 'standard' | 'surcharge' | 'out_of_area' | 'exempt'
    surchargeCents: number
    centerName?: string
    driveTimeMinutes?: number
    contactPhone?: string
    reason?: string
  } | null>(null)

  // Build the "— Serial: X · Code: Y" suffix for a selected stored lockbox so
  // the install crew can see which physical box to bring (flows into emails too)
  const lockboxIdentifierSuffix = (): string => {
    if (!formData.customer_lockbox_id) return ''
    const lb = inventory?.lockboxes.find(l => l.id === formData.customer_lockbox_id)
    if (!lb) return ''
    return lockboxDescriptionSuffix({
      serialNumber: lb.serial_number,
      code: lb.lockbox_code || formData.lockbox_code,
    })
  }

  // Calculate order items and totals
  const orderItems: Array<{ description: string; price: number; excludeFromDiscount?: boolean }> = []

  // Post
  if (formData.post_type && formData.post_type !== 'open_house') {
    orderItems.push({
      description: `${formData.post_type} (install & pickup)`,
      price: PRICING.posts[formData.post_type],
    })
    // Wood Panel Post add-ons (only when Wood Panel is selected)
    if (formData.post_type === 'Wood Panel Post' && formData.wood_panel_sign_build) {
      orderItems.push({
        description: 'Wood Panel: sign build',
        price: PRICING.wood_panel_sign_build,
      })
      if (formData.wood_panel_materials) {
        orderItems.push({
          description: 'Wood Panel: materials (4x4 posts, screws, washers)',
          price: PRICING.wood_panel_materials,
        })
      }
    }
  }
  // open_house: no charge for the post itself — wire frames charged separately

  // No-post surcharge (service trip fee when no post is selected; open_house is its own service so no surcharge)
  const noPostSurcharge = !formData.post_type ? PRICING.no_post_surcharge : 0

  // Sign
  if (formData.sign_option === 'stored') {
    const selectedSign = inventory?.signs.find(s => s.id === formData.stored_sign_id)
    orderItems.push({
      description: selectedSign ? `Sign Install: ${selectedSign.description} (from storage)` : 'Sign Install (from storage)',
      price: PRICING.sign_install,
    })
  } else if (formData.sign_option === 'at_property') {
    orderItems.push({
      description: 'Sign Install',
      price: PRICING.sign_install,
    })
  }

  // Riders
  formData.riders.forEach((rider) => {
    const source = rider.source ?? (rider.is_rental ? 'rental' : 'owned')
    const price = source === 'rental' ? PRICING.rider_rental : PRICING.rider_install
    // Custom free-text riders (pickup/at-property) — render as "Custom: <name>"
    // so the agent's typed name flows into the review, admin detail, and emails.
    const isCustomText = rider.rider_type.startsWith('custom-text-')
    const name = isCustomText
      ? `Custom: ${rider.custom_value || 'rider'}`
      : rider.custom_value
        ? `${rider.custom_value} Acres`
        : rider.rider_type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    const description = source === 'rental'
      ? `Rider Rental: ${name}`
      : source === 'at_property'
        ? `Rider Install: ${name} (pickup)`
        : `Rider Install: ${name} (from storage)`
    orderItems.push({
      description,
      price,
    })
  })

  // Lockbox — enrich description with the selected stored lockbox's serial/code
  // so the install crew knows which physical unit to grab from storage
  if (formData.lockbox_option === 'sentrilock' || formData.lockbox_option === 'mechanical_own') {
    const base = formData.lockbox_option === 'sentrilock' ? 'Sentrilock/Supra Install' : 'Mechanical Lockbox Install'
    orderItems.push({
      description: `${base}${lockboxIdentifierSuffix()}`,
      price: lockboxInstall,
    })
  } else if (formData.lockbox_option === 'at_property') {
    orderItems.push({
      description: `Lockbox Install (at property / pickup)${lockboxIdentifierSuffix()}`,
      price: lockboxInstall,
    })
  } else if (formData.lockbox_option === 'mechanical_rent') {
    orderItems.push({
      description: `Mechanical Lockbox Rental${lockboxIdentifierSuffix()}`,
      price: PRICING.lockbox_rental,
    })
  }

  // Wire Frame Signs
  if (formData.wire_frame_quantity > 0) {
    orderItems.push({
      description: `Wire Frame Sign Install \u00d7 ${formData.wire_frame_quantity}${formData.wire_frame_notes ? ` \u2014 ${formData.wire_frame_notes}` : ''}`,
      price: formData.wire_frame_quantity * PRICING.wire_frame_sign,
    })
  }

  // Solar Lighting
  if (formData.solar_lighting_quantity > 0) {
    orderItems.push({
      description: `Solar Lighting \u00d7 ${formData.solar_lighting_quantity}`,
      price: formData.solar_lighting_quantity * PRICING.solar_lighting,
    })
  }

  // Second Post
  if (formData.second_post_enabled) {
    orderItems.push({
      description: `Second Post${formData.second_post_install_location ? ` \u2014 ${formData.second_post_install_location}` : ''}`,
      price: PRICING.second_post,
    })
    if (formData.second_post_sign_option !== 'none') {
      const storedSign2 = formData.second_post_sign_option === 'stored'
        ? inventory?.signs.find(s => s.id === formData.second_post_stored_sign_id)
        : null
      orderItems.push({
        description: storedSign2
          ? `Second Post Sign Install: ${storedSign2.description} (from storage)`
          : 'Second Post Sign Install',
        price: PRICING.sign_install,
      })
    }
    if (formData.second_post_riders.length > 0) {
      const ridersTotal = formData.second_post_riders.reduce((sum, r) => sum + (r.is_rental ? PRICING.rider_rental : PRICING.rider_install), 0)
      orderItems.push({
        description: `Second Post Riders \u00d7 ${formData.second_post_riders.length}`,
        price: ridersTotal,
      })
    }
    if (formData.second_post_wire_frame_quantity > 0) {
      orderItems.push({
        description: `Second Post Wire Frame Signs \u00d7 ${formData.second_post_wire_frame_quantity}`,
        price: formData.second_post_wire_frame_quantity * PRICING.wire_frame_sign,
      })
    }
    if (formData.second_post_solar_lighting_quantity > 0) {
      orderItems.push({
        description: `Second Post Solar Lighting \u00d7 ${formData.second_post_solar_lighting_quantity}`,
        price: formData.second_post_solar_lighting_quantity * PRICING.solar_lighting,
      })
    }
  }

  // Brochure box (purchases excluded from promo discounts)
  if (formData.brochure_option === 'purchase') {
    orderItems.push({
      description: 'Brochure Box Purchase (includes install)',
      price: PRICING.brochure_box_purchase,
      excludeFromDiscount: true,
    })
  } else if (formData.brochure_option === 'own') {
    orderItems.push({
      description: 'Brochure Box Install (your own)',
      price: PRICING.brochure_box_install,
    })
  }

  // WHY: server pushes a synthetic surcharge OrderItem into items[] then sums — mirror that here.
  const serviceAreaSurcharge = serviceAreaQuote?.tier === 'surcharge'
    ? serviceAreaQuote.surchargeCents / 100
    : 0
  const itemsSubtotal = orderItems.reduce((sum, item) => sum + item.price, 0)
  const subtotal = itemsSubtotal + serviceAreaSurcharge
  // Discountable subtotal excludes items like brochure box purchases
  const discountableSubtotal = orderItems.filter(item => !item.excludeFromDiscount).reduce((sum, item) => sum + item.price, 0) + serviceAreaSurcharge
  const expediteFee = formData.schedule_type === 'expedited' ? PRICING.expedite_fee : 0
  const discount = formData.discount || 0
  const fuelSurchargeWaived = formData.fuel_surcharge_waived || false
  const fuelSurcharge = fuelSurchargeWaived ? 0 : PRICING.fuel_surcharge
  const discountedSubtotal = Math.max(0, subtotal - discount)
  const taxableAmount = discountedSubtotal + expediteFee + noPostSurcharge // Fuel surcharge typically not taxed

  // Use calculated tax from Stripe Tax API, or fallback to default rate
  const fallbackTax = Math.round(taxableAmount * PRICING.tax_rate * 100) / 100
  const tax = calculatedTax !== null ? calculatedTax : fallbackTax
  const total = discountedSubtotal + fuelSurcharge + expediteFee + noPostSurcharge + tax

  // Build items for tax calculation (same structure used in submit)
  const buildTaxItems = useCallback(() => {
    const items: Array<{ item_type: string; total_price: number }> = []

    if (formData.post_type && formData.post_type !== 'open_house') {
      items.push({ item_type: 'post', total_price: PRICING.posts[formData.post_type] })
      // Wood panel add-ons count as taxable items too
      if (formData.post_type === 'Wood Panel Post' && formData.wood_panel_sign_build) {
        items.push({ item_type: 'post', total_price: PRICING.wood_panel_sign_build })
        if (formData.wood_panel_materials) {
          items.push({ item_type: 'post', total_price: PRICING.wood_panel_materials })
        }
      }
    }
    if (formData.sign_option === 'stored' || formData.sign_option === 'at_property') {
      items.push({ item_type: 'sign', total_price: PRICING.sign_install })
    }
    formData.riders.forEach((rider) => {
      const price = rider.is_rental ? PRICING.rider_rental : PRICING.rider_install
      items.push({ item_type: 'rider', total_price: price })
    })
    if (formData.lockbox_option === 'sentrilock' || formData.lockbox_option === 'mechanical_own' || formData.lockbox_option === 'at_property') {
      items.push({ item_type: 'lockbox', total_price: lockboxInstall })
    } else if (formData.lockbox_option === 'mechanical_rent') {
      items.push({ item_type: 'lockbox', total_price: PRICING.lockbox_rental })
    }
    if (formData.wire_frame_quantity > 0) {
      items.push({ item_type: 'wire_frame_sign', total_price: formData.wire_frame_quantity * PRICING.wire_frame_sign })
    }
    if (formData.solar_lighting_quantity > 0) {
      items.push({ item_type: 'solar_lighting', total_price: formData.solar_lighting_quantity * PRICING.solar_lighting })
    }
    if (formData.second_post_enabled) {
      items.push({ item_type: 'second_post', total_price: PRICING.second_post })
      if (formData.second_post_sign_option !== 'none') {
        items.push({ item_type: 'sign', total_price: PRICING.sign_install })
      }
      formData.second_post_riders.forEach(rider => {
        items.push({ item_type: 'rider', total_price: rider.is_rental ? PRICING.rider_rental : PRICING.rider_install })
      })
      if (formData.second_post_wire_frame_quantity > 0) {
        items.push({ item_type: 'wire_frame_sign', total_price: formData.second_post_wire_frame_quantity * PRICING.wire_frame_sign })
      }
      if (formData.second_post_solar_lighting_quantity > 0) {
        items.push({ item_type: 'solar_lighting', total_price: formData.second_post_solar_lighting_quantity * PRICING.solar_lighting })
      }
    }
    if (formData.brochure_option === 'purchase') {
      items.push({ item_type: 'brochure_box', total_price: PRICING.brochure_box_purchase })
    } else if (formData.brochure_option === 'own') {
      items.push({ item_type: 'brochure_box', total_price: PRICING.brochure_box_install })
    }

    return items
  }, [formData.post_type, formData.sign_option, formData.riders, formData.lockbox_option, formData.wire_frame_quantity, formData.solar_lighting_quantity, formData.second_post_enabled, formData.second_post_sign_option, formData.second_post_riders, formData.second_post_wire_frame_quantity, formData.second_post_solar_lighting_quantity, formData.brochure_option])

  // Fetch tax from Stripe Tax API
  useEffect(() => {
    const fetchTax = async () => {
      // Only calculate if we have address info and items
      if (!formData.property_city || !formData.property_state || !formData.property_zip) {
        return
      }

      const items = buildTaxItems()
      if (items.length === 0) {
        return
      }

      setLoadingTax(true)
      try {
        const res = await fetch('/api/tax/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items,
            expedite_fee: expediteFee,
            discount: discount,
            address: {
              line1: formData.property_address,
              city: formData.property_city,
              state: formData.property_state,
              postal_code: formData.property_zip,
            },
          }),
        })

        if (res.ok) {
          const data = await res.json()
          setCalculatedTax(data.tax)
          if (data.tax_rate) {
            setTaxRate(`${(data.tax_rate * 100).toFixed(1)}%`)
          }
        }
      } catch (err) {
        console.error('Error fetching tax:', err)
        // Keep using fallback tax
      } finally {
        setLoadingTax(false)
      }
    }

    fetchTax()
  }, [
    formData.property_address,
    formData.property_city,
    formData.property_state,
    formData.property_zip,
    expediteFee,
    discount,
    buildTaxItems,
  ])

  // WHY: customer must see the out-of-area surcharge BEFORE submit — server-side injection alone hides it.
  useEffect(() => {
    const zip = (formData.property_zip || '').trim()
    if (!/^\d{5}$/.test(zip)) {
      setServiceAreaQuote(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/service-area/quote?zip=${encodeURIComponent(zip)}`)
        if (!res.ok) {
          if (!cancelled) setServiceAreaQuote(null)
          return
        }
        const data = await res.json()
        if (!cancelled) setServiceAreaQuote(data)
      } catch {
        if (!cancelled) setServiceAreaQuote(null)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [formData.property_zip])

  // Handle promo code application
  const handleApplyPromoCode = async () => {
    if (!promoCodeInput.trim()) {
      setPromoCodeError('Please enter a promo code')
      return
    }

    setApplyingPromo(true)
    setPromoCodeError(null)
    setPromoCodeSuccess(null)

    try {
      const res = await fetch('/api/promo-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: promoCodeInput.trim(),
          subtotal: discountableSubtotal,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Invalid promo code')
      }

      updateFormData({
        promo_code: data.promoCode.code,
        promo_code_id: data.promoCode.id,
        discount: data.discount,
        fuel_surcharge_waived: data.promoCode.waiveFuelSurcharge || false,
      })
      const savings = data.discount + (data.promoCode.waiveFuelSurcharge ? PRICING.fuel_surcharge : 0)
      const brochureExcluded = formData.brochure_option === 'purchase'
      setPromoCodeSuccess(`Promo code "${data.promoCode.code}" applied! You save $${savings.toFixed(2)}${data.promoCode.waiveFuelSurcharge ? ' (includes fuel surcharge waiver)' : ''}${brochureExcluded ? ' (excludes brochure box purchase)' : ''}`)
    } catch (err) {
      setPromoCodeError(err instanceof Error ? err.message : 'Failed to apply promo code')
    } finally {
      setApplyingPromo(false)
    }
  }

  const handleRemovePromoCode = () => {
    updateFormData({
      promo_code: undefined,
      promo_code_id: undefined,
      discount: undefined,
      fuel_surcharge_waived: false,
    })
    setPromoCodeInput('')
    setPromoCodeSuccess(null)
    setPromoCodeError(null)
  }

  // Use local state that can be updated after adding a card
  const activePaymentMethods = localPaymentMethods.length > 0 ? localPaymentMethods : paymentMethods
  const defaultPaymentMethod = activePaymentMethods?.find((pm) => pm.is_default)

  // Handler for when a new card is added
  const handleCardAdded = async () => {
    setShowAddCard(false)
    try {
      const res = await fetch('/api/payments/methods')
      if (res.ok) {
        const data = await res.json()
        setLocalPaymentMethods(data.paymentMethods || [])
        // Auto-select the newly added card if it's the first one
        if (data.paymentMethods?.length > 0 && !formData.payment_method_id) {
          const defaultCard = data.paymentMethods.find((pm: { is_default: boolean }) => pm.is_default)
          if (defaultCard) {
            updateFormData({ payment_method_id: defaultCard.id })
          }
        }
      }
    } catch (err) {
      console.error('Error fetching payment methods:', err)
    }
  }

  // Cart support (for admin/team_admin batching multiple agent orders)
  const cart = useCart()
  const [addingToCart, setAddingToCart] = useState(false)

  const handleAddToCart = async () => {
    if (orderItems.length === 0) {
      setError(editingCartItemId
        ? 'Please keep at least one item on the order'
        : 'Please select at least one item for the order')
      return
    }
    if (!cartEnabled) {
      setError('Cart is only available for team admin accounts.')
      return
    }
    setAddingToCart(true)
    setError(null)
    try {
      // Use the FULL-fidelity items shape (with customer_*_id refs preserved)
      // so the cart can carry inventory ids through to checkout. Previously
      // we threw all of these away, so the cart was untrackable.
      const items = buildItems() as Array<Record<string, unknown>>

      const { getOrCreateCartSessionId } = await import('@/lib/cart-session')
      const cartSessionId = getOrCreateCartSessionId()

      // Edit flow: reuse the existing row id so the new holds attach to the
      // same cart_item_id. Create flow: mint a fresh id.
      const cartItemId = editingCartItemId
        || `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // Existing row (only meaningful in edit mode) — used for the hold diff.
      const existingRow = editingCartItemId
        ? cart.items.find(i => i.id === editingCartItemId)
        : undefined
      // If the heartbeat marked the row's holds dead server-side, treat every
      // pick as a fresh acquire and skip the release step.
      const existingHoldsAreDead = !!editingCartItemId
        && !!existingRow?.holdsExpireAt
        && new Date(existingRow.holdsExpireAt).getTime() < Date.now()
      const oldHoldIds: Record<string, string> = existingHoldsAreDead
        ? {}
        : (existingRow?.holdIds || {})

      // Each Customer*-typed line item needs a hold. Brochure boxes don't
      // participate in the hold infrastructure (quantity-aggregated).
      const holdRequests: Array<{ key: string; field: 'customer_sign_id' | 'customer_rider_id' | 'customer_lockbox_id'; itemType: 'sign' | 'rider' | 'lockbox'; itemId: string }> = []
      for (const it of items) {
        if (it.customer_sign_id) {
          const id = String(it.customer_sign_id)
          holdRequests.push({ key: `customer_sign_id:${id}`, field: 'customer_sign_id', itemType: 'sign', itemId: id })
        }
        if (it.customer_rider_id) {
          const id = String(it.customer_rider_id)
          holdRequests.push({ key: `customer_rider_id:${id}`, field: 'customer_rider_id', itemType: 'rider', itemId: id })
        }
        if (it.customer_lockbox_id) {
          const id = String(it.customer_lockbox_id)
          holdRequests.push({ key: `customer_lockbox_id:${id}`, field: 'customer_lockbox_id', itemType: 'lockbox', itemId: id })
        }
      }

      const newKeys = new Set(holdRequests.map(r => r.key))
      const toAcquire = holdRequests.filter(r => !oldHoldIds[r.key])
      const toReleaseHoldIds = Object.entries(oldHoldIds)
        .filter(([k]) => !newKeys.has(k))
        .map(([, hid]) => hid)

      const holdIds: Record<string, string> = {}
      // Carry forward unchanged keys reusing their existing hold id.
      for (const r of holdRequests) {
        if (oldHoldIds[r.key]) holdIds[r.key] = oldHoldIds[r.key]
      }

      // ACQUIRE FIRST — if any new pick conflicts we unwind only the holds
      // we just minted, leaving the user's pre-edit reservations intact.
      const acquired: string[] = []
      let holdsExpireAt: string | undefined = existingRow?.holdsExpireAt
      try {
        for (const req of toAcquire) {
          const res = await fetch('/api/inventory/holds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_type: req.itemType,
              item_id: req.itemId,
              cart_session_id: cartSessionId,
              cart_item_id: cartItemId,
              on_behalf_of_user_id: onBehalfOf || undefined,
            }),
          })
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}))
            if (res.status === 409) {
              throw new Error(
                errBody.code === 'item_already_held'
                  ? 'One of these items is already in another cart. Please refresh the inventory list and re-pick.'
                  : `Could not reserve item: ${errBody.error || errBody.code || 'conflict'}`
              )
            }
            throw new Error(errBody.error || 'Could not reserve item for cart')
          }
          const body = (await res.json()) as { hold_id: string; expires_at: string }
          holdIds[req.key] = body.hold_id
          acquired.push(body.hold_id)
          if (!holdsExpireAt || body.expires_at < holdsExpireAt) holdsExpireAt = body.expires_at
        }
      } catch (acqErr) {
        // Unwind any holds we just acquired so we don't strand inventory.
        // toRelease (the user's original picks they're swapping away) is
        // untouched so they can recover by cancelling out of the wizard.
        await Promise.all(
          acquired.map(holdId =>
            fetch(`/api/inventory/holds?id=${encodeURIComponent(holdId)}`, { method: 'DELETE' }).catch(() => undefined)
          )
        )
        throw acqErr
      }

      // THEN release stale holds. 404s on already-dead holds are harmless —
      // swallow them so the save still completes for expired-row edits.
      await Promise.all(
        toReleaseHoldIds.map(holdId =>
          fetch(`/api/inventory/holds?id=${encodeURIComponent(holdId)}`, { method: 'DELETE' }).catch(() => undefined)
        )
      )

      // Use the typed agent name if provided; otherwise fall back to the
      // agent's full name from /api/admin/customers (legacy on-behalf-of flow)
      let agentName = formData.placed_for_agent_name?.trim() || ''
      let agentEmail = ''
      if (!agentName && onBehalfOf) {
        try {
          const res = await fetch(`/api/admin/customers/${onBehalfOf}`)
          if (res.ok) {
            const data = await res.json()
            agentName = data.customer.full_name || data.customer.email || ''
            agentEmail = data.customer.email || ''
          }
        } catch {
          // Best-effort
        }
      }

      if (editingCartItemId && existingRow) {
        // Update in place — preserve original agentId/agentEmail/addedAt so
        // the row's identity stays stable. Refresh display fields and holds.
        cart.updateItem(editingCartItemId, {
          agentName: agentName || existingRow.agentName || 'Unassigned',
          formData,
          items,
          estimatedTotal: total,
          propertyAddress: `${formData.property_address}, ${formData.property_city}`,
          holdIds,
          holdsExpireAt,
        })
      } else {
        // Create flow — write the row with the pre-minted id so the hold's
        // cart_item_id matches.
        const newItem = {
          id: cartItemId,
          agentId: onBehalfOf || '',
          agentName: agentName || 'Unassigned',
          agentEmail,
          formData,
          items,
          estimatedTotal: total,
          propertyAddress: `${formData.property_address}, ${formData.property_city}`,
          addedAt: new Date().toISOString(),
          holdIds,
          holdsExpireAt,
        }
        const raw = window.localStorage.getItem('pp_cart_v1')
        const existing = raw ? (JSON.parse(raw) as unknown[]) : []
        const next = Array.isArray(existing) ? [...existing, newItem] : [newItem]
        window.localStorage.setItem('pp_cart_v1', JSON.stringify(next))
        window.dispatchEvent(new Event('pp_cart_change'))
      }

      router.push('/dashboard/cart')
    } catch (err) {
      setError(err instanceof Error ? err.message : editingCartItemId ? 'Could not save changes' : 'Could not add to cart')
    } finally {
      setAddingToCart(false)
    }
  }

  // Build the typed order items[] array from the current form selections.
  // Shared by create (POST /api/orders) and edit (PATCH /api/orders/[id]/edit).
  const buildItems = () => {
      const items: Array<{
        item_type: string
        item_category?: string
        description: string
        quantity: number
        unit_price: number
        total_price: number
        customer_rider_id?: string
        customer_brochure_box_id?: string
        customer_lockbox_id?: string
        customer_sign_id?: string
        custom_value?: string
      }> = []

      // Post
      if (formData.post_type && formData.post_type !== 'open_house') {
        items.push({
          item_type: 'post',
          item_category: 'new',
          description: `${formData.post_type} (install & pickup)`,
          quantity: 1,
          unit_price: PRICING.posts[formData.post_type],
          total_price: PRICING.posts[formData.post_type],
        })

        // Wood Panel Post add-ons
        if (formData.post_type === 'Wood Panel Post' && formData.wood_panel_sign_build) {
          items.push({
            item_type: 'post',
            item_category: 'new',
            description: 'Wood Panel: sign build',
            quantity: 1,
            unit_price: PRICING.wood_panel_sign_build,
            total_price: PRICING.wood_panel_sign_build,
          })
          if (formData.wood_panel_materials) {
            items.push({
              item_type: 'post',
              item_category: 'new',
              description: 'Wood Panel: materials (4x4 posts, screws, washers)',
              quantity: 1,
              unit_price: PRICING.wood_panel_materials,
              total_price: PRICING.wood_panel_materials,
            })
          }
        }
      }

      // Sign
      if (formData.sign_option === 'stored') {
        const storedSign = inventory?.signs.find(s => s.id === formData.stored_sign_id)
        items.push({
          item_type: 'sign',
          item_category: 'storage',
          description: storedSign ? `Sign Install: ${storedSign.description} (from storage)` : 'Sign Install (from storage)',
          quantity: 1,
          unit_price: PRICING.sign_install,
          total_price: PRICING.sign_install,
          customer_sign_id: formData.stored_sign_id,
        })
      } else if (formData.sign_option === 'at_property') {
        items.push({
          item_type: 'sign',
          item_category: 'owned',
          description: 'Sign Install',
          quantity: 1,
          unit_price: PRICING.sign_install,
          total_price: PRICING.sign_install,
        })
      }

      // Riders
      formData.riders.forEach((rider) => {
        const source = rider.source ?? (rider.is_rental ? 'rental' : 'owned')
        const price = source === 'rental' ? PRICING.rider_rental : PRICING.rider_install
        // Custom free-text riders (pickup/at-property) flow the agent's typed
        // name through to the order item description as "Custom: <name>".
        const isCustomText = rider.rider_type.startsWith('custom-text-')
        const name = isCustomText
          ? `Custom: ${rider.custom_value || 'rider'}`
          : rider.custom_value
            ? `${rider.custom_value} Acres`
            : rider.rider_type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        const description = source === 'rental'
          ? `Rider Rental: ${name}`
          : source === 'at_property'
            ? `Rider Install: ${name} (pickup)`
            : `Rider Install: ${name} (from storage)`
        const itemCategory: 'rental' | 'owned' | 'storage' = source === 'rental'
          ? 'rental'
          : source === 'at_property'
            ? 'owned'
            : 'storage'

        items.push({
          item_type: 'rider',
          item_category: itemCategory,
          description,
          quantity: 1,
          unit_price: price,
          total_price: price,
          customer_rider_id: rider.customer_rider_id,
          custom_value: rider.custom_value,
        })
      })

      // Lockbox — description carries the selected stored unit's serial+code so
      // installers, admins, and emails all reference the same physical box
      const lbSuffix = lockboxIdentifierSuffix()
      if (formData.lockbox_option === 'sentrilock') {
        items.push({
          item_type: 'lockbox',
          item_category: 'owned',
          description: `Sentrilock/Supra Install${lbSuffix}`,
          quantity: 1,
          unit_price: lockboxInstall,
          total_price: lockboxInstall,
          customer_lockbox_id: formData.customer_lockbox_id,
          custom_value: formData.lockbox_code || undefined,
        })
      } else if (formData.lockbox_option === 'mechanical_own') {
        items.push({
          item_type: 'lockbox',
          item_category: 'owned',
          description: `Mechanical Lockbox Install${lbSuffix}`,
          quantity: 1,
          unit_price: lockboxInstall,
          total_price: lockboxInstall,
          customer_lockbox_id: formData.customer_lockbox_id,
          custom_value: formData.lockbox_code || undefined,
        })
      } else if (formData.lockbox_option === 'at_property') {
        // Prefer the stored-unit suffix (Serial+Code) when a lockbox was picked;
        // otherwise fall back to the free-text code the agent typed in
        const fallback = formData.lockbox_code ? ` — code ${formData.lockbox_code}` : ''
        items.push({
          item_type: 'lockbox',
          item_category: 'owned',
          description: `Lockbox Install (at property / pickup)${lbSuffix || fallback}`,
          quantity: 1,
          unit_price: lockboxInstall,
          total_price: lockboxInstall,
          // Persist the code so it round-trips when the order is edited
          custom_value: formData.lockbox_code || undefined,
        })
      } else if (formData.lockbox_option === 'mechanical_rent') {
        const fallback = formData.lockbox_code ? ` — code ${formData.lockbox_code}` : ''
        items.push({
          item_type: 'lockbox',
          item_category: 'rental',
          description: `Mechanical Lockbox Rental${lbSuffix || fallback}`,
          quantity: 1,
          unit_price: PRICING.lockbox_rental,
          total_price: PRICING.lockbox_rental,
          custom_value: formData.lockbox_code || undefined,
        })
      }

      // Wire Frame Signs
      if (formData.wire_frame_quantity > 0) {
        items.push({
          item_type: 'wire_frame_sign',
          item_category: 'install',
          description: `Wire Frame Sign Install \u00d7 ${formData.wire_frame_quantity}${formData.wire_frame_notes ? ` \u2014 ${formData.wire_frame_notes}` : ''}`,
          quantity: formData.wire_frame_quantity,
          unit_price: PRICING.wire_frame_sign,
          total_price: formData.wire_frame_quantity * PRICING.wire_frame_sign,
        })
      }

      // Solar Lighting
      if (formData.solar_lighting_quantity > 0) {
        items.push({
          item_type: 'solar_lighting',
          item_category: 'install',
          description: `Solar Lighting \u00d7 ${formData.solar_lighting_quantity}`,
          quantity: formData.solar_lighting_quantity,
          unit_price: PRICING.solar_lighting,
          total_price: formData.solar_lighting_quantity * PRICING.solar_lighting,
        })
      }

      // Second Post + add-ons
      if (formData.second_post_enabled) {
        items.push({
          item_type: 'second_post',
          item_category: 'second',
          description: `Second Post${formData.second_post_install_location ? ` \u2014 ${formData.second_post_install_location}` : ''}`,
          quantity: 1,
          unit_price: PRICING.second_post,
          total_price: PRICING.second_post,
        })

        if (formData.second_post_sign_option === 'stored') {
          const storedSign2 = inventory?.signs.find(s => s.id === formData.second_post_stored_sign_id)
          items.push({
            item_type: 'sign',
            item_category: 'storage',
            description: storedSign2 ? `Second Post Sign Install: ${storedSign2.description} (from storage)` : 'Second Post Sign Install (from storage)',
            quantity: 1,
            unit_price: PRICING.sign_install,
            total_price: PRICING.sign_install,
            customer_sign_id: formData.second_post_stored_sign_id,
          })
        } else if (formData.second_post_sign_option === 'at_property') {
          items.push({
            item_type: 'sign',
            item_category: 'install',
            description: 'Second Post Sign Install (at property)',
            quantity: 1,
            unit_price: PRICING.sign_install,
            total_price: PRICING.sign_install,
          })
        }

        for (const rider of formData.second_post_riders) {
          const source = rider.source ?? (rider.is_rental ? 'rental' : 'owned')
          const price = source === 'rental' ? PRICING.rider_rental : PRICING.rider_install
          const suffix = source === 'rental' ? '' : source === 'at_property' ? ' (pickup)' : ' (from storage)'
          // Custom free-text riders render with their typed name instead of
          // the synthetic "custom-text-..." slug.
          const isCustomText = rider.rider_type.startsWith('custom-text-')
          const displayName = isCustomText
            ? `Custom: ${rider.custom_value || 'rider'}`
            : `${rider.rider_type}${rider.custom_value ? ` (${rider.custom_value})` : ''}`
          items.push({
            item_type: 'rider',
            item_category: source === 'rental' ? 'rental' : 'owned',
            description: `Second Post Rider: ${displayName}${suffix}`,
            quantity: 1,
            unit_price: price,
            total_price: price,
            custom_value: rider.custom_value,
          })
        }

        if (formData.second_post_wire_frame_quantity > 0) {
          items.push({
            item_type: 'wire_frame_sign',
            item_category: 'install',
            description: `Second Post Wire Frame Signs \u00d7 ${formData.second_post_wire_frame_quantity}`,
            quantity: formData.second_post_wire_frame_quantity,
            unit_price: PRICING.wire_frame_sign,
            total_price: formData.second_post_wire_frame_quantity * PRICING.wire_frame_sign,
          })
        }

        if (formData.second_post_solar_lighting_quantity > 0) {
          items.push({
            item_type: 'solar_lighting',
            item_category: 'install',
            description: `Second Post Solar Lighting \u00d7 ${formData.second_post_solar_lighting_quantity}`,
            quantity: formData.second_post_solar_lighting_quantity,
            unit_price: PRICING.solar_lighting,
            total_price: formData.second_post_solar_lighting_quantity * PRICING.solar_lighting,
          })
        }
      }

      // Brochure box
      if (formData.brochure_option === 'purchase') {
        items.push({
          item_type: 'brochure_box',
          item_category: 'purchase',
          description: 'Brochure Box Purchase (includes install)',
          quantity: 1,
          unit_price: PRICING.brochure_box_purchase,
          total_price: PRICING.brochure_box_purchase,
        })
      } else if (formData.brochure_option === 'own') {
        items.push({
          item_type: 'brochure_box',
          item_category: 'install',
          description: 'Brochure Box Install (your own)',
          quantity: 1,
          unit_price: PRICING.brochure_box_install,
          total_price: PRICING.brochure_box_install,
        })
      }

    return items
  }

  // Edit mode: PATCH the full order payload to the edit endpoint. The server
  // rebuilds the order (items, post, pricing, inventory) but does NOT re-charge
  // — fuel/delivery fees and the existing payment are preserved.
  const handleSaveEdit = async () => {
    if (orderItems.length === 0) {
      setError('Please keep at least one item on the order')
      return
    }
    setIsSubmitting?.(true)
    setError(null)
    try {
      const items = buildItems()

      const response = await fetch(`/api/orders/${orderId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          // undefined post_type means "no post" — send explicit 'none' so the
          // server applies the no-post service trip fee
          post_type: formData.post_type ?? 'none',
          property_type: formData.property_type,
          property_address: formData.property_address,
          property_city: formData.property_city,
          property_state: formData.property_state,
          property_zip: formData.property_zip,
          installation_location: formData.installation_location,
          installation_location_image: formData.installation_location_image,
          installation_notes: formData.installation_notes,
          is_gated_community: formData.is_gated_community,
          gate_code: formData.gate_code,
          has_marker_placed: formData.has_marker_placed,
          sign_orientation: formData.sign_orientation,
          sign_orientation_other: formData.sign_orientation_other,
          requested_date: formData.requested_date,
          is_expedited: formData.schedule_type === 'expedited',
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save changes')
      }
      router.push(`/dashboard/orders/${orderId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting?.(false)
    }
  }

  const handleSubmit = async () => {
    // Ensure at least one item is in the order
    if (orderItems.length === 0) {
      setError('Please select at least one item for your order')
      return
    }

    // Check for payment method
    const selectedPaymentMethodId = formData.payment_method_id || defaultPaymentMethod?.id
    if (!selectedPaymentMethodId) {
      setError('Please add a payment method before placing your order')
      return
    }

    setIsSubmitting?.(true)
    setError(null)

    try {
      const items = buildItems()

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_type: formData.property_type,
          property_address: formData.property_address,
          property_city: formData.property_city,
          property_state: formData.property_state,
          property_zip: formData.property_zip,
          installation_location: formData.installation_location,
          installation_location_image: formData.installation_location_image,
          installation_notes: formData.installation_notes,
          // Installation details
          is_gated_community: formData.is_gated_community,
          gate_code: formData.gate_code,
          has_marker_placed: formData.has_marker_placed,
          sign_orientation: formData.sign_orientation,
          sign_orientation_other: formData.sign_orientation_other,
          post_type: formData.post_type,
          items,
          requested_date: formData.requested_date,
          is_expedited: formData.schedule_type === 'expedited',
          payment_method_id: formData.payment_method_id || defaultPaymentMethod?.id,
          save_payment_method: formData.save_payment_method,
          promo_code: formData.promo_code,
          promo_code_id: formData.promo_code_id,
          fuel_surcharge_waived: fuelSurchargeWaived,
          // When admin/team_admin places on behalf of an agent the API needs
          // the agent's user id so the order is owned by them
          on_behalf_of_user_id: onBehalfOf,
          // Free-text agent attribution (team_admin accounts use this to label
          // which agent on their team sold the property)
          placed_for_agent_name: formData.placed_for_agent_name?.trim() || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create order')
      }

      // If the bank required 3D Secure, Stripe parks the PaymentIntent in
      // 'requires_action' until the customer completes the challenge. Trigger
      // the bank's verification popup here so the order doesn't get stuck.
      if (
        data.paymentStatus === 'requires_action' &&
        data.clientSecret
      ) {
        const stripe = await getStripe()
        if (!stripe) {
          throw new Error('Could not load payment service. Please try again.')
        }
        const { paymentIntent, error: stripeError } = await stripe.handleNextAction({
          clientSecret: data.clientSecret,
        })

        if (stripeError) {
          // Bank or browser threw an error (popup blocked, card declined during
          // 3DS, etc.) — stay on review step so the customer can pick a different
          // card and retry without re-entering the whole order
          throw new Error(stripeError.message || 'Payment verification failed. Please try again.')
        }

        if (paymentIntent?.status === 'requires_action' || paymentIntent?.status === 'requires_payment_method') {
          // Customer closed the popup, the bank timed out, or 3DS failed — but
          // the order already exists. Send them to the order detail page where
          // the Complete Payment / failed-payment banner takes over so they
          // never see a dead end here.
          router.push(`/dashboard/orders/${data.order.id}`)
          return
        }
        // status is succeeded or processing — fall through to the confirmation page
      }

      // Redirect to confirmation page
      router.push(`/dashboard/order-confirmation?order=${data.order.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting?.(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {isEdit ? 'Review Changes' : 'Review & Pay'}
        </h2>
        <p className="text-gray-600">
          {isEdit
            ? `Review your updated order${editMeta ? ` ${editMeta.orderNumber}` : ''} and save your changes.`
            : 'Review your order details and complete payment.'}
        </p>
      </div>

      {/* Order Summary */}
      <div className="bg-gray-50 rounded-xl p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Order Summary</h3>

        {/* Property */}
        <div className="mb-4 pb-4 border-b border-gray-200">
          <p className="text-sm text-gray-600">Property</p>
          <p className="font-medium text-gray-900">
            {formData.property_address}, {formData.property_city}, {formData.property_state} {formData.property_zip}
          </p>
          <p className="text-sm text-gray-500 capitalize">{formData.property_type?.replace('_', ' ')}</p>
        </div>

        {/* Schedule */}
        <div className="mb-4 pb-4 border-b border-gray-200">
          <p className="text-sm text-gray-600">Requested Date</p>
          <p className="font-medium text-gray-900">
            {formData.schedule_type === 'next_available' && 'Next Available'}
            {formData.schedule_type === 'expedited' && 'Same Day (Expedited)'}
            {formData.schedule_type === 'specific_date' && formData.requested_date}
          </p>
        </div>

        {/* Line Items */}
        <div className="space-y-2">
          {orderItems.map((item, index) => (
            <div key={index} className="flex justify-between text-sm">
              <span className="text-gray-600">{item.description}</span>
              <span className="font-medium text-gray-900">${item.price.toFixed(2)}</span>
            </div>
          ))}
        </div>

        {/* Promo Code — hidden while editing (the server keeps the order's
            existing promo and recomputes the discount; promo can't be changed
            during an edit) */}
        {!isEdit && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Promo Code</span>
          </div>
          {formData.promo_code_id ? (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-sm text-green-800">
                  <strong>{formData.promo_code}</strong> - You save ${discount.toFixed(2)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRemovePromoCode}
                className="text-sm text-green-700 hover:text-green-900 underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Enter promo code"
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleApplyPromoCode}
                disabled={applyingPromo || !promoCodeInput.trim()}
              >
                {applyingPromo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Apply'
                )}
              </Button>
            </div>
          )}
          {promoCodeError && (
            <p className="mt-2 text-sm text-red-600">{promoCodeError}</p>
          )}
        </div>
        )}

        {/* Totals */}
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="text-gray-900">${subtotal.toFixed(2)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Discount ({formData.promo_code})</span>
              <span>-${discount.toFixed(2)}</span>
            </div>
          )}
          {noPostSurcharge > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Service Trip Fee (no post)</span>
              <span className="text-gray-900">${noPostSurcharge.toFixed(2)}</span>
            </div>
          )}
          {serviceAreaSurcharge > 0 && serviceAreaQuote?.tier === 'surcharge' && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">
                Out-of-area service fee
                {serviceAreaQuote.centerName && serviceAreaQuote.driveTimeMinutes != null
                  ? ` — ${serviceAreaQuote.centerName} (~${serviceAreaQuote.driveTimeMinutes} min)`
                  : ''}
              </span>
              <span className="text-gray-900">${serviceAreaSurcharge.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Fuel Surcharge</span>
            <span className={cn("text-gray-900", fuelSurchargeWaived && "line-through text-gray-400")}>
              ${PRICING.fuel_surcharge.toFixed(2)}
            </span>
            {fuelSurchargeWaived && <span className="text-green-600 text-xs ml-1">Waived</span>}
          </div>
          {expediteFee > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Expedite Fee</span>
              <span className="text-gray-900">${expediteFee.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">
              Sales Tax ({taxRate})
              {loadingTax && <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />}
            </span>
            <span className="text-gray-900">${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold pt-2 border-t border-gray-200">
            <span className="text-gray-900">{isEdit ? 'New Total' : 'Total'}</span>
            <span className="text-pink-600">${total.toFixed(2)}</span>
          </div>
          {isEdit && editMeta && Math.abs(total - editMeta.originalTotal) >= 0.01 && (
            <div className={cn(
              'flex justify-between text-sm font-medium pt-1',
              total > editMeta.originalTotal ? 'text-amber-600' : 'text-green-600'
            )}>
              <span>{total > editMeta.originalTotal ? 'Additional charge vs. original' : 'Reduced vs. original'}</span>
              <span>
                {total > editMeta.originalTotal ? '+' : '-'}${Math.abs(total - editMeta.originalTotal).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Payment Method — hidden while editing (no re-charge on edit) and
          hidden for cart accounts (team_admin / on-behalf-of), which select the
          card on the cart checkout screen for the single combined charge. */}
      {!isEdit && !cartEnabled && (
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Payment Method
          </h3>
          {activePaymentMethods && activePaymentMethods.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAddCard(true)}
              className="text-pink-600 hover:text-pink-700"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Card
            </Button>
          )}
        </div>

        {activePaymentMethods && activePaymentMethods.length > 0 ? (
          <div className="space-y-3">
            {activePaymentMethods.map((pm) => (
              <button
                key={pm.id}
                type="button"
                onClick={() => updateFormData({ payment_method_id: pm.id })}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all',
                  (formData.payment_method_id || defaultPaymentMethod?.id) === pm.id
                    ? 'border-pink-500 bg-pink-50'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700 uppercase">
                    {pm.card_brand}••••
                  </span>
                  <span className="text-gray-900">{pm.card_last4}</span>
                  {pm.is_default && (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Default</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-700 font-medium mb-1">No payment method on file</p>
            <p className="text-sm text-gray-500 mb-4">Add a card to complete your order</p>
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowAddCard(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Payment Method
            </Button>
          </div>
        )}

        {activePaymentMethods && activePaymentMethods.length > 0 && (
          <label className="flex items-center gap-2 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.save_payment_method}
              onChange={(e) => updateFormData({ save_payment_method: e.target.checked })}
              className="w-4 h-4 text-pink-500 border-gray-300 rounded focus:ring-pink-500"
            />
            <span className="text-sm text-gray-600">Save card for future orders</span>
          </label>
        )}
      </div>
      )}

      {/* Edit mode: explain payment handling in place of the payment selector */}
      {isEdit && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-blue-600 mt-0.5" />
          <p className="text-sm text-blue-800">
            Saving updates this order&apos;s details and totals. We do not automatically
            re-charge your card for edits — the Pink Posts team will reconcile any
            balance change with you directly.
          </p>
        </div>
      )}

      {/* Disclosure & Terms */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 space-y-3">
        <div className="flex items-start gap-3">
          <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-gray-400" />
          <p>
            {fuelSurchargeWaived
              ? 'Fuel surcharge has been waived with your promo code.'
              : `A fuel surcharge of $${PRICING.fuel_surcharge.toFixed(2)} is applied to all orders.`
            }
            {' '}Your payment information is securely processed via Stripe.
          </p>
        </div>
        <div className="border-t border-gray-200 pt-3">
          <p className="font-medium text-gray-700 mb-2">Important Disclosures:</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Rental items (posts, riders, lockboxes) remain property of Pink Posts Installations</li>
            <li>Lost, damaged, or unreturned rental items are subject to replacement fees</li>
            <li>Replacement fees will be charged to your payment method on file</li>
          </ul>
        </div>
      </div>

      {/* Out-of-area pre-empt — mirrors server 400 so customer isn't stranded at submit */}
      {serviceAreaQuote?.tier === 'out_of_area' && (
        <div className="flex items-start gap-2 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>
            We don&apos;t currently service ZIP {formData.property_zip}. Please call{' '}
            <a href={`tel:${serviceAreaQuote.contactPhone ?? '859-395-8188'}`} className="font-medium underline">
              {serviceAreaQuote.contactPhone ?? '859-395-8188'}
            </a>{' '}
            to discuss options.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Submit Buttons — edit mode saves in place; cart mode (team_admin or
          on-behalf-of) shows batching; everyone else places + pays now */}
      {isEdit ? (
        <Button
          size="lg"
          className="w-full"
          onClick={handleSaveEdit}
          disabled={isSubmitting || serviceAreaQuote?.tier === 'out_of_area'}
        >
          {isSubmitting ? 'Saving…' : 'Save Changes'}
        </Button>
      ) : cartEnabled ? (
        <div className="space-y-3">
          <Button
            size="lg"
            className="w-full"
            onClick={handleAddToCart}
            disabled={isSubmitting || addingToCart || serviceAreaQuote?.tier === 'out_of_area'}
          >
            {addingToCart
              ? (editingCartItemId ? 'Saving…' : 'Adding…')
              : editingCartItemId
                ? `Update cart item — $${total.toFixed(2)}`
                : `Add to Cart — $${total.toFixed(2)}`}
          </Button>
          <p className="text-xs text-center text-gray-500">
            {editingCartItemId
              ? 'Saves your changes back to the cart — your reserved inventory is adjusted to match.'
              : 'Build a batch of orders, then check out all at once — a single combined charge is collected on the cart screen.'}
          </p>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full"
          onClick={handleSubmit}
          disabled={isSubmitting || (!activePaymentMethods?.length && !formData.payment_method_id) || serviceAreaQuote?.tier === 'out_of_area'}
        >
          {isSubmitting ? 'Processing...' : `Place Order — $${total.toFixed(2)}`}
        </Button>
      )}

      {/* Add Card Modal */}
      <AddCardModal
        isOpen={showAddCard}
        onClose={() => setShowAddCard(false)}
        onSuccess={handleCardAdded}
      />
    </div>
  )
}
