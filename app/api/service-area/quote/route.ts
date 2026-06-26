import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { resolveServiceArea } from '@/lib/service-area'
import { resolveEffectivePayer } from '@/lib/orders/effective-payer'

/**
 * GET /api/service-area/quote?zip=XXXXX[&orderId=...]
 *
 * Returns the resolved service-area tier (+ surcharge) at the given ZIP. By
 * default resolves against the LOGGED-IN user's wallet identity — same input
 * the order POST handler uses for new orders, so cart preview matches the
 * server-side decision on submit.
 *
 * Admin-edit case: when an admin is editing someone else's order via
 * /admin/orders/[id]/edit, the logged-in user is the admin (not exempt), but
 * the actual order owner could be a team_admin (exempt) — without the
 * orderId param the preview would wrongly show a $50 surcharge to admin for
 * an exempt broker's edit. With ?orderId=... AND caller role 'admin', we
 * resolve exemption against the order's effective payer (matches what
 * resolveServiceArea would have decided at original POST time).
 *
 * Security: orderId is silently ignored for non-admin callers — so the
 * customer-facing wizard's cart preview never reaches this branch even if a
 * malicious client appends ?orderId=. Response shape is unchanged regardless
 * of which path produced it; no PII added.
 *
 * Defense in depth: the order POST handler still re-runs resolveServiceArea()
 * as source of truth — the client cannot fake exemption or zero the surcharge.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const zip = searchParams.get('zip')
    const orderId = searchParams.get('orderId')
    if (!zip || !/^\d{5}$/.test(zip.trim().slice(0, 5))) {
      return NextResponse.json({ error: 'Invalid ZIP code' }, { status: 400 })
    }

    let walletUser = {
      id: user.id,
      role: user.role,
      isServiceAreaExempt: user.isServiceAreaExempt ?? false,
    }

    // Admin-as-support edit path: resolve exemption against the order owner,
    // not the admin's session. Non-admin callers always use their own wallet.
    if (orderId && user.role === 'admin') {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { userId: true, placedByUserId: true },
      })
      if (order) {
        const payer = await resolveEffectivePayer(order)
        if (payer) {
          // EffectivePayer is documented as Stripe-identity-only — re-fetch
          // the role + exemption fields we need for service-area resolution
          // (cheap, debounced 300ms upstream, response cached 30s).
          const payerFull = await prisma.user.findUnique({
            where: { id: payer.id },
            select: { id: true, role: true, isServiceAreaExempt: true },
          })
          if (payerFull) {
            walletUser = {
              id: payerFull.id,
              role: payerFull.role,
              isServiceAreaExempt: payerFull.isServiceAreaExempt ?? false,
            }
          } else {
            console.error('[quote] payer user lookup failed', { orderId, payerId: payer.id })
          }
        } else {
          console.error('[quote] effective-payer lookup failed', { orderId })
        }
      } else {
        console.error('[quote] order lookup failed', { orderId, callerId: user.id })
      }
      // On any lookup failure: fall through to admin's own wallet. This
      // OVER-reports the surcharge (admin isn't exempt) rather than UNDER-
      // reporting — the safer failure mode given the bug we just fixed.
    }

    const sa = await resolveServiceArea({ zip, user: walletUser })

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
