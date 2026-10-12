'use client'

import { useState, useEffect } from 'react'
import { Modal, Button, Input } from '@/components/ui'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { Calendar, Loader2, AlertCircle, CheckCircle, MapPin } from 'lucide-react'
import { getNextAvailableDate, toDateStr, closedDayReason } from '@/lib/scheduling'
import { sameProperty } from '@/lib/installations/address-match'

interface PickerInstallation {
  id: string
  propertyAddress: string
  propertyCity: string
  propertyZip: string
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
  const [installationsLoaded, setInstallationsLoaded] = useState(false)
  // A failed load is not an empty list: it gets a retry, not the
  // "no signs on your list" address form.
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  // "My sign isn't listed": a removal for a sign the site has no record of
  // goes in by address (POST /api/service-requests, type 'removal'), so a
  // customer is never stuck because their sign is missing from the list.
  const [unlistedChosen, setUnlistedChosen] = useState(false)
  const [unlistedAddress, setUnlistedAddress] = useState({ street: '', city: '', state: 'KY', zip: '' })

  const [removalDate, setRemovalDate] = useState('')
  const [notes, setNotes] = useState('')
  // Ryan 2026-09-01: ask about a lockbox on every removal — undefined until
  // the customer picks, so the answer can't be blown through.
  const [hasLockbox, setHasLockbox] = useState<boolean | undefined>(undefined)
  const [lockboxCode, setLockboxCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Picker mode: load the customer's active installations once the modal opens.
  // Only 'active' is eligible — matches the 3-dots menu's own gate
  // (active-posts-table.tsx), so a customer can't pick one that already has
  // a removal scheduled or was already removed.
  useEffect(() => {
    if (!isOpen || !pickerMode) return
    // A load still running when the modal closes (or a retry starts) must not
    // write into the next one's state.
    let cancelled = false
    setLoadingInstallations(true)
    setLoadError(false)
    setInstallationsLoaded(false)
    fetch('/api/installations')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load installations')
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        const eligible = (data.installations || []).filter(
          (inst: PickerInstallation) => inst.status === 'active'
        )
        setInstallations(eligible)
        setInstallationsLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setInstallations([])
        setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoadingInstallations(false)
      })
    return () => {
      cancelled = true
      setLoadingInstallations(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pickerMode, loadAttempt])

  const selected = installations.find((i) => i.id === pickedId)
  const effectiveId = pickerMode ? pickedId || null : installationId
  const effectiveAddress = pickerMode
    ? (selected ? `${selected.propertyAddress}, ${selected.propertyCity}` : '')
    : installationAddress

  // With nothing on the list there's nothing to pick, so the address form
  // shows straight away.
  const unlisted = pickerMode && (unlistedChosen || (installationsLoaded && installations.length === 0))
  const trimmedUnlisted = {
    street: unlistedAddress.street.trim(),
    city: unlistedAddress.city.trim(),
    state: unlistedAddress.state.trim(),
    zip: unlistedAddress.zip.trim(),
  }
  const unlistedComplete = Object.values(trimmedUnlisted).every(Boolean)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!removalDate || hasLockbox === undefined) return
    if (unlisted ? !unlistedComplete : !effectiveId) return
    if (hasLockbox && !lockboxCode.trim()) return

    setLoading(true)
    setError(null)

    // The lockbox answer rides in notes so it reaches the admin SR view and
    // the installer dispatch email without a schema change.
    const lockboxNote = hasLockbox
      ? `Lockbox to remove — code: ${lockboxCode.trim()}`
      : 'No lockbox to remove.'

    const request = {
      type: 'removal',
      requested_date: removalDate,
      notes: [lockboxNote, notes.trim()].filter(Boolean).join('\n'),
    }

    // A typed address that's really one on their list (spelled differently,
    // say "Street" for "St") goes through the listed removal for that sign,
    // which marks it removal_scheduled and bills any out-of-area pickup half.
    const listedMatch = unlisted
      ? installations.find((i) =>
          sameProperty({ street: i.propertyAddress, city: i.propertyCity, zip: i.propertyZip }, trimmedUnlisted)
        )
      : undefined
    const targetId = listedMatch ? listedMatch.id : unlisted ? null : effectiveId
    const targetAddress = listedMatch
      ? `${listedMatch.propertyAddress}, ${listedMatch.propertyCity}`
      : effectiveAddress

