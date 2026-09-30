// Admin "Remove out-of-area fee" — takes whatever of the fee hasn't been
// collected or billed yet off the order. Rules: lib/orders/ooa-waive-rules.ts.
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'
import { OOAWaiveError, waiveOutOfAreaFee } from '@/lib/orders/waive-out-of-area'

function isWriteConflict(error: unknown): boolean {
  const e = error as { code?: string; message?: string; cause?: { code?: string; originalCode?: string } } | null
  const codes = [e?.code, e?.cause?.code, e?.cause?.originalCode]
  return codes.some((c) => c === 'P2034' || c === '40001' || c === '40P01') || /deadlock detected/i.test(e?.message ?? '')
}

export async function POST(
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

    const { id: orderId } = await params
    const result = await waiveOutOfAreaFee(orderId)

    await audit({
      actor: { id: user.id, email: user.email, role: user.role },
      action: AuditAction.ServiceAreaFeeWaived,
      targetType: 'order',
      targetId: orderId,
      metadata: { ...result },
      request,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof OOAWaiveError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    // Postgres aborted the transaction over a write conflict or a deadlock
    // with a write landing at the same moment — the waive takes its locks in
    // the edit route's order, so this is a backstop. Nothing was written.
    // The pg adapter only maps 40001 to P2034; a deadlock (40P01) surfaces as
    // a raw driver error, so check every shape it can arrive in.
    if (isWriteConflict(error)) {
      return NextResponse.json(
        { error: 'This order changed while the fee was being removed. Refresh and try again.' },
        { status: 409 }
      )
    }
    console.error('Error removing out-of-area fee:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
