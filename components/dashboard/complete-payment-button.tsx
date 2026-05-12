'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, AlertCircle, CheckCircle, ShieldCheck, XCircle } from 'lucide-react'
import { Card, CardContent, Button } from '@/components/ui'
import { getStripe } from '@/lib/stripe/client'

interface CompletePaymentButtonProps {
  orderId: string
  amount: number
}

type Status = 'idle' | 'loading' | 'ready' | 'authenticating' | 'success' | 'error' | 'no_action' | 'payment_failed'

export function CompletePaymentButton({ orderId, amount }: CompletePaymentButtonProps) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)

  // On mount, ask the server whether this order needs payment action
  useEffect(() => {
    let cancelled = false
    async function checkStatus() {
      try {
        const res = await fetch(`/api/orders/${orderId}/complete-payment`)
        const data = await res.json()
        if (cancelled) return

        if (!res.ok) {
          setStatus('error')
          setError(data.error || 'Could not check payment status.')
          return
        }

        if (data.status === 'succeeded') {
          setStatus('success')
          return
        }

        if (data.requires_action && data.client_secret) {
          setClientSecret(data.client_secret)
          setStatus('ready')
          return
        }

        // PaymentIntent is past 3DS — usually requires_payment_method (the card
        // was declined or 3DS timed out). Show the customer a clear next step.
        if (data.status === 'requires_payment_method' || data.status === 'canceled') {
          setStatus('payment_failed')
          return
        }

        // Anything else (processing, no intent, etc.) — keep the banner hidden
        setStatus('no_action')
        if (data.error) setError(data.error)
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Could not check payment status.')
      }
    }
    checkStatus()
    return () => { cancelled = true }
  }, [orderId])

  async function handleComplete() {
    if (!clientSecret) return
    setStatus('authenticating')
    setError(null)

    try {
      const stripe = await getStripe()
      if (!stripe) {
        throw new Error('Payment service unavailable.')
      }

      // handleNextAction triggers the 3DS challenge popup for the existing
      // payment intent, then resolves once the customer completes or cancels it
      const { paymentIntent, error: stripeError } = await stripe.handleNextAction({
        clientSecret,
      })

      if (stripeError) {
        setStatus('error')
        setError(stripeError.message || 'Payment authentication failed.')
        return
      }

      if (paymentIntent?.status === 'succeeded') {
        // Tell our server to sync (in case webhook is delayed)
        await fetch(`/api/orders/${orderId}/complete-payment`, { method: 'POST' })
        setStatus('success')
        // Reload to refresh order status
        setTimeout(() => router.refresh(), 800)
        return
      }

      // Still not succeeded — could be requires_payment_method (card was declined
      // again) or processing
      await fetch(`/api/orders/${orderId}/complete-payment`, { method: 'POST' })
      if (paymentIntent?.status === 'processing') {
        setStatus('success')
        setTimeout(() => router.refresh(), 800)
      } else {
        setStatus('error')
        setError(
          paymentIntent?.status === 'requires_payment_method'
            ? 'Your card was declined during verification. Please place the order again with a different card.'
            : 'Payment did not complete. Please try again.'
        )
      }
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (status === 'loading') {
    return null // don't flash a banner while we check
  }

  if (status === 'no_action') {
    return null // nothing to complete — order detail page already shows the real status
  }

  if (status === 'success') {
    return (
      <Card className="mb-6 bg-green-50 border-green-200">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900">Payment complete</p>
              <p className="text-sm text-green-700 mt-0.5">Refreshing your order...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'payment_failed') {
    return (
      <Card className="mb-6 bg-red-50 border-red-200">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-red-900">Payment did not complete</p>
              <p className="text-sm text-red-800 mt-1">
                Your card was not successfully charged for this order. You have not been billed.
                This usually happens when the bank&apos;s verification step is closed early or the card
                is declined. Please place the order again, or try a different card.
              </p>
              <div className="mt-4 flex gap-2">
                <Link href="/dashboard/place-order">
                  <Button>Place a New Order</Button>
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mb-6 bg-amber-50 border-amber-300">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-amber-900">Payment needs verification</p>
            <p className="text-sm text-amber-800 mt-0.5">
              Your bank needs to verify this ${amount.toFixed(2)} charge before we can process the order. Click below to complete the verification with your bank.
            </p>

            {error && (
              <div className="mt-3 flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-md">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <Button
              onClick={handleComplete}
              disabled={status === 'authenticating' || !clientSecret}
              className="mt-4"
            >
              {status === 'authenticating' ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying with your bank...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Complete Payment
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
