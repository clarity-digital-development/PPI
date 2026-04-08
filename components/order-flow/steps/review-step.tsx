'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Lock, AlertCircle, Tag, CheckCircle, Loader2, Plus } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { AddCardModal } from '@/components/billing'
import { cn } from '@/lib/utils'
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
}: StepProps) {
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

  // Calculate order items and totals
  const orderItems: Array<{ description: string; price: number; excludeFromDiscount?: boolean }> = []

  // Post
  if (formData.post_type && formData.post_type !== 'open_house') {
    orderItems.push({
      description: `${formData.post_type} (install & pickup)`,
      price: PRICING.posts[formData.post_type],
    })
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
    const price = rider.is_rental ? PRICING.rider_rental : PRICING.rider_install
    const name = rider.custom_value ? `${rider.custom_value} Acres` : rider.rider_type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    const description = rider.is_rental
      ? `Rider Rental: ${name}`
      : `Rider Install: ${name} (from storage)`
    orderItems.push({
      description,
      price,
    })
  })

  // Lockbox
  if (formData.lockbox_option === 'sentrilock' || formData.lockbox_option === 'mechanical_own') {
    orderItems.push({
      description: `${formData.lockbox_option === 'sentrilock' ? 'SentriLock' : 'Mechanical Lockbox'} Install`,
      price: PRICING.lockbox_install,
    })
  } else if (formData.lockbox_option === 'mechanical_rent') {
    orderItems.push({
      description: 'Mechanical Lockbox Rental',
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

  const subtotal = orderItems.reduce((sum, item) => sum + item.price, 0)
  // Discountable subtotal excludes items like brochure box purchases
  const discountableSubtotal = orderItems.filter(item => !item.excludeFromDiscount).reduce((sum, item) => sum + item.price, 0)
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
    }
    if (formData.sign_option === 'stored' || formData.sign_option === 'at_property') {
      items.push({ item_type: 'sign', total_price: PRICING.sign_install })
    }
    formData.riders.forEach((rider) => {
      const price = rider.is_rental ? PRICING.rider_rental : PRICING.rider_install
      items.push({ item_type: 'rider', total_price: price })
    })
    if (formData.lockbox_option === 'sentrilock' || formData.lockbox_option === 'mechanical_own') {
      items.push({ item_type: 'lockbox', total_price: PRICING.lockbox_install })
    } else if (formData.lockbox_option === 'mechanical_rent') {
      items.push({ item_type: 'lockbox', total_price: PRICING.lockbox_rental })
    }
    if (formData.wire_frame_quantity > 0) {
      items.push({ item_type: 'wire_frame_sign', total_price: formData.wire_frame_quantity * PRICING.wire_frame_sign })
    }
    if (formData.brochure_option === 'purchase') {
      items.push({ item_type: 'brochure_box', total_price: PRICING.brochure_box_purchase })
    } else if (formData.brochure_option === 'own') {
      items.push({ item_type: 'brochure_box', total_price: PRICING.brochure_box_install })
    }

    return items
  }, [formData.post_type, formData.sign_option, formData.riders, formData.lockbox_option, formData.wire_frame_quantity, formData.brochure_option])

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
      // Build properly typed order items
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
        const price = rider.is_rental ? PRICING.rider_rental : PRICING.rider_install
        const name = rider.custom_value
          ? `${rider.custom_value} Acres`
          : rider.rider_type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        const description = rider.is_rental
          ? `Rider Rental: ${name}`
          : `Rider Install: ${name} (from storage)`

        items.push({
          item_type: 'rider',
          item_category: rider.is_rental ? 'rental' : 'storage',
          description,
          quantity: 1,
          unit_price: price,
          total_price: price,
          customer_rider_id: rider.customer_rider_id,
          custom_value: rider.custom_value,
        })
      })

      // Lockbox
      if (formData.lockbox_option === 'sentrilock') {
        items.push({
          item_type: 'lockbox',
          item_category: 'owned',
          description: 'SentriLock Install',
          quantity: 1,
          unit_price: PRICING.lockbox_install,
          total_price: PRICING.lockbox_install,
          customer_lockbox_id: formData.customer_lockbox_id,
        })
      } else if (formData.lockbox_option === 'mechanical_own') {
        items.push({
          item_type: 'lockbox',
          item_category: 'owned',
          description: 'Mechanical Lockbox Install',
          quantity: 1,
          unit_price: PRICING.lockbox_install,
          total_price: PRICING.lockbox_install,
          customer_lockbox_id: formData.customer_lockbox_id,
        })
      } else if (formData.lockbox_option === 'mechanical_rent') {
        items.push({
          item_type: 'lockbox',
          item_category: 'rental',
          description: 'Mechanical Lockbox Rental',
          quantity: 1,
          unit_price: PRICING.lockbox_rental,
          total_price: PRICING.lockbox_rental,
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
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create order')
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
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Review & Pay</h2>
        <p className="text-gray-600">Review your order details and complete payment.</p>
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

        {/* Promo Code */}
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
            <span className="text-gray-900">Total</span>
            <span className="text-pink-600">${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Payment Method */}
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

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Submit Button */}
      <Button
        size="lg"
        className="w-full"
        onClick={handleSubmit}
        disabled={isSubmitting || (!activePaymentMethods?.length && !formData.payment_method_id)}
      >
        {isSubmitting ? 'Processing...' : `Place Order — $${total.toFixed(2)}`}
      </Button>

      {/* Add Card Modal */}
      <AddCardModal
        isOpen={showAddCard}
        onClose={() => setShowAddCard(false)}
        onSuccess={handleCardAdded}
      />
    </div>
  )
}
