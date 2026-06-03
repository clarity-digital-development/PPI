import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-utils'
import { bumpHolds } from '@/lib/inventory-holds'

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

    const result = await bumpHolds({ ownerUserId: user.id, cartItemIds: cartItemIds ?? null })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error bumping holds:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
