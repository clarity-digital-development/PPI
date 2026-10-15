import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const installation = await prisma.installation.findFirst({
      where: { id, userId: user.id },
      include: {
        order: {
          include: {
            postType: true,
            orderItems: true,
          },
        },
        riders: {
          include: {
            rider: true,
          },
        },
        lockboxes: {
          include: {
            lockboxType: true,
          },
        },
      },
    })

    // Fetch service requests separately - table may not exist if migration hasn't run
    let serviceRequests: any[] = []
    try {
      if (installation) {
        serviceRequests = await prisma.serviceRequest.findMany({
          where: { installationId: id },
          orderBy: { createdAt: 'desc' },
          // The office's notes are for the crew, not the customer.
          omit: { adminNotes: true },
        })
      }
    } catch {
      // Table may not exist yet
      serviceRequests = []
    }

    // Add serviceRequests to installation object
    const installationWithRequests = installation ? {
      ...installation,
      serviceRequests,
    } : null

    if (!installationWithRequests) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }

    return NextResponse.json({ installation: installationWithRequests })
  } catch (error) {
    console.error('Error fetching installation:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
