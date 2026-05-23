'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from './input'
import { loadGoogleMaps, isGoogleMapsConfigured, parseAddressComponents } from '@/lib/google-maps'

interface AddressAutocompleteProps {
  /** Current street address value */
  value: string
  /** Called as the user types (so the field stays controlled) */
  onChange: (street: string) => void
  /**
   * Called when the user picks a full address from the Google suggestions.
   * Use this to autofill city / state / zip on the rest of the form.
   * Not called when the user is just typing freely.
   */
  onPlaceSelected?: (parsed: { street: string; city: string; state: string; zip: string }) => void
  label?: string
  placeholder?: string
  helperText?: string
}

/**
 * Street-address input with Google Places autocomplete. Falls back to a plain
 * text input when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY isn't set, so the form keeps
 * working even without the key.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  label = 'Street Address *',
  placeholder = '123 Main Street',
  helperText,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [scriptReady, setScriptReady] = useState(false)
  const [scriptUnavailable, setScriptUnavailable] = useState(!isGoogleMapsConfigured())

  // Load the Maps script once (singleton)
  useEffect(() => {
    if (!isGoogleMapsConfigured()) return
    loadGoogleMaps()
      .then(() => setScriptReady(true))
      .catch(() => setScriptUnavailable(true))
  }, [])

  // Attach the Autocomplete widget to the input once the script is ready
  useEffect(() => {
    if (!scriptReady || !inputRef.current || !window.google?.maps?.places) return
    const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['address_components'],
    })
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      const parsed = parseAddressComponents(place.address_components)
      if (parsed.street) onChange(parsed.street)
      onPlaceSelected?.(parsed)
    })
    // No reliable destructor for Autocomplete; the listener auto-cleans when
    // the input unmounts.
  }, [scriptReady, onChange, onPlaceSelected])

  return (
    <Input
      ref={inputRef}
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      helperText={
        helperText ??
        (scriptReady
          ? 'Start typing to autofill city, state, and ZIP'
          : scriptUnavailable
            ? undefined
            : 'Loading address suggestions…')
      }
      autoComplete="off"
    />
  )
}
