All audit wiring verified. Here is the final walkthrough.

---

# Audit log + data hygiene — Ryan walkthrough

## What ships and what to know

**Audit log foundation (`lib/audit.ts` + `prisma.AuditLog`):**
- Single `audit({ actor, action, targetType, targetId, metadata, request })` helper. Wrapped in try/catch — `audit()` **never throws**; failures only `console.error` so a failed audit cannot abort a refund/cancel/role-change. (`lib/audit.ts:43-63`)
- `AuditLog` row denormalizes `actor_email` + `actor_role` at write time (`lib/audit.ts:18-26`). If you ever delete a user, their email + role are preserved on every historical row. The `actor` relation FK is `onDelete: SetNull` so the row survives. (`prisma/schema.prisma:759-782`)
- Captures `ip_address` (parsed from `x-forwarded-for`/`x-real-ip`) and `user_agent` per call. (`lib/audit.ts:28-37`)
- `system: true` actor produces `actor_role='system'`, `actor_email=null`, `actor_user_id=null` — used by webhooks. (`lib/audit.ts:20`)

**`AuditAction` constants (all defined, mostly wired):**

| Constant | Value | Wired at | Status |
|---|---|---|---|
| `UserRoleChange` | `user.role_change` | `app/api/admin/customers/[id]/route.ts:315` | YES (rate-limited, with from/to + email metadata) |
| `OrderCancel` | `order.cancel` | `app/api/admin/orders/[id]/cancel/route.ts:88`, `lib/refunds.ts:179` | YES (admin cancel + refund cancel both audit) |
| `OrderRefundCreate` | `order.refund.create` | `lib/refunds.ts:162` | YES (after Stripe success, before email) |
| `OrderRefundFail` | `order.refund.fail` | `lib/refunds.ts:140`, `lib/refunds.ts:221` | YES (Stripe failure + email failure both audit) |
| `OrderRefundWebhook` | `order.refund.webhook` | `app/api/webhooks/stripe/route.ts:201, 297` | YES (Stripe webhook reconciliation) |
| `InventoryReassignBulk` | `inventory.reassign.bulk` | `app/api/admin/customers/[id]/inventory/bulk-reassign/route.ts:152` | YES (with item-type counts + target_member_id) |
| `InventoryHoldCreated/Released/Conflict/Consumed/Expired/Overridden` | `inventory_hold.*` | `lib/inventory-holds.ts:198, 370, 427, 450, 533, 602, 636` | YES (full lifecycle) |
| `CartCheckoutBegin/Succeed/Fail` | `cart.checkout.*` | `app/api/orders/batch/route.ts:201, 360, 378, 412, 462` | Succeed + Fail wired; **Begin defined but not currently called** (single-shot checkout begins server-side at /batch, not on UI cart-open — fine, just noting) |
| `InventoryAssign` | `inventory.assign` | — | **DEFINED BUT NEVER CALLED.** `app/api/admin/customers/[id]/inventory/route.ts` POST adds inventory and writes `assignedToMemberId` (line 32, 48, 82, 134, 148) but does NOT call `audit()`. **Minor gap vs. changelog claim** — assign-at-add is functional but unaudited. Bulk-reassign is audited. |

## Data corrections that already shipped

- `supportstaff@semonin.com` → role `team_admin`, on Peggy Heckert Team (Semonin Realtors), owns Peggy's 3 signs (`assignedToMemberId` preserved).
- `pheckert@semonin.com` → role `customer`, `teamId=null`, no inventory rows.
- 3 test orders (`PPI-TEST-9K3IE`, `PPI-TEST-236X4`, `PPI-TEST-NZ93G`) deleted from `test@pinkposts.com` — $206.69 fake revenue removed.

These were one-off `tsx`/`node` scripts run against the DB; the script files themselves are not committed (no `scripts/_delete-test-orders.*` or `scripts/peggy-*` present in repo today — only `check-promo.js`, `seed-admin-test-inventory.js`, `seed-test-account.ts`). Per the task brief, all three operations wrote audit rows.

## Walkthroughs

### Scenario A — verify Semonin team state
1. Sign out, then sign in as `supportstaff@semonin.com`.
2. Top-right user menu → role badge should read **"Team Admin"** (not "Customer", not "Admin").
3. Visit `/dashboard` → "Team Inventory" tab/section.
4. **Expected:** 3 signs visible, each with the `assignedToMemberId` preserved (member name on the row should match whoever Peggy had assigned them to before — typically herself).
5. **If you see "Customer" role or empty Team Inventory →** demotion script didn't run or `teamId` is null on supportstaff. Run a quick `SELECT role, team_id FROM users WHERE email='supportstaff@semonin.com'` — expect `team_admin` + non-null `team_id`.

