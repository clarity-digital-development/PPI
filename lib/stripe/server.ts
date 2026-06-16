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
  paymentMethodId?: string,
  opts?: {
    /**
     * 'automatic' (default) captures the charge as soon as the PI is
     * confirmed. 'manual' authorizes only — caller MUST call capture()
     * after the order tx commits, or cancel() on rollback. Use 'manual'
     * any time the route does work between PI create and "we know the
     * order is safe to charge for."
     */
    captureMethod?: 'automatic' | 'manual'
    /**
     * Stripe-side idempotency key. Two requests with the same key within
     * 24h get the SAME PaymentIntent — protects against double-click /
     * retry from creating two PIs (and thus two charges).
     */
    idempotencyKey?: string
    /**
     * Free-form metadata attached to the PI — surfaces in the Stripe dashboard
     * AND in webhook payloads. Used to route the webhook (orders vs invoices).
     */
    metadata?: Record<string, string>
  }
) {
  const params: Stripe.PaymentIntentCreateParams = {
    amount: Math.round(amount * 100), // Convert to cents
    currency: 'usd',
    automatic_payment_methods: {
      enabled: true,
    },
  }
  if (opts?.captureMethod) {
    params.capture_method = opts.captureMethod
  }
  if (opts?.metadata) {
    params.metadata = opts.metadata
  }

  if (customerId) {
    params.customer = customerId
  }

  if (paymentMethodId) {
    params.payment_method = paymentMethodId
    params.confirm = true
    params.return_url = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/order-confirmation`
  }

  // CRITICAL: do NOT pass an empty options object as the 2nd arg — the
  // Stripe Node SDK rejects it with "Unknown arguments ([object Object])".
  // This was a P0 outage (regular-customer single-order POST broke for
  // every customer for ~18h after round-5 shipped) because the batch route
  // always passes an idempotencyKey (object non-empty, fine) while the
  // single-order /api/orders POST passes no opts (object empty, throws).
  if (opts?.idempotencyKey) {
    return getStripe().paymentIntents.create(params, { idempotencyKey: opts.idempotencyKey })
  }
  return getStripe().paymentIntents.create(params)
}

export async function capturePaymentIntent(paymentIntentId: string) {
  return getStripe().paymentIntents.capture(paymentIntentId)
}

export interface CreateRefundParams {
  paymentIntentId: string
  /** Used to mint a deterministic idempotency key — same order can never double-refund. */
  orderId: string
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent'
  metadata?: Record<string, string>
}

export interface CreateRefundResult {
  refundId: string
  /** Cents. */
  amount: number
  status: string
  raw: Stripe.Refund
}

/**
 * Create a FULL refund for a PaymentIntent.
 *
 * Idempotency: SHA-256 of `${orderId}:refund_v1` is sent as Stripe's
 * idempotency key, so a retry/replay returns the same Refund object
 * instead of creating a second refund. The `_v1` suffix gives us room
 * to invalidate if we ever need to retry-with-different-params.
 *
 * Does NOT mutate any DB state. Caller persists refundId.
 */
export async function refundPaymentIntent(
  params: CreateRefundParams
): Promise<CreateRefundResult> {
  const cryptoMod = await import('node:crypto')
  const idempotencyKey = cryptoMod
    .createHash('sha256')
    .update(`${params.orderId}:refund_v1`)
    .digest('hex')

  const refund = await getStripe().refunds.create(
    {
      payment_intent: params.paymentIntentId,
      reason: params.reason ?? 'requested_by_customer',
      metadata: {
        order_id: params.orderId,
        ...(params.metadata ?? {}),
      },
    },
    { idempotencyKey }
  )

  return {
    refundId: refund.id,
    amount: refund.amount,
    status: refund.status ?? 'pending',
    raw: refund,
  }
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

/**
 * Create a Stripe Checkout Session for an invoice. The returned URL is the
 * Stripe-hosted payment page customers click from their invoice email —
 * keeps them off pinkposts.com entirely. Metadata propagates to the underlying
 * PaymentIntent so the existing payment_intent.succeeded webhook routes back
 * to /api/webhooks/stripe → invoice-paid branch correctly.
 *
 * Sessions expire after 30 days (Stripe maximum). For unpaid invoices older
 * than that, the bundler can regenerate.
 */
export async function createInvoiceCheckoutSession(opts: {
  invoiceId: string
  invoiceNumber: string
  amountInCents: number
  customerEmail: string
  successUrl: string
  cancelUrl: string
  description?: string
}) {
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 // 30 days
  return getStripe().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Pink Posts Invoice ${opts.invoiceNumber}`,
              description: opts.description ?? `Bundled invoice payment`,
            },
            unit_amount: opts.amountInCents,
          },
          quantity: 1,
        },
      ],
      // Metadata on the PI so the existing webhook keeps working.
      payment_intent_data: {
        metadata: {
          invoiceId: opts.invoiceId,
          invoiceNumber: opts.invoiceNumber,
          kind: 'invoice',
        },
      },
      // Also on the session for cross-referencing in the Stripe dashboard.
      metadata: { invoiceId: opts.invoiceId, invoiceNumber: opts.invoiceNumber, kind: 'invoice' },
      customer_email: opts.customerEmail,
      expires_at: expiresAt,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    },
    {
      // Stable key per invoice so a replay/retry returns the same Session
      // instead of creating duplicates.
      idempotencyKey: `invoice-checkout:${opts.invoiceId}`,
    },
  )
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
