'use client'

import { useState } from 'react'
import { Modal, Button, Input, Select } from '@/components/ui'
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react'

interface RequestServiceModalProps {
  isOpen: boolean
  onClose: () => void
  installationId: string | null
  installationAddress: string
  onSuccess?: () => void
}

const serviceTypes = [
  { value: 'service', label: 'General Service' },
  { value: 'repair', label: 'Repair' },
  { value: 'replacement', label: 'Replacement' },
]

export function RequestServiceModal({
  isOpen,
  onClose,
  installationId,
  installationAddress,
  onSuccess,
}: RequestServiceModalProps) {
  const [serviceType, setServiceType] = useState('service')
  const [description, setDescription] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!installationId) return

    // Date is required — agents were submitting service requests with no
    // date, leaving the admin no signal for when the customer actually needs
    // the trip. Browser `required` attr is the primary enforcement; this
    // mirrors it so paste-disabled or custom-submit paths still bounce.
    if (!preferredDate) {
      setError('Please pick a preferred date for the service.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/installations/${installationId}/service-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: serviceType,
          description: description || `${serviceType} request for ${installationAddress}`,
          requested_date: preferredDate || null,
          notes,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit service request')
      }

      setSuccess(true)
      setTimeout(() => {
        onSuccess?.()
        handleClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setServiceType('service')
    setDescription('')
    setPreferredDate('')
    setNotes('')
    setError(null)
    setSuccess(false)
    onClose()
  }

  // Calculate minimum date (tomorrow)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split('T')[0]

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Request Service">
      {success ? (
        <div className="py-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Request Submitted!</h3>
          <p className="text-gray-600">We&apos;ll review your request and be in touch soon.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Installation Address</p>
              <p className="font-medium text-gray-900">{installationAddress}</p>
            </div>

            <Select
              label="Service Type"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              options={serviceTypes}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Describe the Issue
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all resize-none"
                rows={3}
                placeholder="Please describe what service you need..."
                required
              />
            </div>

            <Input
              type="date"
              label="Preferred Date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              min={minDate}
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Additional Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all resize-none"
                rows={2}
                placeholder="Any other details we should know..."
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !description}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Request'
              )}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
