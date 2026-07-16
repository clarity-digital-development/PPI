export type RiderSource = 'rental' | 'owned' | 'at_property'

export interface RiderOption {
  id: string
  name: string
  slug: string
  category: RiderCategory
  requiresInput?: boolean
  inputLabel?: string
  inputType?: 'number' | 'text'
  inputSuffix?: string
  icon?: string
}

export interface SelectedRider {
  // Stable per-entry identity, distinct from riderId. Two entries can end up
  // sharing a riderId (a leftover-corrupted order's duplicate rider — see
  // dedupeByRiderId in useRiderSelection.ts), which makes riderId unsafe as a
  // React list key or a removal target. instanceId is generated once when the
  // entry is created and never reassigned for that entry's lifetime.
  instanceId: string
  riderId: string
  source: RiderSource
  customValue?: string | number
  price: number
}

let riderInstanceCounter = 0
export function generateRiderInstanceId(): string {
  riderInstanceCounter += 1
  return `sr-${Date.now()}-${riderInstanceCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export type RiderCategory =
  | 'popular'
  | 'status'
  | 'bedrooms'
  | 'property_features'
  | 'rental_lease'
  | 'special'
  | 'custom'

export interface RiderCategoryConfig {
  id: RiderCategory
  label: string
  icon?: string
  defaultExpanded?: boolean
}

export interface CustomerRiderInventory {
  id: string
  riderType: string
  quantity: number
}

export interface RiderSelectorProps {
  selectedRiders: SelectedRider[]
  onSelectionChange: (riders: SelectedRider[]) => void
  customerInventory?: CustomerRiderInventory[]
  rentalPrice?: number
  installPrice?: number
  maxSelections?: number
  disabled?: boolean
}
