/**
 * Broker billing (Ryan, 2026-11-05): bill an agent's orders and service trips
 * to the brokerage they're linked to.
 *
 *   POST { enabled: boolean }
 *
 * The broker is NOT chosen by the client: it's the brokerage this agent is
 * already linked to for inventory (the roster row — see the sibling
 * brokerage route), i.e. that Team's team_admin login. So this can only point
 * an agent at a brokerage an admin has already linked them to.
 *
 * Turning it on requires the broker to be able to pay: invoice billing, or a
 * saved default card on a Stripe customer. Otherwise every checkout would
 * fail ("no card on file for your broker"), so refuse up front.
 *
 * Each order / service trip stamps the broker at creation (billedToUserId),
 * so turning this off never moves existing charges back onto the agent.
 *
 * Admin-only: this decides who pays.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-utils'
import { audit, AuditAction } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const actor = await getCurrentUser()
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (actor.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const enabled = body && typeof body === 'object' ? (body as { enabled?: unknown }).enabled : undefined
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, billToBrokerUserId: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (!enabled) {
      if (target.billToBrokerUserId) {
        await prisma.user.update({ where: { id }, data: { billToBrokerUserId: null } })
        await audit({
          action: AuditAction.AgentBillToBroker,
          targetType: 'user',
          targetId: id,
          actor,
          request,
          metadata: { from: target.billToBrokerUserId, to: null },
        })
      }
      return NextResponse.json({ success: true, billToBroker: null })
    }

    if (target.role !== 'customer') {
      return NextResponse.json(
        { error: 'Only agent (customer) accounts can be billed to a brokerage.' },
        { status: 400 }
      )
    }

    // The brokerage this agent is linked to (roster row), and its login.
    const link = await prisma.teamMember.findFirst({
      where: { userId: id, removedAt: null },
      select: { teamId: true, team: { select: { name: true } } },
    })
    if (!link) {
      return NextResponse.json(
        { error: 'Link this agent to a brokerage first (Brokerage inventory), then turn on billing.' },
        { status: 400 }
      )
    }
    const broker = await prisma.user.findFirst({
      where: { teamId: link.teamId, role: 'team_admin' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, name: true, email: true, invoiceBilling: true, stripeCustomerId: true },
    })
    if (!broker) {
      return NextResponse.json(
        { error: `${link.team?.name || 'That brokerage'} has no brokerage login to bill.` },
        { status: 400 }
      )
    }
    if (!broker.invoiceBilling) {
      const card = broker.stripeCustomerId
        ? await prisma.paymentMethod.findFirst({ where: { userId: broker.id, isDefault: true }, select: { id: true } })
        : null
      if (!card) {
        return NextResponse.json(
          {
            error: `${link.team?.name || broker.fullName || broker.email} isn't on invoice billing and has no default card on file, so their agents' orders couldn't be charged. Turn on invoice billing or add a card for them first.`,
          },
          { status: 400 }
        )
      }
    }

    if (target.billToBrokerUserId !== broker.id) {
      await prisma.user.update({ where: { id }, data: { billToBrokerUserId: broker.id } })
      await audit({
        action: AuditAction.AgentBillToBroker,
        targetType: 'user',
        targetId: id,
        actor,
        request,
        metadata: { from: target.billToBrokerUserId, to: broker.id, brokerage: link.team?.name ?? null },
      })
    }

    return NextResponse.json({
      success: true,
      billToBroker: { id: broker.id, name: link.team?.name || broker.fullName || broker.name || broker.email },
    })
  } catch (error) {
    console.error('Error updating bill-to-broker:', error)
    return NextResponse.json({ error: 'Failed to update broker billing' }, { status: 500 })
  }
}
