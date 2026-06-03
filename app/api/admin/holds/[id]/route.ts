import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-utils'
import { overrideHold } from '@/lib/inventory-holds'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    let reason: string | undefined
    try {
      const body = (await request.json()) as { reason?: unknown }
      if (typeof body?.reason === 'string') {
        reason = body.reason
      }
    } catch {
      // No body or invalid JSON — reason stays undefined
    }

    const result = await overrideHold(
      id,
      { id: user.id, email: user.email, role: user.role },
      request,
      reason
    )

    if (!result.released) {
      return NextResponse.json({ released: false }, { status: 404 })
    }

    return NextResponse.json({ released: true })
  } catch (error) {
    console.error('Error overriding hold:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
