'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Info, Plus, MapPin } from 'lucide-react'
import { Modal } from '@/components/ui'
import {
  RiderSourceToggle,
  PopularRiders,
  RiderCategoryAccordion,
  CustomRiderInput,
  SelectedRidersList,
} from './components'
import { useRiderSelection } from './hooks/useRiderSelection'
import { RIDER_CATEGORIES, RIDERS, getRidersByCategory, getRiderBySlug, RIDER_PRICING } from './constants'
import type { RiderSelectorProps, RiderOption } from './types'

export function RiderSelector({
  selectedRiders: externalRiders,
  onSelectionChange,
  customerInventory = [],
  rentalPrice = RIDER_PRICING.rental,
  installPrice = RIDER_PRICING.install,
  disabled = false,
  pickupLocation,
  onPickupLocationChange,
}: RiderSelectorProps) {
  const {
    selectedRiders,
    source,
    expandedCategories,
    setSource,
    toggleRider,
    removeRider,
    clearAll,
    updateAcres,
    toggleCategory,
    addCustomTextRider,
    totalPrice,
    isRiderSelected,
    isRiderAvailable,
    getSelectedCount,
    getDisplayPrice,
  } = useRiderSelection({
    initialRiders: externalRiders,
    customerInventory,
    rentalPrice,
    installPrice,
  })

  // Free-text custom rider input — only shown for Pickup/At property since
  // it's the only source where the agent supplies the rider themselves.
  const [customNameInput, setCustomNameInput] = useState('')

  // Sync with parent whenever selection changes. Must be useEffect, not
  // useMemo: useMemo runs its factory DURING render, so calling a callback
  // that turns around and setStates the parent (OrderWizard's formData) from
  // inside a child's render triggered a real "Cannot update a component
  // while rendering a different component" React warning/race — useEffect
  // defers it to after commit, matching React's actual effect-ordering
  // guarantee instead of relying on useMemo's unstable re-invocation rules.
  useEffect(() => {
    onSelectionChange(selectedRiders)
  }, [selectedRiders, onSelectionChange])

  // Agents kept picking riders on the Pickup/At property tab when they meant
  // to rent ours (Ryan, 2026-10-29: "for every single one of these"). Every
  // pickup rider added asks where it is, filled in with the last answer, and
  // points to Rent Riders. Riders already on an order being edited don't ask:
  // the count starts from what's there. An Acres or Car Garage rider is added
  // on the first digit typed, so it asks when the agent leaves that box
  // rather than taking the rest of the number into the pop-up.
  const asksPickupLocation = !!onPickupLocationChange
  const pickupCount = selectedRiders.filter(r => r.source === 'at_property').length
  const [pickupPromptOpen, setPickupPromptOpen] = useState(false)
  const [pickupDraft, setPickupDraft] = useState('')
  const lastPickupCount = useRef(pickupCount)
  const pickupLocationRef = useRef(pickupLocation)
  pickupLocationRef.current = pickupLocation
  // The rider the open pop-up is about ("I meant to rent" takes it off), and
  // an Acres/Car Garage rider still waiting for its box to lose focus.
  const promptRiderId = useRef<string | null>(null)
  const promptAfterTyping = useRef<string | null>(null)

  const openPickupPrompt = useCallback((instanceId: string) => {
    promptRiderId.current = instanceId
    setPickupDraft(pickupLocationRef.current ?? '')
    setPickupPromptOpen(true)
  }, [])

  useEffect(() => {
    const pickups = selectedRiders.filter(r => r.source === 'at_property')
    const added = pickups.length > lastPickupCount.current
    lastPickupCount.current = pickups.length
    if (!asksPickupLocation || !added) return
    const newest = pickups[pickups.length - 1]
    if (RIDERS.find(r => r.id === newest.riderId)?.requiresInput) {
      promptAfterTyping.current = newest.instanceId
    } else {
      openPickupPrompt(newest.instanceId)
    }
  }, [selectedRiders, asksPickupLocation, openPickupPrompt])

  const handleCustomInputBlur = () => {
    const waiting = promptAfterTyping.current
    promptAfterTyping.current = null
    // Cleared the box before leaving it: nothing was added, nothing to ask.
    if (waiting && selectedRiders.some(r => r.instanceId === waiting)) openPickupPrompt(waiting)
  }
  const pickupFieldId = useId()

  const savePickupLocation = (e: FormEvent) => {
    e.preventDefault()
    if (!pickupDraft.trim()) return
    onPickupLocationChange?.(pickupDraft.trim())
    setPickupPromptOpen(false)
  }

  // "I meant to rent": take the rider they just picked back off and switch to
  // Rent Riders so they can pick it there.
  const switchToRental = () => {
    if (promptRiderId.current) removeRider(promptRiderId.current)
    setSource('rental')
    setPickupPromptOpen(false)
  }

  const hasInventory = customerInventory.length > 0

  // Get custom riders that require input
  const customRiders = RIDERS.filter(r => r.requiresInput)

  // Categories to show (exclude popular since it's shown separately, exclude custom since we handle it below)
  const categoriesToShow = RIDER_CATEGORIES.filter(c => c.id !== 'popular' && c.id !== 'custom')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Riders & Extras</h2>
        <p className="text-gray-600">
          Optional - Select any riders or extras you&apos;d like to add to your installation.
        </p>
      </div>

      {/* Pricing Info */}
      <div className="flex items-start gap-3 p-4 bg-pink-50 rounded-lg">
        <Info className="w-5 h-5 text-pink-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-gray-900">Rider Pricing</p>
          <p className="text-gray-600">
            Install your own riders for <span className="font-semibold">${installPrice}</span> each,
            or rent one of our riders for <span className="font-semibold">${rentalPrice}</span>!
          </p>
          <Link
            href="/riders#terms"
            target="_blank"
            className="text-pink-600 hover:text-pink-700 underline mt-1 inline-block"
          >
            View Rental Terms & Conditions
          </Link>
        </div>
      </div>

      {/* Inventory Status */}
      {hasInventory ? (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800 font-medium">
            {/* A linked agent's list mixes their own riders with the brokerage's;
                say whose each one is, matching the chip labels below. */}
            Riders available to you ({customerInventory.map(inv => `${inv.quantity}x ${inv.riderType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}${inv.sourceLabel ? ` from ${inv.sourceLabel}` : ''}`).join(', ')})
          </p>
          <p className="text-xs text-green-700 mt-0.5">Select &ldquo;My Riders&rdquo; below to install from your inventory at ${installPrice} each.</p>
        </div>
      ) : (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">No riders currently in your inventory. You can rent riders below, or contact your admin to add riders to your account.</p>
        </div>
      )}

      {/* Source Toggle */}
      <RiderSourceToggle
        source={source}
        onSourceChange={setSource}
        hasInventory={hasInventory}
      />

      {/* Custom-name rider input (pickup/at-property only) — lets agents add
          riders that aren't in the standard catalog (e.g. "Walk/Don't Run",
          "Love It/Buy It", "Name Riders"). */}
      {source === 'at_property' && (
        <div className="p-3 border border-gray-200 rounded-lg bg-gray-50 space-y-2">
          <div>
            {/* "Unique", not "custom" — agents were reading "custom rider" as
                "Pink Posts will make me a rider for $2" (Ryan, 2026-09-11). */}
            <h3 className="text-sm font-medium text-gray-900">Add a unique rider</h3>
            <p className="text-xs text-gray-500">
              Not in the list below? Type the rider name and add it — ${installPrice} install.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={customNameInput}
              onChange={(e) => setCustomNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customNameInput.trim()) {
                  e.preventDefault()
                  addCustomTextRider(customNameInput)
                  setCustomNameInput('')
                }
              }}
              placeholder="e.g. Love It/Buy It"
              maxLength={60}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => {
                if (!customNameInput.trim()) return
                addCustomTextRider(customNameInput)
                setCustomNameInput('')
              }}
              disabled={!customNameInput.trim()}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      )}

      {/* Rider Selection: flat list for owned, category grid for rental */}
      {source === 'owned' ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Your Inventory</h3>
          {customerInventory.length === 0 ? (
            <p className="text-sm text-gray-500">No riders in your inventory.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {customerInventory.map(inv => {
                const knownRider = getRiderBySlug(inv.riderType)
                const displayName = knownRider
                  ? knownRider.name
                  : inv.riderType
                      .split('-')
                      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ')
                const riderId = knownRider ? knownRider.id : inv.riderType
                const selected = isRiderSelected(riderId)

                const riderOption: RiderOption = knownRider ?? {
                  id: inv.riderType,
                  name: displayName,
                  slug: inv.riderType,
                  category: 'special',
                }

                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => toggleRider(riderOption)}
                    className={`
                      inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium
                      transition-colors cursor-pointer
                      ${selected
                        ? 'border-pink-500 bg-pink-50 text-pink-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-pink-300 hover:bg-pink-50/50'
                      }
                    `}
                  >
                    <span>{displayName}</span>
                    {/* A linked agent's brokerage riders sit alongside their own. */}
                    {inv.sourceLabel && (
                      <span className="text-xs text-pink-600">— {inv.sourceLabel}</span>
                    )}
                    <span className="text-xs text-gray-500">(&times;{inv.quantity})</span>
                    <span className="text-xs font-semibold text-green-700">${installPrice}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Popular Riders */}
          <PopularRiders
            source={source}
            getPrice={getDisplayPrice}
            isSelected={isRiderSelected}
            isAvailable={isRiderAvailable}
            onToggle={toggleRider}
          />

          {/* Category Accordions */}
          <div className="space-y-2">
            {categoriesToShow.map(category => {
              const riders = getRidersByCategory(category.id)
              if (riders.length === 0) return null

              return (
                <RiderCategoryAccordion
                  key={category.id}
                  category={category}
                  riders={riders}
                  isExpanded={expandedCategories.has(category.id)}
                  onToggleExpand={() => toggleCategory(category.id)}
                  source={source}
                  getPrice={getDisplayPrice}
                  isSelected={isRiderSelected}
                  isAvailable={isRiderAvailable}
                  onToggle={toggleRider}
                  selectedCount={getSelectedCount(category.id)}
                />
              )
            })}
          </div>

          {/* Custom Riders Section */}
          {customRiders.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700">Custom Riders</h3>
              <div className="space-y-3">
                {customRiders.map(rider => {
                  const isSelected = isRiderSelected(rider.id)
                  const customValue = selectedRiders.find(r => r.riderId === rider.id)?.customValue as number | undefined

                  return (
                    <CustomRiderInput
                      key={rider.id}
                      rider={rider}
                      isSelected={isSelected}
                      value={customValue || null}
                      onChange={(value) => updateAcres(rider.id, value)}
                      onBlur={handleCustomInputBlur}
                      price={getDisplayPrice(rider.id)}
                      source={source}
                      isRiderAvailable={isRiderAvailable}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {asksPickupLocation && pickupCount > 0 && (
        <div className="p-4 border border-pink-200 bg-pink-50 rounded-lg space-y-2">
          <label htmlFor={pickupFieldId} className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <MapPin className="w-4 h-4 text-pink-500" />
            Where do we pick up your {pickupCount === 1 ? 'rider' : 'riders'}?
          </label>
          <input
            id={pickupFieldId}
            type="text"
            value={pickupLocation ?? ''}
            onChange={(e) => onPickupLocationChange?.(e.target.value)}
            placeholder="e.g. At the property, or 123 Main St, Lexington"
            maxLength={200}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-600">
            Meant to rent one of our riders? Choose Rent Riders at the top of this page.
          </p>
        </div>
      )}

      <Modal
        isOpen={pickupPromptOpen}
        onClose={() => setPickupPromptOpen(false)}
        title="Where do we pick up this rider?"
      >
        <form onSubmit={savePickupLocation} className="space-y-4">
          <p className="text-sm text-gray-600">
            You chose <span className="font-semibold text-gray-900">Pickup/At property</span>, which is for
            riders you already have. We&apos;ll collect it and install it for ${installPrice}.
          </p>
          <div>
            <label htmlFor={`${pickupFieldId}-prompt`} className="block text-sm font-medium text-gray-700 mb-1">
              Where is it?
            </label>
            <input
              id={`${pickupFieldId}-prompt`}
              type="text"
              value={pickupDraft}
              onChange={(e) => setPickupDraft(e.target.value)}
              placeholder="e.g. At the property, or 123 Main St, Lexington"
              maxLength={200}
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />
          </div>
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Meant to rent one of our riders? Choose Rent Riders at the top of this page, or use the
            button below.
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={switchToRental}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              I meant to rent
            </button>
            <button
              type="submit"
              disabled={!pickupDraft.trim()}
              className="px-4 py-2 rounded-lg bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save location
            </button>
          </div>
        </form>
      </Modal>

      {/* Selected Riders Summary */}
      <SelectedRidersList
        selectedRiders={selectedRiders}
        onRemove={removeRider}
        onClearAll={clearAll}
        totalPrice={totalPrice}
      />
    </div>
  )
}
