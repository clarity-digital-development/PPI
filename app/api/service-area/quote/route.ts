import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-utils'
import { resolveServiceArea } from '@/lib/service-area'

/**
 * GET /api/service-area/quote?zip=XXXXX
 *
 * Returns the resolved service-area tier (+ surcharge) for the authenticated
 * user's effective wallet identity at the given ZIP. Used by the review-step
 * cart preview so the surcharge line is shown to the customer BEFORE submit —
 * the order POST handler still re-runs resolveServiceArea() as source of truth
 * (defense in depth — the client cannot fake exemption or zero the surcharge).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const zip = searchParams.get('zip')
    if (!zip || !/^\d{5}$/.test(zip.trim().slice(0, 5))) {
      return NextResponse.json({ error: 'Invalid ZIP code' }, { status: 400 })
    }

    const sa = await resolveServiceArea({
      zip,
      // WHY: cart preview always quotes against the LOGGED-IN user's tier — same input as order POST.
      user: {
        id: user.id,
        role: user.role,
        isServiceAreaExempt: user.isServiceAreaExempt ?? false,
      },
    })

    const body: {
      tier: 'standard' | 'surcharge' | 'out_of_area' | 'exempt'
      surchargeCents: number
      centerName?: string
      driveTimeMinutes?: number
      contactPhone?: string
      reason?: string
    } = {
      tier: sa.tier,
      surchargeCents: sa.surchargeCents,
    }
    if (sa.decidedBy) {
      body.centerName = sa.decidedBy.centerName
      body.driveTimeMinutes = sa.decidedBy.driveTimeMinutes
    }
    if (sa.contactPhone) body.contactPhone = sa.contactPhone
    if (sa.reason) body.reason = sa.reason

    // WHY: ZIP→tier is stable per (user,zip); brief cache cuts dup calls on tab focus / re-renders.
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    })
  } catch (error) {
    console.error('Error in /api/service-area/quote:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