### Scenario B — verify Peggy is a plain customer
1. Sign in as `admin@pinkposts.com` / `admin123`.
2. Navigate to `/admin/customers`.
3. Search "Peggy" or "pheckert".
4. **Expected:** one row, role badge says **"Customer"**, team column is empty/dash.
5. Click into her profile → Inventory section should show **0 items** (the 3 signs are now on supportstaff).
6. **If role still says "Team Admin" →** demotion didn't take. Re-run the demote script.
7. **If inventory still shows her 3 signs →** the re-attribution `UPDATE` didn't fire; the bulk-reassign audit row will be missing.

### Scenario C — verify test-order cleanup
1. Still as admin@pinkposts.com → `/admin/orders`.
2. In the search box type `PPI-TEST`.
3. **Expected:** **0 results.**
4. Also: filter customer = `test@pinkposts.com` → 0 orders (only seeded inventory remains; Ashley/Marcus/Diana team members still present per task brief).
5. **If any `PPI-TEST-*` row appears →** delete script missed one; grab the order number and re-run the deletion targeting just that id.

### Scenario D — verify revenue rollup excludes deleted orders
1. `/admin/dashboard` (or wherever the revenue widget lives).
2. Note total gross revenue, completed-orders count, and date-range default.
3. **Expected:** the $206.69 from the 3 PPI-TEST orders is **not** included. If you remember the pre-cleanup number, the new number should be exactly $206.69 lower (and 3 fewer orders in the count).
4. **If the dashboard shows the old number →** likely a cached aggregate; hit refresh, then check whether the dashboard query filters by `status != 'cancelled'` vs. actually-deleted rows. Deletion (not cancellation) was used here, so any properly written `count`/`sum` over the `orders` table should already be correct.

### Scenario E — spot-check the audit trail itself
There is no admin UI for browsing audit rows yet (the model + helper are in place; surface is TBD). To verify directly against the DB, the queries you'd run are:

```ts
// 1. Peggy's demotion left a row
await prisma.auditLog.findMany({
  where: {
    action: 'user.role_change',
    targetId: '<peggy-user-id>',
  },
  orderBy: { createdAt: 'desc' },
})
// Expect at least one row with metadata.from='team_admin', metadata.to='customer',
// actor_email='admin@pinkposts.com' (or 'system' if run via script with system actor),
// actor_role='admin' or 'system'.

// 2. Hold lifecycle from smoke tests
await prisma.auditLog.findMany({
  where: { action: { startsWith: 'inventory_hold.' } },
  orderBy: { createdAt: 'desc' },
  take: 20,
})
// Expect a mix of inventory_hold.created / .released / .consumed / .expired
// (and possibly .conflict if anyone hit a race).

// 3. Test-order deletion left an order.cancel row
await prisma.auditLog.findMany({
  where: {
    action: 'order.cancel',
    metadata: { path: ['source'], equals: 'script:_delete-test-orders' },
  },
})
// Expect 3 rows, one per deleted PPI-TEST-* order.
```

If any of those return zero rows, that's the gap to flag — the action either ran without the helper (script wrote raw SQL bypassing `audit()`) or used a different `metadata.source` string.

## Known mismatches vs. changelog

1. **`AuditAction.InventoryAssign` is defined but not invoked.** Admin "Add Inventory" (POST `/api/admin/customers/[id]/inventory`) writes `assignedToMemberId` per item but does not produce an audit row. The bulk-reassign endpoint is audited, the per-item-add path is not. If the changelog claims "audit rows on every inventory assignment", this is the one exception. Single-line fix when we want it: wrap the `Promise.all` of `prisma.customerSign.createMany` (etc.) with an `await audit({ action: AuditAction.InventoryAssign, ... })` after success.
2. **`AuditAction.CartCheckoutBegin` is defined but not invoked.** Checkout is single-shot server-side, so "begin" never had a natural call site. Leave it as a forward-compat constant or remove — either is fine, just inconsistent with the constant's presence.
3. **No committed scripts for the data corrections.** The three operations described (supportstaff fix, Peggy demote, test-order delete) ran but the script files are not in the repo. That's fine for one-offs, but it means re-running them or auditing the exact `metadata.source` requires DB inspection of the audit rows rather than script grep. If you want them committed for posterity, drop them in `scripts/` with a `_` prefix so they're not picked up by any auto-runner.

Everything else (refund/cancel audit pairs, hold lifecycle audits, role-change audit with from/to, denormalized actor, no-throw guarantee) matches what the changelog says.