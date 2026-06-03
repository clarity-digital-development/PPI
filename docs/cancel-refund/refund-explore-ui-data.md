I have everything needed. Here is the mapping.

---

## 1. Customer order detail page

**File:** `c:\Users\tanne\PPI\app\dashboard\orders\[id]\page.tsx` (client component, fetches `GET /api/orders/[id]`)

**Layout (top-to-bottom):**
- Back link
- Conditional "Complete Payment" banner (`paymentStatus !== 'succeeded' && status !== 'cancelled'`)
- **Order Header card** — order number + status badge + "Placed on …"
- **Status Timeline card** (hidden when cancelled)
- **Cancelled Notice card** (only when `isCancelled`) — currently just says "contact support"
- Two-column grid: Order Details / Order Summary
- **Actions row** (bottom, lines 426–452) — currently: Back / Edit Order / Place Another Order

**Recommended Cancel button placement:** add a third button to the existing Actions row alongside Edit Order, styled `variant="outline"` with red/destructive tint. Visibility gate:
```
order.status !== 'completed' && order.status !== 'cancelled' && isWithinCancelWindow(order.scheduledDate)
```
Clicking opens a confirmation modal (see #6). Don't put it in the header — keeping all "do something" affordances in one row matches the existing pattern. The "Cancelled Notice" card should also be enhanced to show the refund amount + status when a cancel completes (read from a new field, e.g., `refundedAt`/`refundAmount`).

Note: the `Order` interface in this file (lines 33–63) currently does **not** include `scheduledDate`-relative metadata, `paymentIntentId`, `paidAt`, `placedByUserId` — you'll likely want `paidAt`, plus a refund summary, returned from `/api/orders/[id]` for the cancel UX.

---

## 2. ScheduledDate semantics

- **Type:** `DateTime?` (`scheduled_date`), nullable. Null = "Next Available" (see line 328 of the page).
- **Storage convention:** date-only stored at **noon UTC**. Confirmed by `app/api/orders/[id]/edit/route.ts:152`: `new Date(editData.requested_date + 'T12:00:00Z')`. The detail page renders it with `timeZone: 'UTC'` to keep the calendar date stable (line 128).
- **Meaning:** the requested installation date. Not a precise install timestamp — there is no install time-of-day in the schema.
- **Safest "24h before" computation:** because there's no real install time, treat the window as **24h before the start of the install day in the business's local timezone (America/New_York / Kentucky)**. Concretely: take the noon-UTC `scheduledDate`, subtract 12h to get UTC midnight of the install day, then subtract 24h. If `Date.now() < cutoff`, cancellation is allowed.

  Pseudocode:
  ```ts
  const installMidnightUtc = new Date(order.scheduledDate)
  installMidnightUtc.setUTCHours(0, 0, 0, 0) // strip the noon offset
  const cutoff = installMidnightUtc.getTime() - 24 * 60 * 60 * 1000
  const canCancel = Date.now() < cutoff
  ```
  This is the most generous *and* safest interpretation: the customer always gets at least a full calendar day's notice before the install day starts, and we never accidentally allow a cancel during the install window because of TZ drift. **If `scheduledDate` is null** (Next Available), treat as cancellable (no commitment yet).

  Enforce this on both client (button visibility) and server (cancel endpoint) — server is the source of truth.

---

## 3. OrderStatus + transitions

**Enum** (`prisma/schema.prisma:465`):
```
pending | confirmed | scheduled | in_progress | completed | cancelled
```
**Currently allowed transitions for customer self-cancel:** the edit route (`app/api/orders/[id]/edit/route.ts:64`) only blocks `completed` and `cancelled`. There's no formal state machine — any non-terminal status is mutable.

**Recommended cancellable statuses for v1:** `pending`, `confirmed`, `scheduled`. Block `in_progress` (crew dispatched), `completed`, `cancelled`. The 24h cutoff usually makes `in_progress` impossible anyway, but enforce it explicitly.

**Destination status:** `cancelled`. Confirmed: it's the only "ended-not-completed" terminal state in the enum, and `statusConfig` already renders it (red X). Don't introduce `refunded` as a status — that belongs on `PaymentStatus`. So a successful cancel-with-refund sets:
- `Order.status = 'cancelled'`
- `Order.paymentStatus = 'refunded'`

---

## 4. PaymentStatus + refund eligibility

**Enum** (`prisma/schema.prisma:474`):
```
pending | processing | succeeded | failed | refunded
```
- **Refund eligible:** `succeeded` only.
- **`processing`:** mid-3DS or webhook hasn't landed. Refund will fail — instead, attempt `paymentIntents.cancel` (existing admin-cancel pattern in lines 49–57 of the admin cancel route).
- **`pending` / `failed`:** no money moved — just cancel the PI if present and mark order cancelled, no refund.
- **`refunded`:** already done, block.

So the cancel endpoint branches:
1. `paymentStatus === 'succeeded'` → create Stripe refund → on webhook, flip to `refunded`.
2. `paymentStatus in ('pending', 'processing', 'failed')` → cancel PI if cancellable (reuse the admin pattern), set `paymentStatus = 'failed'` (or leave as-is), set `status = 'cancelled'`. No email.
3. Always: call `releaseOrderHoldsAndRestoreInventory(order.id, 'customer_cancel', actor, request)`.

---

## 5. `resolveRefundRecipient(order)` pseudocode

```ts
type RefundRecipient = { email: string; fullName: string; role: 'broker' | 'self' | 'customer' }

async function resolveRefundRecipient(order: Order): Promise<RefundRecipient> {
  // Case A — team_admin placed on behalf of an agent. They paid; they get the email.
  if (order.placedByUserId) {
    const broker = await prisma.user.findUnique({
      where: { id: order.placedByUserId },
      select: { email: true, fullName: true, name: true },
    })
    if (broker) return { email: broker.email, fullName: broker.fullName ?? broker.name ?? broker.email, role: 'broker' }
    // Fall through if broker record vanished — shouldn't happen with FK, but defensive.
  }

  // Need the order's user with role + team to decide B/C/D.
  const user = await prisma.user.findUnique({
    where: { id: order.userId },
    select: { email: true, fullName: true, name: true, role: true, teamId: true },
  })
  if (!user) throw new Error(`Order ${order.id} has no user`)

  // Case B — the order user IS a team_admin (placed for themselves).
  if (user.role === 'team_admin') {
    return { email: user.email, fullName: user.fullName ?? user.name ?? user.email, role: 'self' }
  }

  // Case C — agent on a team; find their team_admin.
  if (user.teamId) {
    const teamAdmin = await prisma.user.findFirst({
      where: { teamId: user.teamId, role: 'team_admin' },
      select: { email: true, fullName: true, name: true },
      orderBy: { createdAt: 'asc' }, // deterministic pick if multiple
    })
    if (teamAdmin) return { email: teamAdmin.email, fullName: teamAdmin.fullName ?? teamAdmin.name ?? teamAdmin.email, role: 'broker' }
    // Fall through if team has no admin (data integrity issue) — fall back to customer.
  }

  // Case D — regular customer (no team, no broker).
  return { email: user.email, fullName: user.fullName ?? user.name ?? user.email, role: 'customer' }
}
```
Note: there is **no helper for this today** in `lib/auth-utils.ts`; `canActOnBehalfOf` is the closest related function but solves the inverse problem. Put `resolveRefundRecipient` in `lib/orders/refund-recipient.ts` (new file) so it can be unit-tested in isolation.

---

## 6. ">= $250 click-through" UX

Recommended **simplest** approach — keep it client-side and avoid endpoint proliferation:

- **One endpoint:** `POST /api/orders/[id]/cancel` (customer-facing; sibling of the admin route, distinct file). Body: `{ confirmed: boolean }`.
- **Server logic:**
  1. Auth: order belongs to `user.id` (or `placedByUserId === user.id` for team_admin).
  2. Validate 24h cutoff + status eligibility.
  3. If `Number(order.total) >= 250 && !body.confirmed` → return `409 { requiresConfirmation: true, amount: order.total }`. **Do nothing else** (no Stripe call, no DB write).
  4. Otherwise execute refund + cancel.
- **Client flow:**
  1. User clicks Cancel → simple "Are you sure?" modal (always shown, regardless of amount, since real money is involved either way).
  2. Modal "Confirm Cancel" → `POST { confirmed: false }`.
  3. If response is `409 { requiresConfirmation: true }`, swap the modal copy to the high-value warning ("This will refund $X to your card. Refunds take 5–10 business days. Are you absolutely sure?") with a second confirm button → `POST { confirmed: true }`.
  4. Success → close modal, refetch order.

Why this shape: one endpoint = one audit trail, idempotency key derives cleanly from `orderId`, and the "double confirm" is a pure UI flourish that the server enforces by gate. No query params, no extra routes, no admin-only refund endpoint needed for v1 (admin can already cancel-without-refund via the existing admin endpoint; the new endpoint handles paid orders).

---

**Files referenced (absolute paths):**
- `c:\Users\tanne\PPI\app\dashboard\orders\[id]\page.tsx`
- `c:\Users\tanne\PPI\app\api\orders\[id]\route.ts` (response payload may need expansion)
- `c:\Users\tanne\PPI\app\api\orders\[id]\edit\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\orders\[id]\cancel\route.ts` (precedent — mirror its inventory-restore + Stripe-PI-cancel patterns)
- `c:\Users\tanne\PPI\prisma\schema.prisma` (Order @ line 359, User @ line 69, OrderStatus @ line 465, PaymentStatus @ line 474)
- `c:\Users\tanne\PPI\lib\auth-utils.ts`