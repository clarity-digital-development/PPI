'use client'

import { useState, useEffect } from 'react'
import { Modal, Button, Input, Select } from '@/components/ui'
import { Loader2, AlertCircle, CheckCircle, MapPin, Plus, DollarSign } from 'lucide-react'
import { PRICING } from '@/lib/constants'
import { getNextAvailableDate, toDateStr, isSunday } from '@/lib/scheduling'

interface Installation {
  id: string
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  status: string
  installedAt?: string
}

interface ScheduleTripModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function ScheduleTripModal({
  isOpen,
  onClose,
  onSuccess,
}: ScheduleTripModalProps) {
  const [installations, setInstallations] = useState<Installation[]>([])
  const [loadingInstallations, setLoadingInstallations] = useState(true)

  // Form state
  const [addressType, setAddressType] = useState<'existing' | 'new'>('existing')
  const [selectedInstallationId, setSelectedInstallationId] = useState('')
  const [newAddress, setNewAddress] = useState({
    street: '',
    city: '',
    state: 'KY',
    zip: '',
  })
  const [preferredDate, setPreferredDate] = useState('')
  const [notes, setNotes] = useState('')

  // Accessories to add
  const [addLockbox, setAddLockbox] = useState(false)
  const [lockboxType, setLockboxType] = useState('sentrilock')
  const [addRider, setAddRider] = useState(false)
  const [riderDescription, setRiderDescription] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Fetch user's installations
  useEffect(() => {
    if (isOpen) {
      fetchInstallations()
    }
  }, [isOpen])

  async function fetchInstallations() {
    setLoadingInstallations(true)
    try {
      // /api/installations is the right endpoint — /api/inventory was a typo
      // that returned undefined.installations and left the dropdown empty.
      const res = await fetch('/api/installations')
      if (res.ok) {
        const data = await res.json()
        // Show active AND removal_scheduled — a customer with a removal
        // booked may still want to add a lockbox before pickup day.
        // Hide fully-removed installations.
        const eligible = (data.installations || []).filter(
          (inst: Installation) => inst.status === 'active' || inst.status === 'removal_scheduled'
        )
        setInstallations(eligible)
      }
    } catch (err) {
      console.error('Error fetching installations:', err)
    } finally {
      setLoadingInstallations(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate
    if (addressType === 'existing' && !selectedInstallationId) {
      setError('Please select an installation')
      return
    }
    if (addressType === 'new' && (!newAddress.street || !newAddress.city || !newAddress.zip)) {
      setError('Please fill in the address')
      return
    }
    if (!addLockbox && !addRider) {
      setError('Please select at least one item to add')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Build description
      const items: string[] = []
      if (addLockbox) items.push(`${lockboxType} lockbox`)
      if (addRider) items.push(`rider: ${riderDescription || 'standard'}`)

      const address = addressType === 'existing'
        ? installations.find(i => i.id === selectedInstallationId)
          ? `${installations.find(i => i.id === selectedInstallationId)!.propertyAddress}, ${installations.find(i => i.id === selectedInstallationId)!.propertyCity}`
          : 'Selected installation'
        : `${newAddress.street}, ${newAddress.city}, ${newAddress.state} ${newAddress.zip}`

      const description = `Service trip to add: ${items.join(', ')}. Address: ${address}. Trip fee: $${PRICING.serviceTrip}`

      if (addressType === 'existing') {
        // Create service request linked to installation
        const res = await fetch(`/api/installations/${selectedInstallationId}/service-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'service',
            description,
            requested_date: preferredDate || null,
            notes: notes || `Items to add: ${items.join(', ')}`,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to schedule trip')
        }
      } else {
        // Create standalone service request via general endpoint
        const res = await fetch('/api/service-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'service',
            description,
            requested_date: preferredDate || null,
            notes: `Unlisted address: ${address}\nItems to add: ${items.join(', ')}\n${notes || ''}`,
            address: newAddress,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to schedule trip')
        }
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
    setAddressType('existing')
    setSelectedInstallationId('')
    setNewAddress({ street: '', city: '', state: 'KY', zip: '' })
    setPreferredDate('')
    setNotes('')
    setAddLockbox(false)
    setLockboxType('sentrilock')
    setAddRider(false)
    setRiderDescription('')
    setError(null)
    setSuccess(false)
    onClose()
  }

  // Same scheduling rules as the install order: no Sundays, no same-day
  // after 4pm EST. Removal/service-trip dates must clear the cutoff too.
  const minDate = toDateStr(getNextAvailableDate())

  const handlePreferredDateChange = (val: string) => {
    if (val && isSunday(val)) {
      setError('We are closed on Sundays — please pick another day.')
      return
    }
    setError(null)
    setPreferredDate(val)
  }

  const installationOptions = installations.map((inst) => ({
    value: inst.id,
    label:
      inst.status === 'removal_scheduled'
        ? `${inst.propertyAddress}, ${inst.propertyCity} (removal scheduled)`
        : `${inst.propertyAddress}, ${inst.propertyCity}`,
  }))

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Schedule a Trip">
      {success ? (
        <div className="py-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Trip Scheduled!</h3>
          <p className="text-gray-600">We&apos;ll be in touch to confirm your appointment.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Trip Fee Notice */}
            <div className="p-4 bg-pink-50 rounded-lg border border-pink-200">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-pink-600" />
                <span className="font-semibold text-pink-900">Trip Fee: ${PRICING.serviceTrip}</span>
              </div>
              <p className="text-sm text-pink-700 mt-1">
                A trip fee applies for adding accessories to existing installations.
              </p>
            </div>

            {/* Address Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Location
              </label>
              <div className="flex gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => setAddressType('existing')}
                  className={`flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    addressType === 'existing'
                      ? 'bg-pink-500 text-white border-pink-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-pink-300'
                  }`}
                >
                  Existing Installation
                </button>
                <button
                  type="button"
                  onClick={() => setAddressType('new')}
                  className={`flex-1 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    addressType === 'new'
                      ? 'bg-pink-500 text-white border-pink-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-pink-300'
                  }`}
                >
                  <Plus className="w-4 h-4 inline mr-1" />
                  Other Address
                </button>
              </div>

              {addressType === 'existing' ? (
                loadingInstallations ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-pink-500" />
                  </div>
                ) : installations.length === 0 ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 space-y-1.5">
                    <p className="font-medium">No completed installations on your account yet.</p>
                    <p className="text-amber-800">
                      If you have an order being installed in the next few days, switch to <strong>Other Address</strong>{' '}
                      and reference the order in the notes — our crew will combine it with the install visit.
                    </p>
                    <p className="text-amber-800">
                      To <strong>cancel</strong> or change a pending order, use <strong>Order History</strong> — removal
                      service isn&apos;t applicable before install.
                    </p>
                  </div>
                ) : (
                  <Select
                    value={selectedInstallationId}
                    onChange={(e) => setSelectedInstallationId(e.target.value)}
                    options={[{ value: '', label: 'Select an installation...' }, ...installationOptions]}
                  />
                )
              ) : (
                <div className="space-y-3">
                  <Input
                    label="Street Address"
                    value={newAddress.street}
                    onChange={(e) => setNewAddress({ ...newAddress, street: e.target.value })}
                    placeholder="123 Main St"
                    icon={<MapPin className="w-5 h-5" />}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <Input
                      label="City"
                      value={newAddress.city}
                      onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
                      placeholder="Lexington"
                      className="col-span-2"
                    />
                    <Input
                      label="State"
                      value={newAddress.state}
                      onChange={(e) => setNewAddress({ ...newAddress, state: e.target.value })}
                      placeholder="KY"
                    />
                  </div>
                  <Input
                    label="ZIP Code"
                    value={newAddress.zip}
                    onChange={(e) => setNewAddress({ ...newAddress, zip: e.target.value })}
                    placeholder="40502"
                  />
                </div>
              )}
            </div>

            {/* What to Add */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                What would you like to add?
              </label>
              <div className="space-y-3">
                {/* Lockbox Option */}
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={addLockbox}
                    onChange={(e) => setAddLockbox(e.target.checked)}
                    className="mt-1 w-4 h-4 text-pink-500 border-gray-300 rounded focus:ring-pink-500"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-gray-900">Lockbox</span>
                    {addLockbox && (
                      <div className="mt-2">
                        <Select
                          value={lockboxType}
                          onChange={(e) => setLockboxType(e.target.value)}
                          options={[
                            { value: 'sentrilock', label: 'Sentrilock/Supra' },
                            { value: 'mechanical', label: 'Mechanical' },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                </label>

                {/* Rider Option */}
                <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={addRider}
                    onChange={(e) => setAddRider(e.target.checked)}
                    className="mt-1 w-4 h-4 text-pink-500 border-gray-300 rounded focus:ring-pink-500"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-gray-900">Rider</span>
                    {addRider && (
                      <Input
                        value={riderDescription}
                        onChange={(e) => setRiderDescription(e.target.value)}
                        placeholder="e.g., Sold, Coming Soon, Open House"
                        className="mt-2"
                      />
                    )}
                  </div>
                </label>
              </div>
            </div>

            {/* Preferred Date */}
            <Input
              type="date"
              label="Preferred Date"
              value={preferredDate}
              onChange={(e) => handlePreferredDateChange(e.target.value)}
              min={minDate}
              helperText="Next-day after 4pm EST is the soonest. We're closed Sundays."
            />

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Additional Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all resize-none"
                rows={2}
                placeholder="Any special instructions..."
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
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scheduling...
                </>
              ) : (
                `Schedule Trip ($${PRICING.serviceTrip})`
              )}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
