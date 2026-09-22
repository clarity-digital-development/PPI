import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-utils'
import { bumpHolds, releaseHolds } from '@/lib/inventory-holds'
import { allowedInventoryOwnerIds } from '@/lib/orders/inventory-ownership'
import { foreignHolds } from '@/lib/inventory/hold-scope'

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let cartItemIds: string[] | undefined
    try {
      const body = (await request.json()) as { cart_item_ids?: unknown } | null
      if (body && Array.isArray(body.cart_item_ids)) {
        if (!body.cart_item_ids.every((v): v is string => typeof v === 'string')) {
          return NextResponse.json({ error: 'cart_item_ids must be strings' }, { status: 400 })
        }
        cartItemIds = body.cart_item_ids
      }
    } catch {
      // Empty body is fine — bump all live holds.
    }

    // Re-authorise before extending. A hold is granted once and then renewed
    // every few minutes for as long as a tab stays open, so without this a
    // brokerage could remove an agent from their roster and that agent's
    // existing holds on the brokerage's signs would keep renewing forever --
    // the pool stays hidden from its owner and only Pink Posts staff can clear
    // it. Anything the holder may no longer hold is released here instead.
    const stillAllowed = await allowedInventoryOwnerIds({
      orderUserId: user.id,
      actorId: user.id,
    })
    const { byItem } = await foreignHolds(user.id)
    const revoked = byItem.filter((h) => !stillAllowed.has(h.ownerId))
    for (const h of revoked) {
      await releaseHolds(
        { actor: { id: user.id, email: user.email, role: user.role }, holdId: h.holdId },
        { request, reason: 'access_revoked' }
      )
    }
    if (revoked.length > 0) {
      console.warn('[holds/bump] released holds the owner may no longer hold', {
        ownerUserId: user.id,
        released: revoked.length,
      })
    }

    const result = await bumpHolds({ ownerUserId: user.id, cartItemIds: cartItemIds ?? null })
    // A cart row whose hold was just released above must not read as
    // "extended" -- the client would carry the dead hold forward and only
    // discover it at checkout. Report it gone so the row is re-picked now.
    for (const h of revoked) {
      if (h.cartItemId) result.byCartItem[h.cartItemId] = { extended: false, reason: 'gone' }
    }
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error bumping holds:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
