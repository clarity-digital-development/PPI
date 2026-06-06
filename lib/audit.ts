import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'

export type AuditActor =
  | { id: string; email?: string | null; role?: string | null }
  | { system: true }
  | null

export interface AuditWriteInput {
  actor: AuditActor
  action: string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown> | null
  request?: NextRequest | Request | null
}

function actorFields(actor: AuditActor) {
  if (!actor) return { actorUserId: null, actorEmail: null, actorRole: null }
  if ('system' in actor) return { actorUserId: null, actorEmail: null, actorRole: 'system' }
  return {
    actorUserId: actor.id ?? null,
    actorEmail: actor.email ?? null,
    actorRole: actor.role ?? null,
  }
}

function reqFields(req: AuditWriteInput['request']) {
  if (!req) return { ipAddress: null, userAgent: null }
  const headers = req.headers
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    null
  const ua = headers.get('user-agent') || null
  return { ipAddress: ip, userAgent: ua }
}

/**
 * Write an audit log row. NEVER throws — audit failures must not break the
 * caller's transaction. Errors are logged to stderr only.
 */
export async function audit(input: AuditWriteInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (input.metadata ?? null) as never,
        ...actorFields(input.actor),
        ...reqFields(input.request),
      },
    })
  } catch (err) {
    console.error('[audit] failed to write log', {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Stable action name constants. Add new ones here so they're greppable across
 * the codebase. Format: <domain>.<verb>[.<qualifier>].
 */
export const AuditAction = {
  UserRoleChange: 'user.role_change',
  OrderCancel: 'order.cancel',
  OrderRefundCreate: 'order.refund.create',
  OrderRefundFail: 'order.refund.fail',
  OrderRefundWebhook: 'order.refund.webhook',
  InventoryAssign: 'inventory.assign',
  InventoryReassignBulk: 'inventory.reassign.bulk',
  CartCheckoutBegin: 'cart.checkout.begin',
  CartCheckoutSucceed: 'cart.checkout.succeed',
  CartCheckoutFail: 'cart.checkout.fail',
  // Inventory hold lifecycle. Note: we DELIBERATELY do NOT audit each
  // heartbeat-driven hold extension — a busy team_admin's cart would
  // generate ~200 audit rows per checkout if we did. The hold row's own
  // expiresAt is the source of truth for hold age; audit captures only
  // the meaningful state transitions.
  InventoryHoldCreated:    'inventory_hold.created',
  InventoryHoldReleased:   'inventory_hold.released',
  InventoryHoldExpired:    'inventory_hold.expired',
  InventoryHoldConflict:   'inventory_hold.conflict',
  InventoryHoldConsumed:   'inventory_hold.consumed',
  InventoryHoldOverridden: 'inventory_hold.overridden',
  // Service-area gating (drive-time bands per service center).
  ServiceCenterCreate:         'service_center.create',
  ServiceCenterUpdate:         'service_center.update',
  ServiceCenterDelete:         'service_center.delete',
  UserExemptToggle:            'user.service_area_exempt_toggle',
  ServiceAreaBlock:            'service_area.block',
  ServiceAreaSurchargeApplied: 'service_area.surcharge_applied',
} as const
export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction]
