Excellent — full data confirmed. Now I have everything needed to write the report.

# Diagnostic Report — Lockbox Code Visibility (PJ Elder + Backfill Scope)

## Part 1 — PJ Elder order PPI-MPZUUVAG-4DFJ

**Order header**
- orderNumber: `PPI-MPZUUVAG-4DFJ`
- status: `pending`
- createdAt: `2026-06-04T18:55:13.386Z` (today — placed before round 5 enrichment was deployed)
- total: `$92.57`
- user: `ba@pjelder.com` / Philip "PJ" Elder / Omega Real Estate Brokerage
- propertyAddress: `312 Bell Lawn Drive`

**OrderItems** (5 total):
| itemType | description | customerLockboxId |
|---|---|---|
| post | `Signature Pink Post (install & pickup)` | null |
| sign | `Sign Install: FOR SALE (from storage)` | null |
| sign | `Rider Install: Pj Elder (from storage)` (labeled rider) | null |
| **lockbox** | **`Sentrilock/Supra Install`** | **`cmp05jmns00as15l6wtsk3gd9`** |
| solar_lighting | `Solar Lighting × 2` | null |

**Linked CustomerLockbox** (`cmp05jmns00as15l6wtsk3gd9`):
- serialNumber: `null`
- **code: `2093483`** (matches the screenshot — inventory DOES have the code)
- lockboxType.name: `Sentrilock/Supra`

**Confirmed diagnosis:** the FK is correctly attached (round 4 wizard fix works), but `OrderItem.description` is the old generic string `"Sentrilock/Supra Install"` with NO `Serial:`/`Code:` suffix. Ryan's complaint is exactly what the data shows. Round 5's enrichment only runs at order-CREATE time, so this row (and any other pre-r5 lockbox order) shows nothing.

## Part 2 — Backfill scope

Across all `OrderItem` rows where `itemType='lockbox'`:
- **Total lockbox items: 22**
- **With customerLockboxId FK set: 3** ← backfill-eligible
- **Without FK (cannot enrich, mostly legacy "rental" / generic items): 19**
- **Backfill candidates (FK set AND description has no Serial:/Code: suffix): 3**

All 3 candidates are Sentrilock/Supra items with a code but no serial:

| itemId | current → proposed |
|---|---|
| `cmpxf7065007n15qsz8vhfsj5` | `Sentrilock/Supra Install` → `Sentrilock/Supra Install (Code: 2090511)` |
| `cmpzmbtp7009f15qskc2gclkh` | `Sentrilock/Supra Install` → `Sentrilock/Supra Install (Code: 2089672)` |
| `cmpzuuvam00av15qs769je5g2` (PJ Elder) | `Sentrilock/Supra Install` → `Sentrilock/Supra Install (Code: 2093483)` |

Backfill is small and trivially safe — 3 UPDATE statements. The 19 FK-less rows can't be enriched (no source of truth) and should be left alone; new orders use the round-5 enrichment going forward.

## Part 3 — Service-request side

- ServiceRequests with `installationId` set: **31**
- ServiceRequests whose installation has 1+ `InstallationLockbox` rows: **5**

**Sample SR** `cmpvnfw7p006i15qsir29xhxa`:
- type: `removal`
- description: `Removal requested for 118 Wood Way, frankfort, KY 40601`
- installation.propertyAddress: `118 Wood Way`
- InstallationLockboxes on that install:
  - `Sentrilock/Supra` · isRental=false · **code: null** · installed 2026-05-13

**Important finding — schema gap.** `InstallationLockbox` (the join row that represents what's at a property) has its own `code String?` column but does **not** have a `customerLockboxId` FK back to `CustomerLockbox`. So even though we know "the customer has a Sentrilock/Supra installed at 118 Wood Way," there's no link to **which** CustomerLockbox (and therefore which code) is on-site. Across the table:

- **Total InstallationLockbox rows: 19**
- **With `code` populated: 1** (≈5%)
- **With `code` NULL: 18** (≈95%)

This matches Ryan's "the lockbox in the SR doesn't have the code assigned to it." The code is sitting on `CustomerLockbox.code` in inventory, but the install-time wizard isn't copying it onto `InstallationLockbox.code` (and there's no FK to derive it later). SR emails today can't surface a code because the join row doesn't have it.

## Recommended fixes (for next round)

1. **Backfill 3 rows** — append `(Code: <code>)` / `(Serial: X · Code: Y)` to the 3 candidate OrderItem descriptions so existing pending orders (including PJ Elder's) display correctly in admin/customer order detail and any re-sent confirmations.
2. **Resend PJ Elder's confirmation** after backfill, or just rely on admin detail showing it.
3. **SR email enrichment** — at SR creation, query `installation.lockboxes` and, for each, render `{lockboxType.name} (Code: {code or '—'})` in the SR email body so the install crew sees what's on-site. Code-null cases show `(Code: —)` until we close the FK gap.
4. **Schema follow-up** (separate PR, larger) — add `InstallationLockbox.customerLockboxId String?` FK so InstallationLockbox can derive code/serial from CustomerLockbox at any time, and populate it when the installation is created from the order. Also: when an order with a lockbox completes, copy `CustomerLockbox.code` into `InstallationLockbox.code` to close the gap for existing installs.

Files relevant to fixes:
- `C:\Users\tanne\PPI\scripts\diagnose-lockbox-codes.js` (this diagnostic — reusable)
- `C:\Users\tanne\PPI\prisma\schema.prisma` (lines 309, 451, 549, 574 — CustomerLockbox / OrderItem / InstallationLockbox / ServiceRequest)