I have enough to report. Let me compile the findings.

---

# Admin Customer Page Map — `app/admin/customers/[id]/page.tsx` (1709 lines)

## 1. Page sections in order (line ranges)

| Section | Lines | Notes |
|---|---|---|
| Header (back link, name, role badge, Edit/Delete) | 503-548 | `Pencil` Edit triggers `setShowEditModal`; Delete calls `handleDeleteCustomer` |
| **Team Members card** (team_admin only) | 550-595 | Shows team name, Add Member button, `member.hasLogin` Badge |
| **Grouped view branch** (`useGroupedView`) | 597-841 | All round-11 layout lives inside this conditional |
| ├─ Other items card | 600-643 | The misclassified-data card Ryan flagged |
| ├─ "Add inventory" button row | 647-665 | Sign / Rider / Lockbox / Brochure Box admin shortcuts |
| ├─ Unassigned (team pool) `AgentInventorySection` | 668-680 | Pinned, `defaultOpen` |
| ├─ Sticky agent search input | 683-703 | `Search` icon + `agentSearch` state |
| ├─ Partitioned agent lists IIFE | 705-839 | "Agents with inventory" + "Agents with no inventory" Card collapsibles, pagination + SEARCH_CAP=200 |
| **Legacy 2-col view** (`!useGroupedView`) | 843-1072 | Signs / Riders / Lockboxes / Brochure Boxes / Other — used for non-team customers |
| **Bulk-reassign sticky bar** | 1075-1102 | Fixed bottom, only when grouped + `selectedItems.size > 0` |
| **Currently Deployed** (out-of-storage) | 1105-1172 | Amber card, "Return to inventory" per item |
| **Recent Orders** table | 1175-1220 | Last 10 orders |
| Edit Customer Modal | 1223-1299 | Role select + service-area exempt checkbox |
| Add Team Member Modal | 1302-1336 | name/email/phone |
| Add Inventory Modal | 1339-1462 | Per-type form + agent assign-at-add SearchableSelect |
| `AgentInventorySection` component | 1493-1601 | Title, summary counts, expandable, renders 4 `ItemList`s |
| `ItemList` component | 1621-1708 | Per-row checkbox + per-row SearchableSelect reassign + trash |

## 2. MUST be preserved (admin-only, not on team-admin view)

- **Header Edit Info / Delete buttons** — 529-545
- **Team Members section + Add Member** — 550-595, modal 1302-1336, handler `handleAddMember` 175-201
- **"+ Add inventory" button row** — 647-665 (and the modal 1339-1462). On team-admin's own dashboard these don't exist; admin needs them.
- **Edit Customer modal** with role selector + `is_service_area_exempt` checkbox — 1250-1289
- **Bulk-reassign sticky action bar** — 1075-1102 with handlers `toggleItemSelected` 307-315, `handleBulkReassign` 322-351, state `selectedItems` Map 100
- **Currently Deployed (out-of-storage)** card — 1105-1172, handler `handleReturnToStorage` 392-408
- **Recent Orders** table — 1175-1220
- No audit-trail viewer is present on this page.
- The role/exempt modal copy at 1261-1287 (last-admin warnings, exempt explainer).

## 3. REPLACED by new 4-card+filter layout

- Sticky search input & X-clear — 683-703
- State for it: `agentSearch`/`agentSearchDebounced` 106-107, debounce effect 115-118
- Unassigned pinned `AgentInventorySection` — 668-680
- Partitioned IIFE rendering "Agents with inventory" / "Agents with no inventory" Cards — 705-839
- Collapse state `withInventoryOpen`/`noInventoryOpen` 109-110, pagination `noInventoryLimit` 112, `SEARCH_CAP` 481
- `partitionedAgents` memo — 452-477
- Per-agent `AgentInventorySection` cards (still useful as primitive if rewritten, but the per-agent grouping disappears)
- The `grouped` useMemo that buckets by `assignedToMemberId` — 412-445 (replace with a per-type grouping where each item still carries `assignedToMemberId` for the inline dropdown)
- `ItemList` component — 1621-1708 (or refactor — the per-row SearchableSelect UX must stay, but it'll now live inside a per-type card, not a per-agent card)
- Imports `Search`, `ChevronDown` and probably `Users` partially — 6 (audit after rewrite)

The 4-card replacement still needs: per-type item cards (Signs/Riders/Lockboxes/Brochure Boxes), each row showing the item + lockbox code badge + per-row "Assign to agent" SearchableSelect + checkbox for bulk + delete. Top filter is a SearchableSelect over `data.team.members` (default "All agents") that filters the items by `assignedToMemberId`.

## 4. API data shape (already sufficient)

`GET /api/admin/customers/[id]` returns at `app/api/admin/customers/[id]/route.ts:173-235`:
- `team.members: Array<{ id, name, email, hasLogin }>` — 158-170 (for filter dropdown)
- `inventory.items.signs[] { id, description, inStorage, assignedToMemberId }` — 192-197
- `inventory.items.riders[] { id, riderName, inStorage, assignedToMemberId }` — 198-203
- `inventory.items.lockboxes[] { id, type, code, serialNumber, inStorage, assignedToMemberId }` — 204-211 (code badge already available)
- `inventory.items.brochureBoxes[] { id, description, inStorage, assignedToMemberId }` — 212-217
- `inventory.otherItems[]` (no assignedToMemberId column on `customer_other_items`) — 220-230
- `inventory.deployed.*` — 130-135 (Currently Deployed card)
- `orders[]` — 138-144 (Recent Orders)

**No API change required.** Note: `customer_other_items` lacks an `assignedToMemberId` column (per file:599 comment) — Ryan's reclassification ask MUST migrate rows into `CustomerSign`/`CustomerRider` tables, which DO have the column (file:196, 202).

`POST /api/admin/customers/[id]/inventory/bulk-reassign` (173 lines) already powers both bulk action bar and per-row reassign (`handleRowReassign` 354-390 sends single-item payload).

## 5. Non-team-admin customers

`useGroupedView = !!(data?.team && data.team.members.length > 0)` — line 448. Today, regular customers (no `teamId`) fall into the `!useGroupedView` branch at 843-1072, which renders the legacy 2-col aggregated view (no per-row checkboxes, no reassign).

**Recommendation:** keep the `!useGroupedView` fork. The new 4-card layout requires `data.team` to render the "Filter by agent" SearchableSelect; with no team, the dropdown is meaningless and the per-row reassign control is also meaningless (`teamMembers` empty). Either:
- (a) Keep current legacy 2-col view for non-team customers (cleanest), or
- (b) Render the new 4-card layout with the filter omitted and per-row reassign dropdown omitted when `!data.team || members.length === 0`.

Specialist A should pick (a) unless Ryan wants per-row item visibility for solo customers too — the legacy view aggregates by description (`signs[].quantity`, file:89-97), which loses per-instance identity (no `id`-per-row, no checkbox).

## Key files referenced
- `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx` (1709 lines)
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts` (398 lines)
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\route.ts` (373 lines)
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\bulk-reassign\route.ts` (173 lines)
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\team-members\route.ts`