I have everything needed. Final report below.

---

# Rental-clock signals on Order — Explorer A report

## 1. Install date signal — canonical: `Installation.installedAt`

Field: `prisma/schema.prisma:538` — `installedAt DateTime @default(now())` on `Installation`. Row is created at `app/api/orders/[id]/route.ts:184-194` when admin transitions order to status `completed`; the schema default stamps the wall-clock moment the post physically went in the ground (admin clicks Complete from their truck/depot the same day).

Why not the alternatives:
- `Order.scheduledDate` (`schema.prisma:401`) is **null in all 5 latest installs** (live data confirms — Ryan's team stopped populating it; orders are dispatched verbally). Unreliable.
- `Order.paidAt` (`schema.prisma:423`) marks payment, not install. In live data it's **null for orders MPZUUVAJ/MPZRCFC6** (legacy orders charged before paidAt was added) and runs ~1 day ahead of `installedAt` for newer orders (e.g. order MQ18T1OJ paid 2026-06-05 18:13 UTC, installed 2026-06-06 20:26 UTC). Off by up to a week.
- `Order.completedAt` does not exist on the model.

`Installation.installedAt` is the only field that means "post is in the ground at this address as of date X."

Live samples (all installation.status='active', no removal yet):

| orderNumber | installedAt | paidAt | scheduledDate |
|---|---|---|---|
| PPI-MQ18T1OF-2IDE | 2026-06-06T20:26:56Z | 2026-06-05T18:13Z | null |
| PPI-MQ18B2DE-5NE0 | 2026-06-06T20:27:01Z | 2026-06-05T17:59Z | null |
| PPI-MPZUUVAG-4DFJ | 2026-06-05T14:18:59Z | null | null |

## 2. Pickup signal — canonical: `Installation.status` + `Installation.removedAt` / `removalDate`

Lifecycle (confirmed in code + DB):

1. Customer schedules pickup → `app/api/installations/[id]/schedule-removal/route.ts:43-49` sets `Installation.status = 'removal_scheduled'` and `removalDate = <date>`. A matching `ServiceRequest(type='removal', status='pending')` is created separately in `app/api/installations/[id]/service-request/route.ts`.
2. Admin completes the removal trip → `app/api/admin/service-requests/[id]/route.ts:147-153` flips `Installation.status = 'removed'` and stamps `removedAt = new Date()`, alongside `ServiceRequest.status = 'completed'`.

Live data confirms 1:1 mapping: every removed installation has a corresponding completed removal SR (`removal+completed` count = 31, exactly matches `installation.status='removed'` count = 31).

**Rental cron rule:**
- **Stop clock when** `Installation.status IN ('removal_scheduled', 'removed')` OR `Installation.removalDate IS NOT NULL`. (`removalDate` is set the moment pickup is scheduled — that's Ryan's "stops when pickup is scheduled" trigger.)
- **Suppress entirely when** `removalDate < installedAt + 6 months` ("does NOT fire at all if pickup is before the 6-month anniversary").

Ignore `Order.pickupAt` / `Installation.removedAt`-only checks; the canonical signal is the status + `removalDate` pair.

## 3. Active vs completed status

- `Order.status` steady state for an installed post is `'completed'` — `OrderStatus.completed` is set the same instant the Installation row is created (`app/api/orders/[id]/route.ts:184` inside the same handler that transitions to completed). Live data: **170/176 orders are `completed`**, 3 pending, 3 cancelled. There is no "active" Order status — only Installation has `active|removal_scheduled|removed` (`schema.prisma:587-591`).
- `Order.status='pending'` means **never installed** (cart/checkout flow in progress) — must be excluded.

**Cron eligibility filter:** `order.status = 'completed' AND order.paymentStatus = 'succeeded' AND installation.status = 'active'`.

## 4. Payment method resolution — slightly different from refund-recipient

The off-session charge needs a Stripe customer + a saved PaymentMethod. The pattern in `app/api/admin/service-requests/[id]/invoice/route.ts:49-66` is the right precedent: charge against `serviceRequest.user.stripeCustomerId` using `paymentMethod.isDefault` first, fall back to any saved card.

**For rental, the payer is the broker, not the agent** — same identity logic as `lib/orders/refund-recipient.ts:38-91`: if `order.placedByUserId` is set, charge **that** user's Stripe customer + cards. Else if `order.user.role === 'team_admin'`, charge them. Else if `order.user.teamId` is set, charge the team_admin for that team. Else charge `order.user` directly.

Recommend extracting a `resolveBillingPayer(order)` helper that mirrors `resolveRefundRecipient` shape (returns `{ userId, stripeCustomerId, paymentMethodId }`) so both this cron and any future billing flow share one source of truth.

## 5. Schema additions — recommend Order columns, not derive-from-charges

Add three columns to `Order` (additive, default-safe):

- `postRentalEnabledOverride Boolean @default(false) @map("post_rental_enabled_override")` — admin per-order opt-in for legacy orders predating `POST_RENTAL_BILLING_START_AT`.
- `postRentalStoppedAt DateTime? @map("post_rental_stopped_at")` — set when cron observes `Installation.removalDate IS NOT NULL` for the first time, so we don't re-evaluate stop logic every daily run. Cheap "this order is done with rental" flag.
- `postRentalDisabledReason String? @map("post_rental_disabled_reason")` — optional free-text for admin notes ("courtesy waiver for relationship customer X"). Pair with a `postRentalDisabled Boolean @default(false)` flag if Ryan wants an explicit kill-switch alongside the opt-in.

Do **not** put `nextChargeDueAt` or `monthsBilled` on Order — derive from `PostRentalCharge` rows (per-charge audit table). Keeps Order lean and avoids drift.

Skip: `installedAt` on Order (already on `Installation`), `pickupScheduledAt` on Order (already `Installation.removalDate`).

---

Relevant files:
- `c:\Users\tanne\PPI\prisma\schema.prisma` (Order 377-469, Installation 528-591, ServiceRequest 597-643)
- `c:\Users\tanne\PPI\lib\orders\refund-recipient.ts`
- `c:\Users\tanne\PPI\app\api\orders\[id]\route.ts:178-194` (Installation creation)
- `c:\Users\tanne\PPI\app\api\installations\[id]\schedule-removal\route.ts:43-49` (pickup schedule)
- `c:\Users\tanne\PPI\app\api\admin\service-requests\[id]\route.ts:147-153` (pickup complete)
- `c:\Users\tanne\PPI\app\api\admin\service-requests\[id]\invoice\route.ts:49-77` (off-session charge precedent)