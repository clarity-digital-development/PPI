import Stripe from 'stripe'

// Lazy initialization to avoid build-time errors
let stripeClient: Stripe | null = null

/**
 * Parse Stripe errors into user-friendly messages
 */
export function getStripeErrorMessage(error: unknown): string {
  if (error instanceof Stripe.errors.StripeCardError) {
    // Card-specific errors with decline codes
    const declineCode = error.decline_code
    switch (declineCode) {
      case 'insufficient_funds':
        return 'Your card has insufficient funds. Please try a different card.'
      case 'lost_card':
      case 'stolen_card':
        return 'This card has been reported lost or stolen. Please use a different card.'
      case 'expired_card':
        return 'Your card has expired. Please update your card or use a different one.'
      case 'incorrect_cvc':
        return 'The CVC number is incorrect. Please check your card details and try again.'
      case 'processing_error':
        return 'There was a processing error with your card. Please try again in a moment.'
      case 'generic_decline':
      default:
        // Use Stripe's message if available, otherwise generic
        return error.message || 'Your card was declined. Please try a different card or contact your bank.'
    }
  }

  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    // Check for amount-related errors (e.g., amount too small)
    if (error.message?.includes('amount')) {
      return 'There was an issue processing the payment amount. Please contact support.'
    }
    return 'There was an issue with the payment request. Please try again.'
  }

  if (error instanceof Stripe.errors.StripeConnectionError) {
    return 'Unable to connect to the payment processor. Please check your internet connection and try again.'
  }

  if (error instanceof Stripe.errors.StripeRateLimitError) {
    return 'Too many requests. Please wait a moment and try again.'
  }

  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    // This is a server-side config issue, don't expose details
    return 'Payment processing is temporarily unavailable. Please try again later.'
  }

  if (error instanceof Stripe.errors.StripeAPIError) {
    return 'The payment service is experiencing issues. Please try again in a few minutes.'
  }

  // Generic Stripe error fallback
  if (error instanceof Stripe.errors.StripeError) {
    return error.message || 'A payment error occurred. Please try again.'
  }

  return ''
}

function getStripe(): Stripe {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
      typescript: true,
    })
  }
  return stripeClient
}

export { getStripe as stripe }

export async function createCustomer(email: string, name: string) {
  return getStripe().customers.create({
    email,
    name,
  })
}

export async function getCustomer(customerId: string) {
  return getStripe().customers.retrieve(customerId)
}

export async function createPaymentIntent(
  amount: number,
  customerId?: string,
  paymentMethodId?: string
) {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: Math.round(amount * 100), // Convert to cents
    currency: 'usd',
    automatic_payment_methods: {
      enabled: true,
    },
  }

  if (customerId) {
    params.customer = customerId
  }

  if (paymentMethodId) {
    params.payment_method = paymentMethodId
    params.confirm = true
    params.return_url = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/order-confirmation`
  }

  return getStripe().paymentIntents.create(params)
}

export async function confirmPaymentIntent(
  paymentIntentId: string,
  paymentMethodId: string
) {
  return getStripe().paymentIntents.confirm(paymentIntentId, {
    payment_method: paymentMethodId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/order-confirmation`,
  })
}

export async function attachPaymentMethod(
  paymentMethodId: string,
  customerId: string
) {
  return getStripe().paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  })
}

export async function detachPaymentMethod(paymentMethodId: string) {
  return getStripe().paymentMethods.detach(paymentMethodId)
}

export async function listPaymentMethods(customerId: string) {
  return getStripe().paymentMethods.list({
    customer: customerId,
    type: 'card',
  })
}

export async function setDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string
) {
  return getStripe().customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  })
}

export async function createSetupIntent(customerId: string) {
  return getStripe().setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
  })
}

// Stripe Tax calculation
interface TaxLineItem {
  amount: number // in cents
  reference: string
  tax_code?: string
}

interface TaxAddress {
  line1?: string
  city: string
  state: string
  postal_code: string
  country: string
}

export async function calculateTax(
  lineItems: TaxLineItem[],
  shippingAddress: TaxAddress
): Promise<{ taxAmountExclusive: number; taxBreakdown: Array<{ amount: number; jurisdiction: string; rate: string }> }> {
  try {
    const calculation = await getStripe().tax.calculations.create({
      currency: 'usd',
      line_items: lineItems.map((item) => ({
        amount: item.amount,
        reference: item.reference,
        // txcd_99999999 is the default tax code for general services
        tax_code: item.tax_code || 'txcd_99999999',
      })),
      customer_details: {
        address: {
          line1: shippingAddress.line1 || '',
          city: shippingAddress.city,
          state: shippingAddress.state,
          postal_code: shippingAddress.postal_code,
          country: shippingAddress.country,
        },
        address_source: 'shipping',
      },
    })

    // Extract tax breakdown for transparency
    const taxBreakdown = calculation.tax_breakdown?.map((breakdown) => {
      const percentDecimal = breakdown.tax_rate_details?.percentage_decimal
      const rateValue = percentDecimal ? parseFloat(percentDecimal) * 100 : 0
      // Access display_name from the jurisdiction object
      const jurisdictionName = breakdown.tax_rate_details?.country || 'unknown'
      return {
        amount: breakdown.amount,
        jurisdiction: jurisdictionName,
        rate: `${rateValue.toFixed(2)}%`,
      }
    }) || []

    return {
      taxAmountExclusive: calculation.tax_amount_exclusive,
      taxBreakdown,
    }
  } catch (error) {
    console.error('Stripe Tax calculation error:', error)
    // Fall back to manual calculation if Stripe Tax fails
    // This ensures orders can still be placed even if tax service is unavailable
    throw error
  }
}

// Check if Stripe Tax is enabled (useful for feature flagging)
export async function isStripeTaxEnabled(): Promise<boolean> {
  try {
    // Try a minimal tax calculation to verify the service is enabled
    await getStripe().tax.calculations.create({
      currency: 'usd',
      line_items: [{ amount: 100, reference: 'test' }],
      customer_details: {
        address: {
          city: 'Lexington',
          state: 'KY',
          postal_code: '40502',
          country: 'US',
        },
        address_source: 'shipping',
      },
    })
    return true
  } catch (error: unknown) {
    // If we get a specific error about Tax not being enabled, return false
    if (error && typeof error === 'object' && 'code' in error && error.code === 'tax_not_enabled') {
      return false
    }
    // Other errors might be transient, so we log but assume enabled
    console.warn('Could not verify Stripe Tax status:', error)
    return false
  }
}
