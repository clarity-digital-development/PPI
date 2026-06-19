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
  OrderEdit:   'order.edit',
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
  UserInvoiceBillingToggle:    'user.invoice_billing_toggle',
  InvoiceCreated:              'invoice.created',
  InvoicePaid:                 'invoice.paid',
  InvoiceVoided:               'invoice.voided',
  // Email-send lifecycle on a bundled invoice. InvoiceCreated records the
  // admin's INTENT (which recipient they typed); the three below record the
  // worker's OUTCOME (what the customer actually saw). Splitting them keeps
  // the audit log faithful even when a Resend overrides the recipient
  // between create and send.
  InvoiceEmailSent:            'invoice.email.sent',
  InvoiceEmailFailed:          'invoice.email.failed',
  InvoiceEmailSkipped:         'invoice.email.skipped',
  // Admin clicked Resend on the invoice list (after a failed or sent state),
  // optionally with a recipient override. Distinct from InvoiceCreated so
  // forensic queries can tell first-send vs retry apart.
  InvoiceResent:               'invoice.resent',
  ServiceAreaBlock:            'service_area.block',
  ServiceAreaSurchargeApplied: 'service_area.surcharge_applied',
  // Policy-notice acceptance — legal trail proving each non-exempt user
  // saw and acknowledged the out-of-area fee + post-rental clarification.
  PolicyNoticeAccepted: 'policy_notice.accepted',
  // Post-rental billing lifecycle. One row per state transition so we can
  // reconstruct the full charge history (scheduled -> attempt -> succeed/fail/skip),
  // plus admin overrides (per-order opt-in toggle) and the pickup-stop signal.
  PostRentalChargeScheduled: 'post_rental.charge.scheduled',
  PostRentalChargeAttempt:   'post_rental.charge.attempt',
  PostRentalChargeSucceeded: 'post_rental.charge.succeeded',
  PostRentalChargeFailed:    'post_rental.charge.failed',
  PostRentalChargeSkipped:   'post_rental.charge.skipped',
  PostRentalChargeRetry:     'post_rental.charge.retry',
  PostRentalOverrideToggle:  'post_rental.override.toggle',
  PostRentalStopped:         'post_rental.stopped',
} as const
export type AuditActionName = (typeof AuditAction)[keyof typeof AuditAction]
