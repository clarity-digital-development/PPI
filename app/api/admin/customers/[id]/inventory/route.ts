import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { type, ...data } = body

    if (!type) {
      return NextResponse.json({ error: 'Type is required' }, { status: 400 })
    }

    const quantity = Math.max(1, parseInt(data.quantity) || 1)
    let result

    switch (type) {
      case 'sign': {
        if (!data.description) {
          return NextResponse.json({ error: 'Description is required' }, { status: 400 })
        }
        const signData = Array.from({ length: quantity }, () => ({
          userId: customerId,
          description: data.description,
          imageUrl: data.image_url,
          inStorage: data.in_storage ?? true,
        }))
        if (quantity === 1) {
          result = await prisma.customerSign.create({ data: signData[0] })
        } else {
          result = await prisma.customerSign.createMany({ data: signData })
        }
        break
      }
      case 'rider': {
        // Look up or create rider by name/type
        let riderId = data.rider_id
        if (!riderId && data.rider_type) {
          let rider = await prisma.riderCatalog.findFirst({
            where: { name: { equals: data.rider_type, mode: 'insensitive' } },
          })
          if (!rider) {
            rider = await prisma.riderCatalog.create({
              data: {
                name: data.rider_type,
                rentalPrice: 5.00,
              },
            })
          }
          riderId = rider.id
        }
        if (!riderId) {
          return NextResponse.json({ error: 'Rider type is required' }, { status: 400 })
        }
        const riderData = Array.from({ length: quantity }, () => ({
          userId: customerId,
          riderId: riderId,
          isOwned: data.is_owned ?? true,
          inStorage: data.in_storage ?? true,
        }))
        if (quantity === 1) {
          result = await prisma.customerRider.create({ data: riderData[0] })
        } else {
          result = await prisma.customerRider.createMany({ data: riderData })
        }
        break
      }
      case 'lockbox': {
        // Look up lockbox type by name if ID not provided
        let lockboxTypeId = data.lockbox_type_id
        if (!lockboxTypeId && data.lockbox_type) {
          // Map common frontend values to DB names
          const typeNameMap: Record<string, string> = {
            sentrilock: 'SentriLock',
            mechanical: 'Mechanical (Customer Owned)',
            mechanical_own: 'Mechanical (Customer Owned)',
            mechanical_rent: 'Mechanical (Rental)',
          }
          const dbName = typeNameMap[data.lockbox_type.toLowerCase()] || data.lockbox_type

          let lockboxType = await prisma.lockboxType.findFirst({
            where: { name: dbName },
          })
          // Fallback: try case-insensitive search
          if (!lockboxType) {
            lockboxType = await prisma.lockboxType.findFirst({
              where: { name: { equals: data.lockbox_type, mode: 'insensitive' } },
            })
          }
          if (lockboxType) {
            lockboxTypeId = lockboxType.id
          } else {
            // List available types for debugging
            const availableTypes = await prisma.lockboxType.findMany({ select: { name: true } })
            console.error('Lockbox type not found:', data.lockbox_type, 'Available:', availableTypes.map(t => t.name))
            return NextResponse.json({
              error: `Invalid lockbox type "${data.lockbox_type}". Available types: ${availableTypes.map(t => t.name).join(', ')}`,
            }, { status: 400 })
          }
        }
        if (!lockboxTypeId) {
          return NextResponse.json({ error: 'Lockbox type is required' }, { status: 400 })
        }
        const lockboxData = Array.from({ length: quantity }, () => ({
          userId: customerId,
          lockboxTypeId: lockboxTypeId!,
          serialNumber: data.serial_number,
          code: data.lockbox_code || data.code,
          isOwned: data.is_owned ?? true,
          inStorage: data.in_storage ?? true,
        }))
        if (quantity === 1) {
          result = await prisma.customerLockbox.create({ data: lockboxData[0] })
        } else {
          result = await prisma.customerLockbox.createMany({ data: lockboxData })
        }
        break
      }
      case 'brochure_box': {
        const brochureData = Array.from({ length: quantity }, () => ({
          userId: customerId,
          description: data.description,
          inStorage: data.in_storage ?? true,
        }))
        if (quantity === 1) {
          result = await prisma.customerBrochureBox.create({ data: brochureData[0] })
        } else {
          result = await prisma.customerBrochureBox.createMany({ data: brochureData })
        }
        break
      }
      case 'other': {
        if (!data.description) {
          return NextResponse.json({ error: 'Description is required' }, { status: 400 })
        }
        result = await prisma.customerOtherItem.create({
          data: { userId: customerId, description: data.description },
        })
        break
      }
      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    return NextResponse.json({ item: result, quantity }, { status: 201 })
  } catch (error) {
    console.error('Error adding inventory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { type, item_id, quantity, action } = body

    if (!type || !item_id) {
      return NextResponse.json({ error: 'Type and item_id are required' }, { status: 400 })
    }

    // Return a previously-deployed item back to storage (item_id is the specific record id)
    if (action === 'return_to_storage') {
      switch (type) {
        case 'sign':
          await prisma.customerSign.update({ where: { id: item_id, userId: customerId }, data: { inStorage: true } })
          break
        case 'rider':
          await prisma.customerRider.update({ where: { id: item_id, userId: customerId }, data: { inStorage: true } })
          break
        case 'lockbox':
          await prisma.customerLockbox.update({ where: { id: item_id, userId: customerId }, data: { inStorage: true } })
          break
        case 'brochure_box':
          await prisma.customerBrochureBox.update({ where: { id: item_id, userId: customerId }, data: { inStorage: true } })
          break
        default:
          return NextResponse.json({ error: 'Invalid type for return_to_storage' }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    const newQuantity = Math.max(0, parseInt(quantity) || 0)

    // For riders: item_id is the riderId (catalog), adjust record count
    // For signs: item_id is the specific sign record (signs are unique, so quantity doesn't apply the same way)
    // For lockboxes: item_id is the lockboxTypeId, adjust record count
    switch (type) {
      case 'rider': {
        // Get current count of this rider type for this customer
        const existingRiders = await prisma.customerRider.findMany({
          where: { userId: customerId, riderId: item_id, inStorage: true },
          orderBy: { createdAt: 'desc' },
        })
        const currentCount = existingRiders.length
        const diff = newQuantity - currentCount

        if (diff > 0) {
          // Add more
          await prisma.customerRider.createMany({
            data: Array.from({ length: diff }, () => ({
              userId: customerId,
              riderId: item_id,
              isOwned: true,
              inStorage: true,
            })),
          })
        } else if (diff < 0) {
          // Remove extras (delete the most recent ones first)
          const toDelete = existingRiders.slice(0, Math.abs(diff))
          await prisma.customerRider.deleteMany({
            where: { id: { in: toDelete.map(r => r.id) } },
          })
        }
        break
      }
      case 'lockbox': {
        const existingLockboxes = await prisma.customerLockbox.findMany({
          where: { userId: customerId, lockboxTypeId: item_id, inStorage: true },
          orderBy: { createdAt: 'desc' },
        })
        const currentCount = existingLockboxes.length
        const diff = newQuantity - currentCount

        if (diff > 0) {
          await prisma.customerLockbox.createMany({
            data: Array.from({ length: diff }, () => ({
              userId: customerId,
              lockboxTypeId: item_id,
              isOwned: true,
              inStorage: true,
            })),
          })
        } else if (diff < 0) {
          const toDelete = existingLockboxes.slice(0, Math.abs(diff))
          await prisma.customerLockbox.deleteMany({
            where: { id: { in: toDelete.map(lb => lb.id) } },
          })
        }
        break
      }
      default:
        return NextResponse.json({ error: 'Quantity update only supported for riders and lockboxes' }, { status: 400 })
    }

    return NextResponse.json({ success: true, quantity: newQuantity })
  } catch (error) {
    console.error('Error updating inventory quantity:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const itemId = searchParams.get('item_id')

    if (!type || !itemId) {
      return NextResponse.json(
        { error: 'Type and item_id are required' },
        { status: 400 }
      )
    }

    switch (type) {
      case 'sign':
        await prisma.customerSign.delete({
          where: { id: itemId, userId: customerId },
        })
        break
      case 'rider':
        await prisma.customerRider.delete({
          where: { id: itemId, userId: customerId },
        })
        break
      case 'lockbox':
        await prisma.customerLockbox.delete({
          where: { id: itemId, userId: customerId },
        })
        break
      case 'brochure_box':
        await prisma.customerBrochureBox.delete({
          where: { id: itemId, userId: customerId },
        })
        break
      case 'other':
        await prisma.customerOtherItem.delete({
          where: { id: itemId, userId: customerId },
        })
        break
      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting inventory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
