'use client'

import { useState, useEffect } from 'react'
import { Modal, Button, Input, Select } from '@/components/ui'
import { Calendar, Loader2, AlertCircle, CheckCircle } from 'lucide-react'

interface PickerInstallation {
  id: string
  propertyAddress: string
  propertyCity: string
  status: string
}

interface ScheduleRemovalModalProps {
  isOpen: boolean
  onClose: () => void
  // Pass a fixed installationId when the caller already knows which
  // installation this is for (e.g. the 3-dots menu on an installation row).
  // Pass null to have the modal fetch the customer's active installations
  // and show a picker first — used by the standalone "Schedule Removal"
  // entry point on /dashboard/service-requests where no row is selected yet.
  installationId: string | null
  installationAddress: string
  onSuccess?: () => void
}

export function ScheduleRemovalModal({
  isOpen,
  onClose,
  installationId,
  installationAddress,
  onSuccess,
}: ScheduleRemovalModalProps) {
  const pickerMode = installationId === null

  const [pickedId, setPickedId] = useState('')
  const [installations, setInstallations] = useState<PickerInstallation[]>([])
  const [loadingInstallations, setLoadingInstallations] = useState(false)

  const [removalDate, setRemovalDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Picker mode: load the customer's active installations once the modal opens.
  // Only 'active' is eligible — matches the 3-dots menu's own gate
  // (active-posts-table.tsx), so a customer can't pick one that already has
  // a removal scheduled or was already removed.
  useEffect(() => {
    if (isOpen && pickerMode) {
      setLoadingInstallations(true)
      fetch('/api/installations')
        .then((res) => (res.ok ? res.json() : { installations: [] }))
        .then((data) => {
          const eligible = (data.installations || []).filter(
            (inst: PickerInstallation) => inst.status === 'active'
          )
          setInstallations(eligible)
        })
        .catch(() => setInstallations([]))
        .finally(() => setLoadingInstallations(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pickerMode])

  const selected = installations.find((i) => i.id === pickedId)
  const effectiveId = pickerMode ? pickedId || null : installationId
  const effectiveAddress = pickerMode
    ? (selected ? `${selected.propertyAddress}, ${selected.propertyCity}` : '')
    : installationAddress

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!effectiveId || !removalDate) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/installations/${effectiveId}/service-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'removal',
          requested_date: removalDate,
          notes,
          description: `Removal requested for ${effectiveAddress}`,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to schedule removal')
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
    setRemovalDate('')
    setNotes('')
    setError(null)
    setSuccess(false)
    setPickedId('')
    setInstallations([])
    onClose()
  }

  // Calculate minimum date (tomorrow)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split('T')[0]

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Schedule Removal">
      {success ? (
        <div className="py-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Removal Scheduled!</h3>
          <p className="text-gray-600">We&apos;ll be in touch to confirm your removal date.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {pickerMode ? (
              loadingInstallations ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-pink-500" />
                </div>
              ) : installations.length === 0 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                  No active installations eligible for removal. If a removal is already
                  scheduled or the sign was already removed, check Order History for its status.
                </div>
              ) : (
                <Select
                  label="Which listing are we removing?"
                  value={pickedId}
                  onChange={(e) => setPickedId(e.target.value)}
                  options={[
                    { value: '', label: 'Select an installation...' },
                    ...installations.map((inst) => ({
                      value: inst.id,
                      label: `${inst.propertyAddress}, ${inst.propertyCity}`,
                    })),
                  ]}
                />
              )
            ) : (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">Installation Address</p>
                <p className="font-medium text-gray-900">{installationAddress}</p>
              </div>
            )}

            <Input
              type="date"
              label="Preferred Removal Date"
              value={removalDate}
              onChange={(e) => setRemovalDate(e.target.value)}
              min={minDate}
              icon={<Calendar className="w-5 h-5" />}
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
                rows={3}
                placeholder="Any special instructions for the removal..."
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
            <Button type="submit" disabled={loading || !removalDate || (pickerMode && !pickedId)}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scheduling...
                </>
              ) : (
                'Schedule Removal'
              )}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
