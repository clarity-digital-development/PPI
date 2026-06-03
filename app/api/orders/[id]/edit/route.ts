import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { orderItemSchema } from '@/lib/validations'
import { validateScheduling } from '@/lib/scheduling'
import { z } from 'zod'

// Full edit payload. The order is rebuilt from this (mirrors order creation),
// but is NOT re-charged — the existing payment intent, fuel surcharge and any
// applied promo code are preserved. Property/scheduling fields are optional and
// fall back to the existing order when omitted so partial payloads can't wipe
// data.
const editOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
  // Post: a post type name, 'open_house', or 'none'/'' (no post).
  post_type: z.string().optional(),
  // Property
  property_type: z.string().optional(),
  property_address: z.string().optional(),
  property_city: z.string().optional(),
  property_state: z.string().optional(),
  property_zip: z.string().optional(),
  installation_location: z.string().optional(),
  installation_location_image: z.string().optional(),
  installation_notes: z.string().optional(),
  is_gated_community: z.boolean().optional(),
  gate_code: z.string().optional(),
  has_marker_placed: z.boolean().optional(),
  sign_orientation: z.string().optional(),
  sign_orientation_other: z.string().optional(),
  // Scheduling
  requested_date: z.string().optional(),
  is_expedited: z.boolean().optional(),
})

const NO_POST_SURCHARGE = 40
const EXPEDITE_FEE = 50
const FALLBACK_TAX_RATE = 0.06

