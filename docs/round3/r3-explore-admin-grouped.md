I have enough context. Returning the analysis.

---

# Admin Customer Detail — Per-Agent Inventory Refactor Map

## 1. Current inventory display (admin page)

File: `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx` (lines 406–633)

A `grid lg:grid-cols-2 gap-6` of 5 type-specific cards, each with the same skeleton: icon + heading + "Add" button in the header, then a list (or empty state) below.

| Card | Lines | Row content | Row actions |
|---|---|---|---|
| Signs in Storage | 408–452 | `description (×qty)` + optional `size` | Trash only |
| Riders in Storage | 455–511 | `rider_type` | `−`/`+` quantity, Trash |
| Lockboxes in Storage | 514–558 | `lockbox_type` + optional `Code: ...` | Trash |
| Brochure Boxes | 561–586 | Single count tile | None (count summary, not per-item) |
| Other | 589–632 | `description (×qty if >1)` | Trash |

Below the grid (lines 636–703): a separate **"Currently Deployed"** card listing per-item rows for items where `inStorage=false`, with a "Return to inventory" button each.

Crucially: **no agent attribution is visible anywhere on this page today**. The page has zero awareness of `assignedToMemberId` even though the data exists on every row in `customer_signs`/`riders`/`lockboxes`/`brochure_boxes`.

## 2. Current GET response shape

File: `c:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts` (lines 9–210)

```
{
  customer: { id, email, full_name, phone, company_name, license_number: null, role },
  team: null | { id, name, members: [{ id, name, email, hasLogin }] },
  inventory: {
    signs:          [{ id, description, size: null, quantity }]    // AGGREGATED by description, line 89-97
    riders:         [{ id, rider_id, rider_type, quantity }]       // AGGREGATED by riderId,    line 100-114
    lockboxes:      [{ id, lockbox_type_id, lockbox_type, lockbox_code }]  // INDIVIDUAL (each has a code), line 117-122
    brochureBoxes:  null | { id, quantity }                         // AGGREGATED to single count, line 125-127
    otherItems:     [{ id, description, quantity }]                // AGGREGATED by description, line 190-200
    deployed: {                                                     // line 130-135 — per-item, inStorage=false
      signs:        [{ id, description }],
      riders:       [{ id, rider_type }],
      lockboxes:    [{ id, lockbox_type, lockbox_code }],
      brochureBoxes:[{ id, description }],
    }
  },
  orders:        [{ id, order_number, status, total, created_at }],
  installations: [{ id, address, city, post_type, status, installation_date }],
}
```

**Aggregation discards both row identity and `assignedToMemberId`.** The `id` field on each aggregated entry is just the first row that matched the description/type key — it is NOT the canonical id for the group. Bulk-reassign (`/api/admin/customers/[id]/inventory/bulk-reassign`) requires actual per-row `customer_signs.id`, `customer_riders.id`, etc., so the current shape cannot feed it.

## 3. What needs to change in GET

We need per-row data with assignment. Three options:

**A. Group server-side by agent.** Returns `inventoryByAgent: { unassigned: {...}, byMemberId: { [id]: {signs:[], riders:[], ...} } }`. Pro: client renders directly. Con: harder to filter/sort across groups, and removes the existing aggregated lists the page still uses for Brochure Box count + the existing "Other" card (not agent-bound).

**B. Include `assignedToMemberId` on each existing aggregated entry.** Doesn't work — aggregation collapses rows that may have different assignments (e.g., 4 "For Sale" signs split 2/Ashley + 1/Brent + 1/unassigned). You'd lose information.

**C. (Recommended) Add a new `inventoryItems` field with raw per-row data, keep existing aggregations intact.** The page can opt into the new field when rendering the new grouped view, but the legacy aggregations remain for callers that still want a flat count.

