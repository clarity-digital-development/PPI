import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const type = searchParams.get('type') || ''

    // Get summary counts
    const [signCount, riderCount, lockboxCount, brochureBoxCount] = await Promise.all([
      prisma.customerSign.count({ where: { inStorage: true } }),
      prisma.customerRider.count({ where: { inStorage: true } }),
      prisma.customerLockbox.count({ where: { inStorage: true } }),
      prisma.customerBrochureBox.count({ where: { inStorage: true } }),
    ])

    // Build items based on filter
    const items: Array<{
      id: string
      type: 'sign' | 'rider' | 'lockbox' | 'brochure_box'
      description: string
      customer_id: string
      customer_name: string
      in_storage: boolean
      created_at: string
      quantity: number
    }> = []

    // Identical rows (same type + customer + description + storage state) collapse
    // onto one row with a quantity count so the global list isn't a wall of dupes.
    // Lockboxes are excluded because each has a unique code/serial — grouping would
    // hide that. `id` keeps the most-recent row so the "Manage" link still works.
    const groupKey = (
      type: 'sign' | 'rider' | 'brochure_box',
      customerId: string,
      description: string,
      inStorage: boolean,
    ) => `${type}::${customerId}::${description}::${inStorage ? 1 : 0}`
    const buckets = new Map<string, (typeof items)[number]>()
    const pushOrIncrement = (row: (typeof items)[number]) => {
      // Lockbox rows are unique per-record; never bucket.
      if (row.type === 'lockbox') {
        items.push(row)
        return
      }
      const key = groupKey(row.type, row.customer_id, row.description, row.in_storage)
      const existing = buckets.get(key)
      if (existing) {
        existing.quantity += 1
        // Prefer the freshest created_at + id so the Manage link points at a real row.
        if (row.created_at > existing.created_at) {
          existing.created_at = row.created_at
          existing.id = row.id
        }
      } else {
        buckets.set(key, row)
        items.push(row)
      }
    }

    // Fetch signs
    if (!type || type === 'sign') {
      const signs = await prisma.customerSign.findMany({
        where: {
          ...(search
            ? {
                OR: [
                  { description: { contains: search, mode: 'insensitive' } },
                  { user: { fullName: { contains: search, mode: 'insensitive' } } },
                  { user: { email: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: {
          user: { select: { id: true, fullName: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      signs.forEach((sign) => {
        pushOrIncrement({
          id: sign.id,
          type: 'sign',
          description: sign.description,
          customer_id: sign.user.id,
          customer_name: sign.user.fullName || sign.user.name || sign.user.email,
          in_storage: sign.inStorage,
          created_at: sign.createdAt.toISOString(),
          quantity: 1,
        })
      })
    }

    // Fetch riders
    if (!type || type === 'rider') {
      const riders = await prisma.customerRider.findMany({
        where: {
          ...(search
            ? {
                OR: [
                  { rider: { name: { contains: search, mode: 'insensitive' } } },
                  { user: { fullName: { contains: search, mode: 'insensitive' } } },
                  { user: { email: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: {
          user: { select: { id: true, fullName: true, name: true, email: true } },
          rider: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      riders.forEach((rider) => {
        pushOrIncrement({
          id: rider.id,
          type: 'rider',
          description: rider.rider.name,
          customer_id: rider.user.id,
          customer_name: rider.user.fullName || rider.user.name || rider.user.email,
          in_storage: rider.inStorage,
          created_at: rider.createdAt.toISOString(),
          quantity: 1,
        })
      })
    }

    // Fetch lockboxes
    if (!type || type === 'lockbox') {
      const lockboxes = await prisma.customerLockbox.findMany({
        where: {
          ...(search
            ? {
                OR: [
                  { lockboxType: { name: { contains: search, mode: 'insensitive' } } },
                  { user: { fullName: { contains: search, mode: 'insensitive' } } },
                  { user: { email: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: {
          user: { select: { id: true, fullName: true, name: true, email: true } },
          lockboxType: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      lockboxes.forEach((lockbox) => {
        pushOrIncrement({
          id: lockbox.id,
          type: 'lockbox',
          description: `${lockbox.lockboxType.name}${lockbox.code ? ` (Code: ${lockbox.code})` : ''}`,
          customer_id: lockbox.user.id,
          customer_name: lockbox.user.fullName || lockbox.user.name || lockbox.user.email,
          in_storage: lockbox.inStorage,
          created_at: lockbox.createdAt.toISOString(),
          quantity: 1,
        })
      })
    }

    // Fetch brochure boxes
    if (!type || type === 'brochure_box') {
      const brochureBoxes = await prisma.customerBrochureBox.findMany({
        where: {
          ...(search
            ? {
                OR: [
                  { description: { contains: search, mode: 'insensitive' } },
                  { user: { fullName: { contains: search, mode: 'insensitive' } } },
                  { user: { email: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        include: {
          user: { select: { id: true, fullName: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      brochureBoxes.forEach((box) => {
        pushOrIncrement({
          id: box.id,
          type: 'brochure_box',
          description: box.description || 'Brochure Box',
          customer_id: box.user.id,
          customer_name: box.user.fullName || box.user.name || box.user.email,
          in_storage: box.inStorage,
          created_at: box.createdAt.toISOString(),
          quantity: 1,
        })
      })
    }

    // Sort by created_at descending
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({
      items,
      summary: {
        signs: signCount,
        riders: riderCount,
        lockboxes: lockboxCount,
        brochureBoxes: brochureBoxCount,
      },
    })
  } catch (error) {
    console.error('Error fetching inventory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
