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
  riderId: string
  source: RiderSource
  customValue?: string | number
  price: number
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