Shape addition:
```
inventory.items: {
  signs:    [{ id, description, size, inStorage, assignedToMemberId, heldUntil }]
  riders:   [{ id, riderId, rider_type, inStorage, assignedToMemberId, heldUntil }]
  lockboxes:[{ id, lockbox_type, lockbox_code, inStorage, assignedToMemberId, heldUntil }]
  brochureBoxes:[{ id, description, inStorage, assignedToMemberId, heldUntil }]
  // "other" intentionally omitted — no assignedToMemberId column on customer_other_items
}
```

This is the same shape `/api/teams/inventory` already returns to the team-admin Team Inventory page (see `app/dashboard/inventory/page.tsx` line 22–36) — proven UI pattern, minimal new server logic.

## 4. Blast radius of the GET change

Consumers of `GET /api/admin/customers/[id]`:
- `app\admin\customers\[id]\page.tsx` — the page we're refactoring.
- `app\admin\orders\[id]\page.tsx` (line 500) — fetches the customer when admin views an order placed on behalf.
- `components\order-flow\steps\review-step.tsx` (line 101) — order wizard prefills.
- `app\dashboard\place-order\page.tsx` — same.

Choosing **option C (additive field, no removals)** means all four consumers continue to work unchanged. Only the admin customer page reads the new `inventory.items`. Zero breakage.

One small migration: `customer.role === 'team_admin' && customer.teamId` — for the agent grouping to make sense we also want it to work for `role === 'customer'` with a team (currently `team` is only populated for team_admin, see line 159). Drop the `role === 'team_admin'` guard — load `team` whenever `customer.teamId` is set.

## 5. Proposed new UI

Replace the 5-card grid (signs/riders/lockboxes/brochure/other) with a **two-tier layout**:

- **Top: an "Other" card** stays as-is (no agent grouping; `customer_other_items` has no assignment column).
- **Below it: per-agent collapsible sections** driven by `team.members` + `inventory.items`.

Each section header:
```
[chevron] Ashley Wright            4 signs · 2 riders · 1 lockbox      [Reassign selected ▾]
```

Expanding the section reveals 4 sub-cards (Signs / Riders / Lockboxes / Brochure Boxes) showing per-row items belonging to that agent. Each row has:
- Item description / code
- Checkbox for multi-select
- Inline Trash button (existing per-item delete API still works)

Pinned at the top: an **Unassigned (n)** section, expanded by default if `n > 0` — the most common "needs attention" state.

Toolbar above the sections:
- **Bulk action bar** appears when ≥1 checkbox is selected: `N selected — Reassign to [agent ▾] [Apply]` → POSTs to `/api/admin/customers/[id]/inventory/bulk-reassign` with `{ items: [{type, id}], target_member_id }`. Already implemented.
- Search/filter input to narrow by item label across all sections (nice-to-have).
- "Add inventory" button (top right) opens the existing modal — same agent dropdown on add path stays.

Deployed (out-of-storage) card stays below, but rows now also show a small agent badge.

The existing per-card `Quantity ± Trash` for riders becomes per-row Trash only (since rows are individual now); admins increment by clicking "Add" again. Net UX win — no more confusion that the rider qty buttons are a separate concept from per-row deletes.

## 6. Item #7 — Quantity field for "other"

`app\admin\customers\[id]\page.tsx` line 935–943: the Quantity Input is rendered only `{addType !== 'other' && ...}`. Drop the guard so the field shows for `other` too.

Server already supports it: `app\api\admin\customers\[id]\inventory\route.ts` POST handler for `other` should be checked to confirm it loops on `quantity` (currently the GET aggregates `otherItemsRaw` by description with `quantity += 1`, so the POST is presumably inserting N rows — quick verification needed, but the data model clearly supports it because aggregation works).

Add a tiny note in the modal: "Each copy will appear as a separate row but grouped by description."

---

**Estimated effort confirmed:** ~2h for item #8 (GET adds 1 field of per-row data ~30 min, page refactor ~1.25 h, wiring bulk-reassign UI ~15 min). Item #7 is ~5 min.

Files touched for #8:
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts` — add `inventory.items` block, drop `team_admin` guard on team load.
- `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx` — replace 5-card grid with agent-grouped collapsible sections + bulk action bar.

Files touched for #7:
- `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx` — line 935 condition.