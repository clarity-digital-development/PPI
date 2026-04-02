import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all inventory types in parallel
    const [rawSigns, rawRiders, rawLockboxes, rawBrochureBoxes] = await Promise.all([
      prisma.customerSign.findMany({
        where: { userId: user.id, inStorage: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customerRider.findMany({
        where: { userId: user.id, inStorage: true },
        include: { rider: true },
      }),
      prisma.customerLockbox.findMany({
        where: { userId: user.id, inStorage: true },
        include: { lockboxType: true },
      }),
      prisma.customerBrochureBox.findMany({
        where: { userId: user.id, inStorage: true },
      }),
    ])

    // Transform signs to expected format
    const signs = rawSigns.map(sign => ({
      id: sign.id,
      description: sign.description,
      size: null, // Not tracked in current schema
    }))

    // Aggregate riders by type with quantity counts
    const riderCounts: Record<string, { id: string; rider_type: string; quantity: number }> = {}
    for (const rider of rawRiders) {
      const riderType = rider.rider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '')
      if (riderCounts[riderType]) {
        riderCounts[riderType].quantity += 1
      } else {
        riderCounts[riderType] = {
          id: rider.id,
          rider_type: riderType,
          quantity: 1,
        }
      }
    }
    const riders = Object.values(riderCounts)

    // Transform lockboxes to expected format
    const lockboxes = rawLockboxes.map(lockbox => ({
      id: lockbox.id,
      lockbox_type: lockbox.lockboxType.name.toLowerCase().replace(/\s+/g, '-'),
      lockbox_code: lockbox.code,
    }))

    // Aggregate brochure boxes into quantity
    const brochureBoxes = rawBrochureBoxes.length > 0
      ? { quantity: rawBrochureBoxes.length }
      : null

    return NextResponse.json({
      signs,
      riders,
      lockboxes,
      brochureBoxes,
    })
  } catch (error) {
    console.error('Error fetching inventory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
