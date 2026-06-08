import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

interface BulkReassignItem {
  type: 'sign' | 'rider' | 'lockbox' | 'brochure_box' | 'other'
  id: string
}

/**
 * Admin bulk-reassign of inventory items to a TeamMember (or to unassigned).
 *
 * Refuses any item that has a live hold — admin override would silently
 * steal inventory from someone's cart. Caller resolves the conflict by
 * releasing the hold first (via /api/admin/holds) and retrying.
 *
 * Body:
 *   {
 *     items: Array<{ type: 'sign'|'rider'|'lockbox'|'brochure_box', id: string }>,
 *     target_member_id: string | null   // null = unassign
 *   }
 *
 * Response on success: { reassigned: number, target_member_id: string|null }
 * Response on conflict: 409 { error, held: Array<{type, id, expires_at}> }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: customerId } = await params
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const items: BulkReassignItem[] = Array.isArray(body.items) ? body.items : []
    const targetMemberId: string | null =
      typeof body.target_member_id === 'string' && body.target_member_id.length > 0
        ? body.target_member_id
        : null

    if (items.length === 0) {
      return NextResponse.json({ error: 'No items selected' }, { status: 400 })
    }
    if (items.length > 200) {
      return NextResponse.json({ error: 'Too many items in one request (max 200)' }, { status: 400 })
    }

    // If targetMemberId provided, confirm it belongs to this customer's team.
    // Admin tools shouldn't accidentally assign to a member on a different team.
    if (targetMemberId) {
      const customer = await prisma.user.findUnique({
        where: { id: customerId },
        select: { teamId: true },
      })
      if (!customer?.teamId) {
        return NextResponse.json(
          { error: 'Customer has no team — cannot assign to an agent' },
          { status: 400 }
        )
      }
      const member = await prisma.teamMember.findUnique({
        where: { id: targetMemberId },
        select: { teamId: true, removedAt: true },
      })
      if (!member || member.removedAt || member.teamId !== customer.teamId) {
        return NextResponse.json(
          { error: 'Target agent not found on this team' },
          { status: 400 }
        )
      }
    }

    // Bucket by type so each table gets one updateMany.
    const buckets: Record<BulkReassignItem['type'], string[]> = {
      sign: [], rider: [], lockbox: [], brochure_box: [], other: [],
    }
    for (const it of items) {
      if (it.type in buckets && typeof it.id === 'string') buckets[it.type].push(it.id)
    }

    // Pre-check: refuse any item that has a live hold. Admin overriding a
    // live hold without releasing it first would silently steal inventory
    // from a team_admin's cart mid-checkout. Surface the conflict so the
    // admin can release via /api/admin/holds and retry.
    const held: Array<{ type: BulkReassignItem['type']; id: string; expires_at: string }> = []
    const now = new Date()
    if (buckets.sign.length) {
      const rows = await prisma.customerSign.findMany({
        where: { id: { in: buckets.sign }, userId: customerId, heldByHoldId: { not: null }, heldUntil: { gt: now } },
        select: { id: true, heldUntil: true },
      })
      for (const r of rows) held.push({ type: 'sign', id: r.id, expires_at: r.heldUntil!.toISOString() })
    }
    if (buckets.rider.length) {
      const rows = await prisma.customerRider.findMany({
        where: { id: { in: buckets.rider }, userId: customerId, heldByHoldId: { not: null }, heldUntil: { gt: now } },
        select: { id: true, heldUntil: true },
      })
      for (const r of rows) held.push({ type: 'rider', id: r.id, expires_at: r.heldUntil!.toISOString() })
    }
    if (buckets.lockbox.length) {
      const rows = await prisma.customerLockbox.findMany({
        where: { id: { in: buckets.lockbox }, userId: customerId, heldByHoldId: { not: null }, heldUntil: { gt: now } },
        select: { id: true, heldUntil: true },
      })
      for (const r of rows) held.push({ type: 'lockbox', id: r.id, expires_at: r.heldUntil!.toISOString() })
    }
    if (held.length > 0) {
      return NextResponse.json(
        { error: 'One or more items are in an active cart. Release the hold first.', code: 'items_held', held },
        { status: 409 }
      )
    }

    // Apply the reassignment. Scope every updateMany to userId === customerId
    // so a malformed payload can't touch another customer's inventory.
    let reassigned = 0
    if (buckets.sign.length) {
      const r = await prisma.customerSign.updateMany({
        where: { id: { in: buckets.sign }, userId: customerId },
        data: { assignedToMemberId: targetMemberId },
      })
      reassigned += r.count
    }
    if (buckets.rider.length) {
      const r = await prisma.customerRider.updateMany({
        where: { id: { in: buckets.rider }, userId: customerId },
        data: { assignedToMemberId: targetMemberId },
      })
      reassigned += r.count
    }
    if (buckets.lockbox.length) {
      const r = await prisma.customerLockbox.updateMany({
        where: { id: { in: buckets.lockbox }, userId: customerId },
        data: { assignedToMemberId: targetMemberId },
      })
      reassigned += r.count
    }
    if (buckets.brochure_box.length) {
      const r = await prisma.customerBrochureBox.updateMany({
        where: { id: { in: buckets.brochure_box }, userId: customerId },
        data: { assignedToMemberId: targetMemberId },
      })
      reassigned += r.count
    }
    // Other items have no hold mechanic (no heldByHoldId/heldUntil columns),
    // so we skip the pre-check above and reassign directly.
    if (buckets.other.length) {
      const r = await prisma.customerOtherItem.updateMany({
        where: { id: { in: buckets.other }, userId: customerId },
        data: { assignedToMemberId: targetMemberId },
      })
      reassigned += r.count
    }

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.InventoryReassignBulk,
      targetType: 'user',
      targetId: customerId,
      metadata: {
        reassigned,
        target_member_id: targetMemberId,
        item_counts: {
          sign: buckets.sign.length,
          rider: buckets.rider.length,
          lockbox: buckets.lockbox.length,
          brochure_box: buckets.brochure_box.length,
          other: buckets.other.length,
        },
      },
      request,
    })

    return NextResponse.json({ reassigned, target_member_id: targetMemberId })
  } catch (error) {
    console.error('Error bulk-reassigning inventory:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
