import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { z } from 'zod'

const editOrderItemSchema = z.object({
  item_type: z.enum(['sign', 'rider', 'lockbox', 'brochure_box']),
  item_category: z.string().optional(),
  description: z.string(),
  quantity: z.number().min(1).default(1),
  unit_price: z.number().min(0),
  total_price: z.number().min(0),
  // IDs are Prisma CUIDs (not UUIDs) — accept any non-empty string
  customer_sign_id: z.string().optional(),
  customer_rider_id: z.string().optional(),
  customer_lockbox_id: z.string().optional(),
  customer_brochure_box_id: z.string().optional(),
  custom_value: z.string().optional(),
})

const editOrderSchema = z.object({
  items: z.array(editOrderItemSchema),
  // Sign options
  sign_option: z.enum(['stored', 'at_property', 'none']).optional(),
  stored_sign_id: z.string().optional(),
  sign_description: z.string().optional(),
  // Lockbox options
  lockbox_option: z.enum(['sentrilock', 'mechanical_own', 'mechanical_rent', 'none']).optional(),
  lockbox_code: z.string().optional(),
  // Brochure box options
  brochure_option: z.enum(['purchase', 'own', 'none']).optional(),
  // Installation notes
  installation_notes: z.string().optional(),
})

const FUEL_SURCHARGE = 2.47
const FALLBACK_TAX_RATE = 0.06

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

    // Get the existing order
    const existingOrder = await prisma.order.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        orderItems: true,
        promoCode: true,
      },
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

    // Keep existing post item, replace everything else
    const existingPostItem = existingOrder.orderItems.find(item => item.itemType === 'post')

    // Calculate new subtotal from all items (existing post + new items)
    let newSubtotal = 0
    if (existingPostItem) {
      newSubtotal += Number(existingPostItem.totalPrice)
    }
    for (const item of editData.items) {
      newSubtotal += item.total_price
    }

    // Re-use existing order's fuel surcharge (don't double-charge)
    const fuelSurcharge = Number(existingOrder.fuelSurcharge)
    const noPostSurcharge = Number(existingOrder.noPostSurcharge)
    const expediteFee = Number(existingOrder.expediteFee)

    // Re-calculate discount if promo code exists
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

    // Collect inventory IDs from the OLD line items (about to be deleted) so we
    // can restore those records back to inStorage:true — unless they're also
    // referenced in the NEW items (in which case they should stay out).
    const oldNonPostItems = existingOrder.orderItems.filter(i => i.itemType !== 'post')
    const newSignIds = new Set(editData.items.map(i => i.customer_sign_id).filter(Boolean) as string[])
    const newRiderIds = new Set(editData.items.map(i => i.customer_rider_id).filter(Boolean) as string[])
    const newLockboxIds = new Set(editData.items.map(i => i.customer_lockbox_id).filter(Boolean) as string[])
    const newBrochureIds = new Set(editData.items.map(i => i.customer_brochure_box_id).filter(Boolean) as string[])

    const idsToRestore = {
      signs: oldNonPostItems.map(i => i.customerSignId).filter((id): id is string => !!id && !newSignIds.has(id)),
      riders: oldNonPostItems.map(i => i.customerRiderId).filter((id): id is string => !!id && !newRiderIds.has(id)),
      lockboxes: oldNonPostItems.map(i => i.customerLockboxId).filter((id): id is string => !!id && !newLockboxIds.has(id)),
      brochureBoxes: oldNonPostItems.map(i => i.customerBrochureBoxId).filter((id): id is string => !!id && !newBrochureIds.has(id)),
    }

    // Update order in a transaction (atomic: items + inventory both update or neither)
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Delete non-post items (we keep the post item untouched)
      await tx.orderItem.deleteMany({
        where: {
          orderId: id,
          itemType: { not: 'post' },
        },
      })

      // Create new items
      if (editData.items.length > 0) {
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
      }

      // Restore inventory items that were on the OLD order but not the NEW order
      // (back to inStorage:true so they can be selected again)
      if (idsToRestore.signs.length)
        await tx.customerSign.updateMany({ where: { id: { in: idsToRestore.signs } }, data: { inStorage: true } })
      if (idsToRestore.riders.length)
        await tx.customerRider.updateMany({ where: { id: { in: idsToRestore.riders } }, data: { inStorage: true } })
      if (idsToRestore.lockboxes.length)
        await tx.customerLockbox.updateMany({ where: { id: { in: idsToRestore.lockboxes } }, data: { inStorage: true } })
      if (idsToRestore.brochureBoxes.length)
        await tx.customerBrochureBox.updateMany({ where: { id: { in: idsToRestore.brochureBoxes } }, data: { inStorage: true } })

      // Mark inventory items referenced by the NEW order as inStorage:false
      // (idempotent — already-out items just stay out)
      if (newSignIds.size)
        await tx.customerSign.updateMany({ where: { id: { in: Array.from(newSignIds) } }, data: { inStorage: false } })
      if (newRiderIds.size)
        await tx.customerRider.updateMany({ where: { id: { in: Array.from(newRiderIds) } }, data: { inStorage: false } })
      if (newLockboxIds.size)
        await tx.customerLockbox.updateMany({ where: { id: { in: Array.from(newLockboxIds) } }, data: { inStorage: false } })
      if (newBrochureIds.size)
        await tx.customerBrochureBox.updateMany({ where: { id: { in: Array.from(newBrochureIds) } }, data: { inStorage: false } })

      // Update order totals and notes
      const order = await tx.order.update({
        where: { id },
        data: {
          subtotal: newSubtotal,
          discount,
          tax,
          total,
          propertyNotes: editData.installation_notes !== undefined
            ? editData.installation_notes
            : existingOrder.propertyNotes,
        },
        include: {
          orderItems: true,
          postType: true,
        },
      })

      return order
    })

    console.log(
      `Edited order ${updatedOrder.orderNumber}: restored ${idsToRestore.signs.length} signs, ${idsToRestore.riders.length} riders, ${idsToRestore.lockboxes.length} lockboxes, ${idsToRestore.brochureBoxes.length} brochures; locked ${newSignIds.size} signs, ${newRiderIds.size} riders, ${newLockboxIds.size} lockboxes, ${newBrochureIds.size} brochures`
    )

    return NextResponse.json({ order: updatedOrder })
  } catch (error) {
    console.error('Error editing order:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorDetails = process.env.NODE_ENV !== 'production' ? errorMessage : 'Internal server error'
    return NextResponse.json({ error: errorDetails }, { status: 500 })
  }
}
