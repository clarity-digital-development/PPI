'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/dashboard'
import { Card, CardContent, Button, Badge, Input, Select } from '@/components/ui'
import {
  ArrowLeft,
  Loader2,
  Package,
  Lock,
  Key,
  ShoppingCart,
  Save,
  AlertCircle,
  MapPin,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PRICING } from '@/components/order-flow/types'
import { RiderSelector, type SelectedRider, RIDERS } from '@/components/order-flow/RiderSelector'

interface OrderItem {
  id: string
  itemType: string
  itemCategory: string | null
  description: string
  quantity: number
  unitPrice: number | string
  totalPrice: number | string
  customerSignId?: string | null
  customerRiderId?: string | null
  customerLockboxId?: string | null
  customerBrochureBoxId?: string | null
  customValue?: string | null
}

interface Order {
  id: string
  orderNumber: string
  propertyAddress: string
  propertyCity: string
  propertyState: string
  propertyZip: string
  propertyNotes: string | null
  status: string
  subtotal: number | string
  fuelSurcharge: number | string
  noPostSurcharge: number | string
  expediteFee: number | string
  discount: number | string
  tax: number | string
  total: number | string
  orderItems: OrderItem[]
  postType?: { name: string } | null
}

// Helpers to convert between RiderSelector and order item formats
function riderToSelectedRider(item: OrderItem): SelectedRider | null {
  // Try to find rider by slug from description
  const isRental = item.itemCategory === 'rental'
  const slug = extractRiderSlug(item.description)
  const rider = RIDERS.find(r => r.slug === slug) || RIDERS.find(r => r.category === 'popular' && r.slug === slug)

  if (!rider) return null

  return {
    riderId: rider.id,
    source: isRental ? 'rental' : 'owned',
    price: isRental ? PRICING.rider_rental : PRICING.rider_install,
    customValue: item.customValue || undefined,
  }
}

function extractRiderSlug(description: string): string {
  // Extract rider name from descriptions like "Rider Rental: Open House" or "Rider Install: Coming Soon (from storage)"
  const match = description.match(/Rider (?:Rental|Install): (.+?)(?:\s*\(from storage\))?$/)
  if (match) {
    const name = match[1].trim()
    // Check if it's an acreage rider
    if (name.endsWith(' Acres')) return 'acreage'
    return name.toLowerCase().replace(/\s+/g, '-')
  }
  return ''
}

function selectedRiderToItem(
  selected: SelectedRider,
  origRiderItems: OrderItem[] = [],
  customerRiderInventory: Array<{ id: string; riderType: string }> = [],
): {
  item_type: 'rider'
  item_category: string
  description: string
  quantity: number
  unit_price: number
  total_price: number
  customer_rider_id?: string
  custom_value?: string
} {
  const rider = RIDERS.find(r => r.id === selected.riderId)
  const slug = rider?.slug || selected.riderId
  const name = selected.customValue
    ? `${selected.customValue} Acres`
    : slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const isRental = selected.source === 'rental'
  const price = isRental ? PRICING.rider_rental : PRICING.rider_install
  const description = isRental
    ? `Rider Rental: ${name}`
    : `Rider Install: ${name} (from storage)`

  // Preserve the customer_rider_id from the matching original line item, or
  // look one up from the customer's current inventory by slug, so inventory
  // tracking survives an edit
  let customer_rider_id: string | undefined
  if (!isRental) {
    const matchingOrig = origRiderItems.find(i => extractRiderSlug(i.description) === slug)
    customer_rider_id = matchingOrig?.customerRiderId || undefined
    if (!customer_rider_id) {
      const inv = customerRiderInventory.find(inv => inv.riderType === slug)
      customer_rider_id = inv?.id
    }
  }

  return {
    item_type: 'rider',
    item_category: isRental ? 'rental' : 'storage',
    description,
    quantity: 1,
    unit_price: price,
    total_price: price,
    customer_rider_id,
    custom_value: selected.customValue?.toString(),
  }
}