const VALID_PROPERTY_TYPES = ['residential', 'commercial', 'land', 'multi_family', 'house', 'construction', 'bare_land']

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const existingOrder = await prisma.order.findFirst({
      where: { id, userId: user.id },
      include: { orderItems: true, promoCode: true },
    })

    if (!existingOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Only allow editing non-completed, non-cancelled orders
    if (existingOrder.status === 'completed' || existingOrder.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot edit completed or cancelled orders' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const validationResult = editOrderSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const editData = validationResult.data

    // Server-side schedule gate. Only apply when the edit actually CHANGES
    // the schedule — otherwise an order placed yesterday couldn't be edited
    // today just because its original date is now in the past.
    const originalDateStr = existingOrder.scheduledDate
      ? existingOrder.scheduledDate.toISOString().slice(0, 10)
      : null
    const newDateStr = editData.requested_date ?? null
    const dateChanged = newDateStr !== originalDateStr
    const expeditedChanged = (editData.is_expedited ?? false) !== existingOrder.isExpedited
    if (dateChanged || expeditedChanged) {
      const scheduleCheck = validateScheduling({
        requestedDate: newDateStr,
        isExpedited: editData.is_expedited ?? existingOrder.isExpedited,
      })
      if (!scheduleCheck.ok) {
        return NextResponse.json(
          { error: scheduleCheck.error, code: scheduleCheck.code },
          { status: 400 }
        )
      }
    }

    // ---- Resolve the post ----
    // post_type is always sent in full-edit mode: a post name, 'open_house', or
    // 'none'/'' for no post (service trip fee applies).
    let newPostTypeId: string | null = null
    let noPostSurcharge = 0
    const pt = editData.post_type
    if (!pt || pt === 'none') {
      newPostTypeId = null
      noPostSurcharge = NO_POST_SURCHARGE
    } else if (pt === 'open_house') {
      newPostTypeId = null
      noPostSurcharge = 0
    } else {
      const postType = await prisma.postType.findFirst({ where: { name: pt } })
      if (!postType) {
        return NextResponse.json({ error: `Invalid post type: ${pt}` }, { status: 400 })
      }
      newPostTypeId = postType.id
      noPostSurcharge = 0
    }

    // ---- Recompute pricing (no re-charge) ----
    const newSubtotal = editData.items.reduce((sum, item) => sum + item.total_price, 0)

    // Fuel surcharge is preserved from the existing order (never re-charged).
    const fuelSurcharge = Number(existingOrder.fuelSurcharge)
    // Expedite fee follows the (editable) scheduling selection.
    const expediteFee = editData.is_expedited ? EXPEDITE_FEE : 0

    // Recompute discount from the order's existing promo code (promo can't be
    // changed during an edit).
    let discount = 0
    if (existingOrder.promoCode && existingOrder.promoCode.isActive) {
      if (existingOrder.promoCode.discountType === 'percentage') {
        discount = newSubtotal * (Number(existingOrder.promoCode.discountValue) / 100)
      } else {
        discount = Math.min(Number(existingOrder.promoCode.discountValue), newSubtotal)
      }
      discount = Math.round(discount * 100) / 100
    }

    const discountedSubtotal = Math.max(0, newSubtotal - discount)
    const taxableAmount = discountedSubtotal + expediteFee + noPostSurcharge
    const tax = Math.round(taxableAmount * FALLBACK_TAX_RATE * 100) / 100
    const total = discountedSubtotal + fuelSurcharge + expediteFee + noPostSurcharge + tax

    // ---- Inventory bookkeeping ----
    // All existing line items are being replaced. Restore any inventory they
    // referenced back to inStorage:true, UNLESS the new items reference them too
    // (then they stay out). Then lock everything the new items reference.
    const newSignIds = new Set(editData.items.map(i => i.customer_sign_id).filter(Boolean) as string[])
    const newRiderIds = new Set(editData.items.map(i => i.customer_rider_id).filter(Boolean) as string[])
    const newLockboxIds = new Set(editData.items.map(i => i.customer_lockbox_id).filter(Boolean) as string[])
    const newBrochureIds = new Set(editData.items.map(i => i.customer_brochure_box_id).filter(Boolean) as string[])

    const idsToRestore = {
      signs: existingOrder.orderItems.map(i => i.customerSignId).filter((x): x is string => !!x && !newSignIds.has(x)),
      riders: existingOrder.orderItems.map(i => i.customerRiderId).filter((x): x is string => !!x && !newRiderIds.has(x)),
      lockboxes: existingOrder.orderItems.map(i => i.customerLockboxId).filter((x): x is string => !!x && !newLockboxIds.has(x)),
      brochureBoxes: existingOrder.orderItems.map(i => i.customerBrochureBoxId).filter((x): x is string => !!x && !newBrochureIds.has(x)),
    }

    // Resolve property fields, falling back to the existing order when omitted.
    const propertyType = editData.property_type ?? existingOrder.propertyType
    if (!VALID_PROPERTY_TYPES.includes(propertyType)) {
      return NextResponse.json({ error: `Invalid property type: ${propertyType}` }, { status: 400 })
    }

    const scheduledDate = editData.requested_date
      ? new Date(editData.requested_date + 'T12:00:00Z')
      : null

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Replace ALL line items (the post is included in items[] as item_type
      // 'post', mirroring order creation)
      await tx.orderItem.deleteMany({ where: { orderId: id } })

      await tx.orderItem.createMany({
        data: editData.items.map((item) => ({
          orderId: id,
          itemType: item.item_type,
          itemCategory: item.item_category || null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          totalPrice: item.total_price,
          customerSignId: item.customer_sign_id || null,
          customerRiderId: item.customer_rider_id || null,
          customerLockboxId: item.customer_lockbox_id || null,
          customerBrochureBoxId: item.customer_brochure_box_id || null,
          customValue: item.custom_value || null,
        })),
      })

      // Restore inventory referenced only by the OLD order
      if (idsToRestore.signs.length)
        await tx.customerSign.updateMany({ where: { id: { in: idsToRestore.signs } }, data: { inStorage: true } })
      if (idsToRestore.riders.length)
        await tx.customerRider.updateMany({ where: { id: { in: idsToRestore.riders } }, data: { inStorage: true } })
      if (idsToRestore.lockboxes.length)
        await tx.customerLockbox.updateMany({ where: { id: { in: idsToRestore.lockboxes } }, data: { inStorage: true } })
      if (idsToRestore.brochureBoxes.length)
        await tx.customerBrochureBox.updateMany({ where: { id: { in: idsToRestore.brochureBoxes } }, data: { inStorage: true } })

      // Lock inventory referenced by the NEW order (idempotent)
      if (newSignIds.size)
        await tx.customerSign.updateMany({ where: { id: { in: Array.from(newSignIds) } }, data: { inStorage: false } })
      if (newRiderIds.size)
        await tx.customerRider.updateMany({ where: { id: { in: Array.from(newRiderIds) } }, data: { inStorage: false } })
      if (newLockboxIds.size)
        await tx.customerLockbox.updateMany({ where: { id: { in: Array.from(newLockboxIds) } }, data: { inStorage: false } })
      if (newBrochureIds.size)
        await tx.customerBrochureBox.updateMany({ where: { id: { in: Array.from(newBrochureIds) } }, data: { inStorage: false } })

      const order = await tx.order.update({
        where: { id },
        data: {
          postTypeId: newPostTypeId,
          // Property
          propertyType: propertyType as never,
          propertyAddress: editData.property_address ?? existingOrder.propertyAddress,
          propertyCity: editData.property_city ?? existingOrder.propertyCity,
          propertyState: editData.property_state ?? existingOrder.propertyState,
          propertyZip: editData.property_zip ?? existingOrder.propertyZip,
          installationLocation: editData.installation_location ?? existingOrder.installationLocation,
          installationLocationImage: editData.installation_location_image ?? existingOrder.installationLocationImage,
          propertyNotes: editData.installation_notes ?? existingOrder.propertyNotes,
          isGatedCommunity: editData.is_gated_community ?? existingOrder.isGatedCommunity,
          gateCode: editData.gate_code ?? existingOrder.gateCode,
          hasMarkerPlaced: editData.has_marker_placed ?? existingOrder.hasMarkerPlaced,
          signOrientation: editData.sign_orientation ?? existingOrder.signOrientation,
          signOrientationOther: editData.sign_orientation_other ?? existingOrder.signOrientationOther,
          // Scheduling
          scheduledDate,
          isExpedited: editData.is_expedited ?? existingOrder.isExpedited,
          // Pricing
          subtotal: newSubtotal,
          noPostSurcharge,
          expediteFee,
          discount,
          tax,
          total,
        },
        include: { orderItems: true, postType: true },
      })

      return order
    })

    console.log(
      `Edited order ${updatedOrder.orderNumber}: restored ${idsToRestore.signs.length} signs, ${idsToRestore.riders.length} riders, ${idsToRestore.lockboxes.length} lockboxes, ${idsToRestore.brochureBoxes.length} brochures; locked ${newSignIds.size} signs, ${newRiderIds.size} riders, ${newLockboxIds.size} lockboxes, ${newBrochureIds.size} brochures; new total $${total.toFixed(2)}`
    )

    return NextResponse.json({ order: updatedOrder })
  } catch (error) {
    console.error('Error editing order:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorDetails = process.env.NODE_ENV !== 'production' ? errorMessage : 'Internal server error'
    return NextResponse.json({ error: errorDetails }, { status: 500 })
  }
}
