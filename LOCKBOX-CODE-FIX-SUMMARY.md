# Lockbox Code Visibility — What Was Wrong + What Was Fixed

A summary of the multi-round fix for Ryan's complaint that lockbox codes
weren't showing up where the install crew needed them.

---

## The original complaint (round 4 → round 7)

> "The lockbox in the SR doesn't have the code assigned to it in inventory.
> I need this code to appear. It recognizes it in his order when he selects
> it, but it doesn't come through on the order confirmation anywhere."
> — Ryan, looking at PJ Elder's order (312 Bell Lawn Drive)

Translated: when a customer ordered a lockbox from their inventory, the
inventory record HAD the code stored, but neither the order confirmation
email nor the on-site service-request email surfaced that code anywhere.
The install crew couldn't see which lockbox to bring, or which one was
already at the property.

---

## What was actually wrong (root cause, layer by layer)

There were **three separate layers of breakage** stacked on top of each
other. Each round peeled off one layer.

### Layer 1 — The order's line-item description was generic

When a customer placed an order and picked a lockbox from inventory, the
`OrderItem.customerLockboxId` foreign key was correctly attached (verified
against PJ Elder's order `PPI-MPZUUVAG-4DFJ` — `customerLockboxId =
cmp05jmns00as15l6wtsk3gd9`). But the `OrderItem.description` text was just
`"Sentrilock/Supra Install"` — no code, no serial number.

The order detail page and both emails render `item.description` verbatim,
so the code was invisible to anyone reading the order.

### Layer 2 — Fix-forward didn't fix old orders

Round 5 (commit `be654a6`) added a `lockboxIdentifierSuffix()` helper that
appended `" — Serial: X · Code: Y"` to the description string at order
**create** time. That fixed **new** orders going forward.

But `OrderItem.description` is a stored String. Existing orders' descriptions
were frozen at the value they were created with. PJ Elder's order was placed
**before** round 5 shipped, so it kept the old generic string.

### Layer 3 — Service requests had no link back to inventory at all

Service requests can reference an installation (a physical sign + lockbox at
a property). The `InstallationLockbox` row that represents what's on-site
had its own `code String?` column but **no foreign key back to
`CustomerLockbox` in inventory**.

Across the live database:
- 19 `InstallationLockbox` rows total
- 1 had `code` populated (5%)
- 18 had `code: null` — and no way to look up the code from inventory
  because there was no link

So even after round 5 fixed new orders, when a customer filed a service
request on one of those existing installations, the SR email had no way to
say "the lockbox already at this property is Sentrilock/Supra, code 2093483"
— the data wasn't reachable.

---

## What got fixed, and when

### Round 5 (commit `be654a6`) — fix-forward for new orders

- Added `lockboxIdentifierSuffix()` helper that builds
  `" — Serial: X · Code: Y"` (prefer-order: both → serial-only → code-only → empty).
- Wired into `review-step.tsx` at both the review-screen display AND the
  `buildItems()` API payload, in all 4 lockbox branches (sentrilock /
  mechanical_own / at_property / mechanical_rent).
- **New orders going forward**: line description includes Serial + Code.
- **Old orders**: unchanged (still generic).

### Round 7 (commit `ee409f1`) — backfill old orders + first SR enrichment

- Extracted the helper into `lib/orders/lockbox-description.ts` (shared
  between live wizard and the backfill).
- New backfill script `scripts/_backfill-lockbox-descriptions.ts`
  (idempotent, ran live):
  - Scanned 22 lockbox `OrderItem` rows.
  - Found 3 backfill-eligible (FK set + no code suffix in description).
  - Updated all 3, including **PJ Elder's order** which now reads
    `"Sentrilock/Supra Install — Code: 2093483"` — the exact code Ryan
    saw in inventory.
  - 19 FK-less rows left alone (legacy/rental, no source of truth).
- Added an optional `existingLockboxes` prop to all 4 SR email helpers
  (admin notif, customer confirmation, status, completed) and a pink
  "Existing lockboxes at this property" block in the templates.
- Wired the 3 SR creation/update routes to fetch the installation's
  lockboxes when present.
- **Discovered the structural gap**: 18 of 19 InstallationLockbox rows had
  `code: null` AND no FK back to inventory. SR enrichment would render
  `(Code: —)` for ~95% of existing installations. Flagged as round-8 work.

### Round 8 (commit `b99fab5`) — close the structural gap

- **Schema change**: added `InstallationLockbox.customerLockboxId String?`
  FK to `CustomerLockbox` (nullable, additive, `onDelete: SetNull`). Plus
  `@@index` for lookup performance. Pushed live to Railway.
- **Install-time copy**: at order completion (`PUT /api/admin/orders/[id]`,
  the only `installationLockbox.create` call site), the new FK is populated
  from `OrderItem.customerLockboxId`. Existing `code` snapshot copy stays
  in place. **All new installations from now on carry the FK.**
- **Backfill** of existing InstallationLockbox rows
  (`scripts/_backfill-installation-lockbox-fk.ts`, idempotent, ran live):
  - Scanned 19 rows with null FK.
  - Linked 1 by joining Installation → Order → OrderItem.customerLockboxId.
  - 18 were genuinely unrecoverable from the Order graph — their source
    OrderItems predate the era when we wrote `customerLockboxId` onto
    OrderItem. The data isn't there to derive from.
- **Email rendering** updated to prefer the live FK (`customerLockbox.code`)
  over the legacy stored copy (`installationLockbox.code`):
  - Post-FK installations → live current code from inventory (so if Ryan
    rotates a lockbox code in inventory, future SRs show the new one)
  - Backfilled-FK rows → live code via FK
  - Legacy null-FK rows → fall back to `installationLockbox.code` (preserves
    pre-round-8 behavior; shows "—" only when both are null)

---

## What Ryan should see now

**For PJ Elder's order** (`PPI-MPZUUVAG-4DFJ`):
- Admin order detail page: lockbox row reads `"Sentrilock/Supra Install
  — Code: 2093483"`
- Customer order detail page: same
- Any re-sent confirmation email: same

**For NEW orders** placed by anyone going forward:
- Same line format. Serial + Code appended when stored on the inventory
  lockbox.

**For service requests** on installations that have lockboxes:
- Pink "Existing lockboxes at this property" block in the customer
  confirmation email
- Same info in the admin notification (text format)
- Same in status-change emails (acknowledged, scheduled, in_progress,
  cancelled) and the existing completion email
- Code shows live from inventory if the FK is set (most cases now); falls
  back to the snapshot stored at install time for legacy rows

**Test emails delivered to Tanner's inbox** for visual verification of the
new templates (Resend ids in commit messages):
- Round 7: 3 emails showing the pink lockbox block with various data
- Round 8: 2 emails showing FK-resolved live data

---

## What's still imperfect (and why it's acceptable)

**18 historical `InstallationLockbox` rows have null code AND null FK.**
Their source OrderItems predate the era when we wrote `customerLockboxId`
onto OrderItem, so the Order graph genuinely doesn't contain enough info
to derive the link. When an SR is filed on one of these installations,
the email shows `(Code: —)` for that lockbox.

A secondary backfill could try to match by `(user, lockboxType,
installedAt near order.createdAt)` and pick a likely CustomerLockbox.
Worth doing if and when those specific installations generate SRs that
get flagged — they're low-traffic per Ryan's typical install activity,
and the rest of the system degrades gracefully. Low priority follow-up.

---

## Commits in this fix sequence

| Commit | Round | What |
|---|---|---|
| `be654a6` | 5 | `lockboxIdentifierSuffix()` helper + wired into wizard buildItems |
| `ee409f1` | 7 | Shared helper extracted + backfill 3 pre-r5 OrderItem descriptions (including PJ Elder) + first SR-email "existing lockboxes" block |
| `b99fab5` | 8 | `InstallationLockbox.customerLockboxId` FK + install-time copy + backfill 1 of 19 historical rows + emails prefer live FK data |

All shipped to `ryan-feedback-2026-06-02` and pushed to remote.