const statusConfig: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'error' | 'neutral' }> = {
  pending: { label: 'Pending', variant: 'warning' },
  confirmed: { label: 'Confirmed', variant: 'info' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  in_progress: { label: 'In Progress', variant: 'info' },
}

export default function EditOrderPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = params.id as string

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Edit state
  // Post type: a post name, 'open_house', or '' for no post. Initialized from
  // the order's current post; sent as post_type only when changed.
  const [postType, setPostType] = useState<string>('')
  const [postDirty, setPostDirty] = useState(false)
  const [signOption, setSignOption] = useState<'stored' | 'at_property' | 'none'>('none')
  const [signDescription, setSignDescription] = useState('')
  const [selectedRiders, setSelectedRiders] = useState<SelectedRider[]>([])
  const [lockboxOption, setLockboxOption] = useState<'sentrilock' | 'mechanical_own' | 'mechanical_rent' | 'at_property' | 'none'>('none')
  const [lockboxCode, setLockboxCode] = useState('')
  const [brochureOption, setBrochureOption] = useState<'purchase' | 'own' | 'none'>('none')
  const [installationNotes, setInstallationNotes] = useState('')

  // Inventory
  const [inventory, setInventory] = useState<{
    signs: Array<{ id: string; description: string; size: string | null }>
    riders: Array<{ id: string; rider_type: string; quantity: number }>
    lockboxes: Array<{ id: string; lockbox_type: string; lockbox_code: string | null }>
    brochureBoxes: { quantity: number } | null
  } | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const [orderRes, inventoryRes] = await Promise.all([
          fetch(`/api/orders/${orderId}`),
          fetch('/api/inventory'),
        ])

        if (!orderRes.ok) {
          throw new Error(orderRes.status === 404 ? 'Order not found' : 'Failed to load order')
        }

        const orderData = await orderRes.json()
        const ord = orderData.order as Order

        // Check if order is editable
        if (ord.status === 'completed' || ord.status === 'cancelled') {
          throw new Error('This order cannot be edited')
        }

        setOrder(ord)
        setInstallationNotes(ord.propertyNotes || '')

        // Initialize edit state from existing order items
        initializeFromOrder(ord)

        if (inventoryRes.ok) {
          const invData = await inventoryRes.json()
          setInventory(invData)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [orderId])

  const initializeFromOrder = (ord: Order) => {
    // Post — initialize from the existing post type (empty = no post)
    setPostType(ord.postType?.name || '')

    // Sign
    const signItem = ord.orderItems.find(i => i.itemType === 'sign')
    if (signItem) {
      if (signItem.itemCategory === 'storage') {
        setSignOption('stored')
      } else {
        setSignOption('at_property')
        setSignDescription(signItem.description || '')
      }
    } else {
      setSignOption('none')
    }

    // Riders
    const riderItems = ord.orderItems.filter(i => i.itemType === 'rider')
    const riders = riderItems
      .map(riderToSelectedRider)
      .filter((r): r is SelectedRider => r !== null)
    setSelectedRiders(riders)

    // Lockbox
    const lockboxItem = ord.orderItems.find(i => i.itemType === 'lockbox')
    if (lockboxItem) {
      const desc = lockboxItem.description?.toLowerCase() || ''
      if (lockboxItem.itemCategory === 'rental') {
        setLockboxOption('mechanical_rent')
      } else if (desc.includes('at property') || desc.includes('pickup')) {
        setLockboxOption('at_property')
        setLockboxCode(lockboxItem.customValue || '')
      } else if (desc.includes('sentrilock')) {
        setLockboxOption('sentrilock')
      } else {
        setLockboxOption('mechanical_own')
        setLockboxCode(lockboxItem.customValue || '')
      }
    } else {
      setLockboxOption('none')
    }

    // Brochure box
    const bbItem = ord.orderItems.find(i => i.itemType === 'brochure_box')
    if (bbItem) {
      if (bbItem.itemCategory === 'purchase') {
        setBrochureOption('purchase')
      } else {
        setBrochureOption('own')
      }
    } else {
      setBrochureOption('none')
    }
  }

  // Customer rider inventory derived from /api/inventory (needs to be in scope
  // before calculateNewItems uses it for inventory linking on edit)
  const customerRiderInventory = useMemo(
    () => inventory?.riders?.map(rider => ({
      id: rider.id,
      riderType: rider.rider_type,
      quantity: rider.quantity,
    })) || [],
    [inventory?.riders]
  )

  // Calculate the price for the current edited selections
  const calculateNewItems = useCallback(() => {
    const items: Array<{
      item_type: string
      item_category?: string
      description: string
      quantity: number
      unit_price: number
      total_price: number
      customer_sign_id?: string
      customer_rider_id?: string
      customer_lockbox_id?: string
      customer_brochure_box_id?: string
      custom_value?: string
    }> = []

    // Preserve inventory links from the original order so editing doesn't
    // strip the customer_xxx_id off line items (which is what caused the
    // "inventory not auto-removing" bug for edited orders)
    const origSignItem = order?.orderItems.find(i => i.itemType === 'sign')
    const origLockboxItem = order?.orderItems.find(i => i.itemType === 'lockbox')
    const origBrochureItem = order?.orderItems.find(i => i.itemType === 'brochure_box')
    const origRiderItems = order?.orderItems.filter(i => i.itemType === 'rider') || []

    // Sign
    if (signOption === 'stored') {
      items.push({
        item_type: 'sign',
        item_category: 'storage',
        description: 'Sign Install (from storage)',
        customer_sign_id: origSignItem?.customerSignId || undefined,
        quantity: 1,
        unit_price: PRICING.sign_install,
        total_price: PRICING.sign_install,
      })
    } else if (signOption === 'at_property') {
      items.push({
        item_type: 'sign',
        item_category: 'owned',
        description: 'Sign Install',
        quantity: 1,
        unit_price: PRICING.sign_install,
        total_price: PRICING.sign_install,
      })
    }

    // Riders
    selectedRiders.forEach((selected) => {
      items.push(selectedRiderToItem(selected, origRiderItems, customerRiderInventory))
    })

    // Lockbox — preserve the customer_lockbox_id if the option matches
    if (lockboxOption === 'sentrilock') {
      items.push({
        item_type: 'lockbox',
        item_category: 'owned',
        description: 'SentriLock Install',
        customer_lockbox_id: origLockboxItem?.customerLockboxId || undefined,
        quantity: 1,
        unit_price: PRICING.lockbox_install,
        total_price: PRICING.lockbox_install,
      })
    } else if (lockboxOption === 'mechanical_own') {
      items.push({
        item_type: 'lockbox',
        item_category: 'owned',
        description: 'Mechanical Lockbox Install',
        customer_lockbox_id: origLockboxItem?.customerLockboxId || undefined,
        quantity: 1,
        unit_price: PRICING.lockbox_install,
        total_price: PRICING.lockbox_install,
      })
    } else if (lockboxOption === 'at_property') {
      items.push({
        item_type: 'lockbox',
        item_category: 'owned',
        description: lockboxCode
          ? `Lockbox Install (at property / pickup) — code ${lockboxCode}`
          : 'Lockbox Install (at property / pickup)',
        quantity: 1,
        unit_price: PRICING.lockbox_install,
        total_price: PRICING.lockbox_install,
      })
    } else if (lockboxOption === 'mechanical_rent') {
      items.push({
        item_type: 'lockbox',
        item_category: 'rental',
        description: 'Mechanical Lockbox Rental',
        quantity: 1,
        unit_price: PRICING.lockbox_rental,
        total_price: PRICING.lockbox_rental,
      })
    }

    // Brochure box — preserve the customer_brochure_box_id when the customer
    // is using their own (purchase always creates a fresh one)
    if (brochureOption === 'purchase') {
      items.push({
        item_type: 'brochure_box',
        item_category: 'purchase',
        description: 'Brochure Box Purchase (includes install)',
        quantity: 1,
        unit_price: PRICING.brochure_box_purchase,
        total_price: PRICING.brochure_box_purchase,
      })
    } else if (brochureOption === 'own') {
      items.push({
        item_type: 'brochure_box',
        item_category: 'install',
        description: 'Brochure Box Install (your own)',
        customer_brochure_box_id: origBrochureItem?.customerBrochureBoxId || undefined,
        quantity: 1,
        unit_price: PRICING.brochure_box_install,
        total_price: PRICING.brochure_box_install,
      })
    }

    return items
  // origRiderItems intentionally unused here — riders preserve their IDs via riderToSelectedRider
  }, [signOption, selectedRiders, lockboxOption, lockboxCode, brochureOption, order])

  const newItems = calculateNewItems()
  // Post price from the editable selection (empty / open_house = $0)
  const postPrice = postType && postType !== 'open_house'
    ? (PRICING.posts[postType as keyof typeof PRICING.posts] ?? 0)
    : 0
  const newItemsTotal = newItems.reduce((sum, item) => sum + item.total_price, 0)
  const newSubtotal = postPrice + newItemsTotal

  // Use order's existing fees (fuel surcharge not re-charged)
  const fuelSurcharge = order ? Number(order.fuelSurcharge) : PRICING.fuel_surcharge
  // No-post surcharge recomputes live as the post selection changes
  const hasPost = !!postType && postType !== 'open_house'
  const noPostSurcharge = postType === '' ? PRICING.no_post_surcharge : (hasPost ? 0 : 0)
  const expediteFee = order ? Number(order.expediteFee) : 0
  const discount = order ? Number(order.discount) : 0

  const discountedSubtotal = Math.max(0, newSubtotal - discount)
  const taxableAmount = discountedSubtotal + expediteFee + noPostSurcharge
  const tax = Math.round(taxableAmount * PRICING.tax_rate * 100) / 100
  const newTotal = discountedSubtotal + fuelSurcharge + expediteFee + noPostSurcharge + tax
  const originalTotal = order ? Number(order.total) : 0
  const totalDifference = newTotal - originalTotal

  const handleSave = async () => {
    if (!order) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const items = calculateNewItems()

      const res = await fetch(`/api/orders/${order.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          // Only send post_type if the user actually changed it, so unchanged
          // orders keep their existing post row untouched
          ...(postDirty ? { post_type: postType } : {}),
          sign_option: signOption,
          sign_description: signDescription,
          lockbox_option: lockboxOption,
          lockbox_code: lockboxCode,
          brochure_option: brochureOption,
          installation_notes: installationNotes,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update order')
      }

      setSaveSuccess(true)
      // Redirect to order detail after a short delay
      setTimeout(() => {
        router.push(`/dashboard/orders/${order.id}`)
      }, 1500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="Edit Order" />
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
            <p className="text-gray-500">Loading order...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div>
        <Header title="Edit Order" />
        <div className="p-6">
          <Card variant="bordered">
            <CardContent className="p-8 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">{error || 'Order not found'}</p>
              <Link href="/dashboard/order-history">
                <Button>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Order History
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const config = statusConfig[order.status] || statusConfig.pending

  return (
    <div>
      <Header title="Edit Order" />

      <div className="p-6 max-w-4xl mx-auto">
        {/* Back Link */}
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Order Details
        </Link>

        {/* Order Header */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-gray-900">
                    Edit Order {order.orderNumber}
                  </h2>
                  <Badge variant={config.variant}>{config.label}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <MapPin className="w-4 h-4 text-pink-500" />
                  <p className="text-sm text-gray-500">
                    {order.propertyAddress}, {order.propertyCity}, {order.propertyState} {order.propertyZip}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Post (editable) */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-5 h-5 text-pink-500" />
              <h3 className="font-semibold text-gray-900">Post Installation</h3>
            </div>
            <Select
              label="Post type"
              value={postType}
              onChange={(e) => { setPostType(e.target.value); setPostDirty(true) }}
              placeholder=""
              options={[
                { value: 'White Vinyl Post', label: `White Vinyl Post — $${PRICING.posts['White Vinyl Post']}` },
                { value: 'Black Vinyl Post', label: `Black Vinyl Post — $${PRICING.posts['Black Vinyl Post']}` },
                { value: 'Signature Pink Post', label: `Signature Pink Post — $${PRICING.posts['Signature Pink Post']}` },
                { value: 'Metal Frame Sign', label: `Metal Frame Sign — $${PRICING.posts['Metal Frame Sign']}` },
                { value: 'Wood Panel Post', label: `Wood Panel Post — $${PRICING.posts['Wood Panel Post']}` },
                { value: 'open_house', label: 'Open House / Wire Frame Only — $0' },
                { value: '', label: `No post needed (+$${PRICING.no_post_surcharge} trip fee)` },
              ]}
            />
            <p className="text-xs text-gray-500 mt-2">
              {postType && postType !== 'open_house'
                ? `Post: $${postPrice.toFixed(2)}`
                : postType === 'open_house'
                  ? 'No post charge — wire frames billed in riders.'
                  : `No post — a $${PRICING.no_post_surcharge} service trip fee applies.`}
            </p>
          </CardContent>
        </Card>

        {/* Sign Selection */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Sign</h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSignOption('stored')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  signOption === 'stored' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <span className="text-sm font-medium">Sign from storage</span>
                <span className="text-sm text-pink-600">${PRICING.sign_install.toFixed(2)}</span>
              </button>
              <button
                type="button"
                onClick={() => setSignOption('at_property')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  signOption === 'at_property' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <span className="text-sm font-medium">Sign at property</span>
                <span className="text-sm text-pink-600">${PRICING.sign_install.toFixed(2)}</span>
              </button>
              <button
                type="button"
                onClick={() => setSignOption('none')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  signOption === 'none' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <span className="text-sm font-medium">No sign</span>
                <span className="text-sm text-gray-500">$0.00</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Rider Selection */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Riders</h3>
            <RiderSelector
              selectedRiders={selectedRiders}
              onSelectionChange={setSelectedRiders}
              customerInventory={customerRiderInventory}
              rentalPrice={PRICING.rider_rental}
              installPrice={PRICING.rider_install}
            />
          </CardContent>
        </Card>

        {/* Lockbox Selection */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Lockbox</h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setLockboxOption('sentrilock')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  lockboxOption === 'sentrilock' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">My SentriLock</span>
                </div>
                <span className="text-sm text-pink-600">${PRICING.lockbox_install.toFixed(2)}</span>
              </button>
              <button
                type="button"
                onClick={() => setLockboxOption('mechanical_own')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  lockboxOption === 'mechanical_own' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">My Mechanical Lockbox</span>
                </div>
                <span className="text-sm text-pink-600">${PRICING.lockbox_install.toFixed(2)}</span>
              </button>
              {lockboxOption === 'mechanical_own' && (
                <div className="ml-6 p-3 bg-gray-50 rounded-lg">
                  <Input
                    label="Lockbox Code (optional)"
                    value={lockboxCode}
                    onChange={(e) => setLockboxCode(e.target.value)}
                    placeholder="e.g., 1234"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setLockboxOption('at_property')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  lockboxOption === 'at_property' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">Lockbox at property / available for pickup</span>
                </div>
                <span className="text-sm text-pink-600">${PRICING.lockbox_install.toFixed(2)}</span>
              </button>
              {lockboxOption === 'at_property' && (
                <div className="ml-6 p-3 bg-gray-50 rounded-lg">
                  <Input
                    label="Lockbox Code (optional)"
                    value={lockboxCode}
                    onChange={(e) => setLockboxCode(e.target.value)}
                    placeholder="e.g., 1234"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setLockboxOption('mechanical_rent')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  lockboxOption === 'mechanical_rent' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">Rent Mechanical Lockbox</span>
                </div>
                <span className="text-sm text-pink-600">${PRICING.lockbox_rental.toFixed(2)}</span>
              </button>
              <button
                type="button"
                onClick={() => setLockboxOption('none')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  lockboxOption === 'none' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <span className="text-sm font-medium">No lockbox</span>
                <span className="text-sm text-gray-500">$0.00</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Brochure Box Selection */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Brochure Box</h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setBrochureOption('purchase')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  brochureOption === 'purchase' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">Purchase brochure box</span>
                </div>
                <span className="text-sm text-pink-600">${PRICING.brochure_box_purchase.toFixed(2)}</span>
              </button>
              <button
                type="button"
                onClick={() => setBrochureOption('own')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  brochureOption === 'own' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium">Install my own brochure box</span>
                </div>
                <span className="text-sm text-pink-600">${PRICING.brochure_box_install.toFixed(2)}</span>
              </button>
              <button
                type="button"
                onClick={() => setBrochureOption('none')}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left',
                  brochureOption === 'none' ? 'border-pink-500 bg-pink-50' : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <span className="text-sm font-medium">No brochure box</span>
                <span className="text-sm text-gray-500">$0.00</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Installation Notes */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Installation Notes</h3>
            <textarea
              value={installationNotes}
              onChange={(e) => setInstallationNotes(e.target.value)}
              placeholder="Any special instructions for the installer..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent resize-y min-h-[80px]"
            />
          </CardContent>
        </Card>

        {/* Updated Price Summary */}
        <Card variant="bordered" className="mb-6">
          <CardContent className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Updated Price Summary</h3>

            <div className="space-y-2 text-sm">
              {/* Post */}
              {postType && postType !== 'open_house' && (
                <div className="flex justify-between">
                  <span className="text-gray-600">{postType} (install & pickup)</span>
                  <span className="text-gray-900">${postPrice.toFixed(2)}</span>
                </div>
              )}

              {/* New items */}
              {newItems.map((item, idx) => (
                <div key={idx} className="flex justify-between">
                  <span className="text-gray-600">{item.description}</span>
                  <span className="text-gray-900">${item.total_price.toFixed(2)}</span>
                </div>
              ))}

              <div className="border-t border-gray-200 pt-2 mt-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-900">${newSubtotal.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-${discount.toFixed(2)}</span>
                  </div>
                )}
                {fuelSurcharge > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Fuel Surcharge</span>
                    <span className="text-gray-900">${fuelSurcharge.toFixed(2)}</span>
                  </div>
                )}
                {noPostSurcharge > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Service Trip Fee (no post)</span>
                    <span className="text-gray-900">${noPostSurcharge.toFixed(2)}</span>
                  </div>
                )}
                {expediteFee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Expedite Fee</span>
                    <span className="text-gray-900">${expediteFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Tax (6%)</span>
                  <span className="text-gray-900">${tax.toFixed(2)}</span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-2 mt-2 flex justify-between text-lg font-bold">
                <span className="text-gray-900">New Total</span>
                <span className="text-pink-600">${newTotal.toFixed(2)}</span>
              </div>

              {totalDifference !== 0 && (
                <div className={cn(
                  'flex justify-between text-sm font-medium pt-1',
                  totalDifference > 0 ? 'text-amber-600' : 'text-green-600'
                )}>
                  <span>{totalDifference > 0 ? 'Additional charge' : 'Savings'}</span>
                  <span>{totalDifference > 0 ? '+' : '-'}${Math.abs(totalDifference).toFixed(2)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Info note about fuel surcharge */}
        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800">
            Fuel surcharge and delivery fees are not re-charged when editing an existing order.
          </p>
        </div>

        {/* Save Error */}
        {saveError && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{saveError}</p>
          </div>
        )}

        {/* Save Success */}
        {saveSuccess && (
          <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            <p className="text-sm text-green-800">Order updated successfully! Redirecting...</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Link href={`/dashboard/orders/${order.id}`} className="flex-1">
            <Button variant="outline" className="w-full">
              Cancel
            </Button>
          </Link>
          <Button
            onClick={handleSave}
            disabled={saving || saveSuccess}
            className="flex-1"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving Changes...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