    try {
      const res = targetId
        ? await fetch(`/api/installations/${targetId}/service-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...request,
              description: `Removal requested for ${targetAddress}`,
            }),
          })
        : await fetch('/api/service-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...request,
              description: 'Removal requested for a sign not on the account list',
              address: trimmedUnlisted,
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
    setHasLockbox(undefined)
    setLockboxCode('')
    setError(null)
    setSuccess(false)
    setPickedId('')
    setInstallations([])
    setInstallationsLoaded(false)
    setLoadError(false)
    setUnlistedChosen(false)
    setUnlistedAddress({ street: '', city: '', state: 'KY', zip: '' })
    onClose()
  }

  // Earliest allowed date — honors the 4pm cutoff and closed days
  // (Sat/Sun/holidays), same rules as installs.
  const minDate = toDateStr(getNextAvailableDate())

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
              ) : loadError && !unlistedChosen ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 space-y-2">
                  <p>We couldn&apos;t load your signs.</p>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setLoadAttempt((n) => n + 1)}
                      className="font-medium underline"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnlistedChosen(true)}
                      className="font-medium underline"
                    >
                      Enter the address instead
                    </button>
                  </div>
                </div>
              ) : unlisted ? (
                <div className="space-y-3">
                  {installationsLoaded && installations.length === 0 ? (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
                      We don&apos;t have any signs on your list right now. If one of yours is up
                      and needs to come down, enter its address below. If a removal is already
                      scheduled or the sign was already removed, check Order History for its status.
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-gray-700">Where is the sign?</p>
                      <button
                        type="button"
                        onClick={() => { setUnlistedChosen(false); setError(null) }}
                        className="text-sm text-pink-600 hover:text-pink-700 hover:underline"
                      >
                        Pick from my list instead
                      </button>
                    </div>
                  )}
                  <Input
                    label="Street Address"
                    value={unlistedAddress.street}
                    onChange={(e) => setUnlistedAddress({ ...unlistedAddress, street: e.target.value })}
                    placeholder="123 Main St"
                    icon={<MapPin className="w-5 h-5" />}
                    required
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <Input
                      label="City"
                      value={unlistedAddress.city}
                      onChange={(e) => setUnlistedAddress({ ...unlistedAddress, city: e.target.value })}
                      placeholder="Lexington"
                      className="col-span-2"
                      required
                    />
                    <Input
                      label="State"
                      value={unlistedAddress.state}
                      onChange={(e) => setUnlistedAddress({ ...unlistedAddress, state: e.target.value })}
                      placeholder="KY"
                      required
                    />
                  </div>
                  <Input
                    label="ZIP Code"
                    value={unlistedAddress.zip}
                    onChange={(e) => setUnlistedAddress({ ...unlistedAddress, zip: e.target.value })}
                    placeholder="40502"
                    required
                  />
                </div>
              ) : (
                <div>
                  {/* Searchable (substring) rather than a native <select>: the
                      browser's type-ahead only matches from the START of the
                      label, so typing a house number found the address but a
                      street name never did — a broker with 50+ listings had to
                      scroll (Ryan, 2026-08-14). */}
                  <SearchableSelect
                    label="Which listing are we removing?"
                    value={pickedId}
                    onChange={setPickedId}
                    options={installations.map((inst) => ({
                      value: inst.id,
                      label: `${inst.propertyAddress}, ${inst.propertyCity}`,
                    }))}
                    placeholder="Select an installation..."
                    searchPlaceholder="Type any part of the address — street, number, city…"
                    emptyText="No listings match"
                  />
                  <button
                    type="button"
                    onClick={() => { setUnlistedChosen(true); setPickedId(''); setError(null) }}
                    className="mt-2 text-sm text-pink-600 hover:text-pink-700 hover:underline"
                  >
                    My sign isn&apos;t listed. Enter the address
                  </button>
                </div>
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
              onChange={(e) => {
                const v = e.target.value
                const reason = v ? closedDayReason(v) : null
                if (reason) {
                  setError(reason)
                  return
                }
                setError(null)
                setRemovalDate(v)
              }}
              min={minDate}
              icon={<Calendar className="w-5 h-5" />}
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Is there a lockbox you&apos;d like us to remove? *
              </label>
              <p className="text-xs text-gray-500 mb-2">
                If key is still inside, we will hide and let you know location.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setHasLockbox(true)}
                  className={`flex-1 py-2.5 px-4 rounded-lg border-2 font-medium transition-all ${
                    hasLockbox === true
                      ? 'border-pink-500 bg-pink-50 text-pink-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => { setHasLockbox(false); setLockboxCode('') }}
                  className={`flex-1 py-2.5 px-4 rounded-lg border-2 font-medium transition-all ${
                    hasLockbox === false
                      ? 'border-pink-500 bg-pink-50 text-pink-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  No
                </button>
              </div>
              {hasLockbox && (
                <div className="mt-3">
                  <Input
                    label="Shackle or combo code *"
                    value={lockboxCode}
                    onChange={(e) => setLockboxCode(e.target.value)}
                    placeholder="e.g. 1234"
                    helperText="If sentrilock, send a shackle and eKEY access the morning of."
                    required
                  />
                </div>
              )}
            </div>

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
            <Button
              type="submit"
              disabled={
                loading ||
                !removalDate ||
                (unlisted ? !unlistedComplete : pickerMode && !pickedId) ||
                hasLockbox === undefined ||
                (hasLockbox && !lockboxCode.trim())
              }
            >
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
