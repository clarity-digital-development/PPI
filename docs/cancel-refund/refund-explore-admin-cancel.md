I have everything needed. Here's the structured map.

---

# Admin Cancel Pattern Map

## 1. Admin cancel flow — step by step

**File**: `app/api/admin/orders/[id]/cancel/route.ts` (108 lines, POST handler)

| Step | Lines | Action |
|---|---|---|
| Auth: session check | 23-26 | `getCurrentUser()` → 401 if no user |
| Auth: role gate | 27-29 | Hard-coded `user.role !== 'admin'` → 403 |
| Order lookup | 31-39 | `prisma.order.findUnique({ id, include: { orderItems } })` → 404 if missing |
| **Paid-order guard** | 41-46 | Bails with 400 if `paymentStatus === 'succeeded'`: *"Cannot cancel a paid order from here. Refund it from Stripe first."* — this is the seam the customer cancel must fill |
| Stripe PI cancel (best-effort) | 48-62 | Retrieves PI, checks status against cancellable list, calls `stripe().paymentIntents.cancel(...)`. Wrapped in try/catch — swallows Stripe failures so DB state still updates |
| Inventory restore | 64-76 | `releaseOrderHoldsAndRestoreInventory(order.id, 'admin_cancel', actor, request)` — also wrapped, also non-blocking |
| Order DB update | 78-84 | Single `prisma.order.update` setting `status: 'cancelled'`, `paymentStatus: 'failed'` |
| Audit | 86-93 | `audit({ action: OrderCancel, targetType: 'order', metadata: { reason: 'admin_cancel', stripeCancelled } })` |
| Response | 95-99 | `{ success, order, stripe_cancelled }` |
| Error catch-all | 100-107 | Uses `getStripeErrorMessage(error)` for user-friendly Stripe errors |

## 2. Stripe calls the admin cancel makes today

Only one path, and it's **NOT a refund**:
- `stripe().paymentIntents.retrieve(order.paymentIntentId)` then
- `stripe().paymentIntents.cancel(order.paymentIntentId)` if status ∈ `['requires_payment_method', 'requires_capture', 'requires_confirmation', 'requires_action', 'processing']`

This handles UNPAID PIs (stuck in 3DS, declined, auth-not-confirmed). It does NOT refund — refunds on paid orders are explicitly punted to the Stripe Dashboard (per the 400 at line 41). The `payment_intent.canceled` webhook handler in `app/api/webhooks/stripe/route.ts:145-158` reconciles back to the DB.

## 3. State transitions

| Field | Before | After |
|---|---|---|
| `Order.status` | any non-cancelled | `'cancelled'` |
| `Order.paymentStatus` | NOT `'succeeded'` (guarded) | `'failed'` |
| `Order.paidAt` | unchanged | unchanged |
| `Order.paymentIntentId` | unchanged (Stripe PI moves to `canceled` server-side) | unchanged |
| Inventory: `CustomerSign/Rider/Lockbox.inStorage` | `false` if previously claimed | `true` (only if no other live order/hold — see `restoreIfSafe` at `lib/inventory-holds.ts:827-886`) |
| `InventoryHold.consumedByOrderId` rows | non-null | deleted (`lib/inventory-holds.ts:595-597`) |

Note `Order.refundedAt`/`refundedAmount` columns do NOT exist yet — schema only has `payment_status: 'refunded'` enum value (`prisma/schema.prisma:479`). New columns or a Refund table needed.

## 4. Audit rows written

Per admin cancel run:
1. **One** `OrderCancel` ('order.cancel') row from the route itself (line 86-93), metadata `{ reason: 'admin_cancel', stripeCancelled }`
2. **One** `InventoryHoldReleased` ('inventory_hold.released') row from `releaseOrderHoldsAndRestoreInventory` (`lib/inventory-holds.ts:600-607`), targetType `'order'`, metadata `{ reason: 'admin_cancel', source: 'release_order_holds' }`

`audit()` is no-throw (`lib/audit.ts:43-63`) — safe to call after the DB commit.

## 5. What's MISSING for customer cancel

**A. Refund infrastructure** (none exists today)
- `lib/stripe/server.ts` has NO `refundPaymentIntent` helper — needs `stripe().refunds.create({ payment_intent, idempotency_key })`. Pattern to follow: `createPaymentIntent` at `lib/stripe/server.ts:91-136` already uses `Stripe.RequestOptions` with `idempotencyKey` — mirror that exactly.
- No `Order.refundId` / `refundedAt` / `refundedAmount` columns. v1 full-refund only, but we still need at least `refundId` (string, unique) and `refundedAt` for idempotency + dashboard reconciliation.
- Audit constants `OrderRefundCreate`, `OrderRefundFail`, `OrderRefundWebhook` already exist (`lib/audit.ts:73-75`). Use them.

