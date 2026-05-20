import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { removal_date } = body

    if (!removal_date) {
      return NextResponse.json(
        { error: 'Removal date is required' },
        { status: 400 }
      )
    }

    // Get the installation
    const installation = await prisma.installation.findFirst({
      where: { id, userId: user.id },
    })

    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }

    if (installation.status !== 'active') {
      return NextResponse.json(
        { error: 'Can only schedule removal for active installations' },
        { status: 400 }
      )
    }

    const updated = await prisma.installation.update({
      where: { id },
      data: {
        status: 'removal_scheduled',
        removalDate: new Date(removal_date + 'T12:00:00Z'),
      },
    })

    return NextResponse.json({ installation: updated })
  } catch (error) {
    console.error('Error scheduling removal:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
