import { NextRequest, NextResponse } from 'next/server'
import { HoldItemType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser, canActOnBehalfOf, isAdminOrTeamAdmin } from '@/lib/auth-utils'
import { acquireHold, releaseHolds, HoldConflictError } from '@/lib/inventory-holds'

const VALID_ITEM_TYPES: readonly HoldItemType[] = ['sign', 'rider', 'lockbox'] as const

function isValidItemType(v: unknown): v is HoldItemType {
  return typeof v === 'string' && (VALID_ITEM_TYPES as readonly string[]).includes(v)
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: {
      item_type?: unknown
      item_id?: unknown
      cart_session_id?: unknown
      cart_item_id?: unknown
      on_behalf_of_user_id?: unknown
      assigned_to_member_id_snapshot?: unknown
    } | null
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!body) {
      return NextResponse.json({ error: 'Missing body' }, { status: 400 })
    }

    if (!isValidItemType(body.item_type)) {
      return NextResponse.json({ error: 'item_type must be sign, rider, or lockbox' }, { status: 400 })
    }
    if (typeof body.item_id !== 'string' || body.item_id.length === 0) {
      return NextResponse.json({ error: 'item_id is required' }, { status: 400 })
    }
    const cartSessionId = typeof body.cart_session_id === 'string' ? body.cart_session_id : null
    const cartItemId = typeof body.cart_item_id === 'string' ? body.cart_item_id : null
    const onBehalfOfRaw = typeof body.on_behalf_of_user_id === 'string' ? body.on_behalf_of_user_id : null
    const assignedToMemberIdSnapshot =
      typeof body.assigned_to_member_id_snapshot === 'string' ? body.assigned_to_member_id_snapshot : null

    let ownerUserId = user.id
    let onBehalfOfUserId: string | null = null
    if (onBehalfOfRaw && onBehalfOfRaw !== user.id) {
      if (!(await canActOnBehalfOf(user, onBehalfOfRaw))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Holder for billing/visibility purposes is the on-behalf-of user.
      ownerUserId = onBehalfOfRaw
      onBehalfOfUserId = onBehalfOfRaw
    }

    const itemType = body.item_type
    const itemId = body.item_id

    try {
      const result = await acquireHold(
        {
          itemType,
          itemId,
          ownerUserId,
          actorUserId: user.id,
          onBehalfOfUserId,
          cartSessionId,
          cartItemId,
          assignedToMemberIdSnapshot,
        },
        { request }
      )
      return NextResponse.json({
        hold_id: result.holdId,
        expires_at: result.expiresAt,
        item_type: itemType,
        item_id: itemId,
      })
    } catch (err) {
      if (err instanceof HoldConflictError) {
        // Holder identity must not leak across teams. Only return full
        // details when the requester can see the holder's scope.
        const winner = await prisma.inventoryHold.findFirst({
          where: {
            itemType,
            itemId,
            consumedByOrderId: null,
            releasedAt: null,
          },
          select: { ownerUserId: true },
        })
        let canSeeHolder = false
        if (winner) {
          if (user.role === 'admin') {
            canSeeHolder = true
          } else if (winner.ownerUserId === user.id) {
            canSeeHolder = true
          } else if (isAdminOrTeamAdmin(user) && user.teamId) {
            const holder = await prisma.user.findUnique({
              where: { id: winner.ownerUserId },
              select: { teamId: true },
            })
            canSeeHolder = !!holder && holder.teamId === user.teamId
          }
        }
        if (canSeeHolder) {
          return NextResponse.json(
            { error: err.message, code: err.code, ...err.details },
            { status: 409 }
          )
        }
        // Hardcoded code so a cross-team attacker can't use the response
        // to distinguish "held by competitor" from "vanished/never existed."
        return NextResponse.json(
          { error: 'item_unavailable', code: 'item_unavailable' },
          { status: 409 }
        )
      }
      throw err
    }
  } catch (error) {
    console.error('Error acquiring hold:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const holdId = searchParams.get('id')
    const cartItemId = searchParams.get('cart_item_id')
    const ownerUserIdParam = searchParams.get('owner_user_id')

    const filters = [holdId, cartItemId, ownerUserIdParam].filter(Boolean)
    if (filters.length !== 1) {
      return NextResponse.json(
        { error: 'Provide exactly one of: id, cart_item_id, owner_user_id' },
        { status: 400 }
      )
    }

    const isAdmin = user.role === 'admin'
    const actor = { id: user.id, email: user.email, role: user.role }

    if (holdId) {
      const hold = await prisma.inventoryHold.findUnique({
        where: { id: holdId },
        select: { ownerUserId: true, consumedByOrderId: true, releasedAt: true },
      })
      if (!hold) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      if (!isAdmin && hold.ownerUserId !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const result = await releaseHolds({ actor, holdId }, { request, reason: 'user_release' })
      return NextResponse.json({ released: result.released })
    }

    if (cartItemId) {
      // Scope the release to holds the actor owns unless they're an admin.
      if (!isAdmin) {
        const owns = await prisma.inventoryHold.findFirst({
          where: {
            cartItemId,
            consumedByOrderId: null,
            releasedAt: null,
            ownerUserId: user.id,
          },
          select: { id: true },
        })
        if (!owns) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
      const result = await releaseHolds({ actor, cartItemId }, { request, reason: 'user_release' })
      return NextResponse.json({ released: result.released })
    }

    // owner_user_id branch — only `me` is supported (admins should use id/cartItemId).
    if (ownerUserIdParam !== 'me' && ownerUserIdParam !== user.id) {
      return NextResponse.json({ error: 'owner_user_id must be "me"' }, { status: 400 })
    }
    const result = await releaseHolds(
      { actor, ownerUserId: user.id },
      { request, reason: 'user_release_all' }
    )
    return NextResponse.json({ released: result.released })
  } catch (error) {
    console.error('Error releasing hold:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