**B. 24h cutoff check** (admin cancel has none — admin can cancel anytime)
- Compare `order.scheduledDate` to `new Date()`. Reject if `scheduledDate - now < 24h`. This belongs at the top of the route AFTER the auth + ownership check, BEFORE any Stripe call. Admin path bypasses this gate.

**C. Auto vs click-through threshold** (admin cancel has neither)
- < $250 (compare `Number(order.total)`): execute refund immediately on POST.
- ≥ $250: return a `requires_admin_confirmation: true` response without calling Stripe; admin clicks through a separate `/api/admin/orders/[id]/refund?confirm=1` (or similar). The customer endpoint should set the order to a pending-cancel state OR just block + tell user "we'll process within X" — design decision for the route author, not in scope here, but the customer route MUST gate before Stripe is hit.

**D. Refund recipient email** (admin cancel sends NO email at all)
- `lib/email.ts` has `sendOrderConfirmationEmail` and `sendAdminOrderNotification` (imported at `app/api/webhooks/stripe/route.ts:6`) — needs a new `sendRefundEmail`.
- Recipient logic per locked decisions: `order.placedByUserId ? user(placedByUserId) : order.user.role === 'team_admin' ? order.user : order.user.teamId ? prisma.user.findFirst({ where: { teamId: order.user.teamId, role: 'team_admin' } }) : order.user`. Schema confirms `User.teamId` (line 86), `role: team_admin` enum value (line 127), `Order.placedByUserId` (line 407), and `Order.placedBy` relation (line 418).

**E. Ownership check** (admin cancel only checks role)
- Customer cancel must verify `order.userId === user.id` OR `order.placedByUserId === user.id` (team_admin acting on behalf of agent's order). The existing GET at `app/api/orders/[id]/route.ts:20-31` only matches on `userId` — that's too narrow for the team_admin case and should be expanded for the customer cancel route.

**F. `charge.refunded` webhook handler** (does not exist today)
- `app/api/webhooks/stripe/route.ts` only handles `payment_intent.{succeeded,payment_failed,canceled}`. Add a `case 'charge.refunded':` branch — look up Order by `paymentIntentId` (charge.payment_intent), flip `paymentStatus` to `'refunded'`, stamp `refundedAt`, write `OrderRefundWebhook` audit. MUST be idempotent (compare `charge.amount_refunded` and skip if already reconciled). This is the reconciliation path for dashboard-initiated refunds AND the source of truth for our own refund calls (so don't flip paymentStatus prematurely in the route — let the webhook do it).

## 6. Reusable helpers to pull in

| Helper | Path | Use |
|---|---|---|
| `getCurrentUser()` | `lib/auth-utils` | session/role |
| `stripe()` | `lib/stripe/server.ts:65-78` | lazy Stripe client |
| `getStripeErrorMessage(err)` | `lib/stripe/server.ts:9-63` | safe error → user message |
| `releaseOrderHoldsAndRestoreInventory(orderId, reason, actor, request)` | `lib/inventory-holds.ts:558-608` | inventory restore; reason should be `'customer_cancel'`. Already idempotent + tx-wrapped + audit-emitting |
| `audit({ action, targetType, targetId, metadata, actor, request })` | `lib/audit.ts:43-63` | no-throw audit. Use `AuditAction.OrderCancel`, `OrderRefundCreate`, `OrderRefundFail` |
| `AuditAction.OrderRefund*` constants | `lib/audit.ts:73-75` | already wired up — just use them |
| `Stripe.RequestOptions` + `idempotencyKey` pattern | `lib/stripe/server.ts:133-135` | copy for `refunds.create` |
| `sendOrderConfirmationEmail` shape | `lib/email.ts` (imported in `app/api/webhooks/stripe/route.ts:6`) | template/styling reference for new `sendRefundEmail` |

**Safety properties to mirror from admin cancel:**
1. Wrap Stripe call + inventory restore each in their own try/catch so a single failure doesn't strand the order in a half-state.
2. Do the DB `order.update` AFTER (or independently of) Stripe so a Stripe success without DB update is recoverable via webhook, not vice versa. For refunds this means: call `refunds.create` (with idempotency key = `refund:${order.id}`), record the refund id immediately, then let `charge.refunded` webhook flip `paymentStatus: 'refunded'`.
3. Audit AFTER the state-change commit so audit rows reflect committed state.
4. Use `getStripeErrorMessage` in the outer catch so the customer sees a human message.

**Key divergence from admin cancel**: admin path's PI-cancel branch is for UNPAID orders. Customer path is ONLY ever invoked on PAID orders (paymentStatus === 'succeeded'). The two share inventory restore + audit + order-status update; everything else (refund vs PI cancel, cutoff, threshold, email) is new.