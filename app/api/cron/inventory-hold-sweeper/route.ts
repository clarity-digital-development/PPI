import { NextRequest, NextResponse } from 'next/server'
import { sweepExpired } from '@/lib/inventory-holds'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${secret}`
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const startedAt = Date.now()
    const result = await sweepExpired()
    const durationMs = Date.now() - startedAt

    return NextResponse.json({
      expired: result.expired,
      consumedReaped: result.consumedReaped,
      releasedReaped: result.releasedReaped,
      oldestExpiredAgeSec: result.oldestExpiredAgeSec,
      durationMs,
    })
  } catch (error) {
    console.error('Inventory hold sweeper failed:', error)
    return NextResponse.json({ error: 'sweep failed' }, { status: 500 })
  }
}
