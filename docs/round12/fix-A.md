All dead references gone.

---

**Files touched:**
- `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx`

**Line ranges (post-edit):**
- L6 — imports: dropped `ChevronDown`, `Search`; added `FileImage`
- L104-107 — state: dropped 5 vars + debounce effect, added `agentFilter`
- L302-324 — replaced `grouped` + `partitionedAgents` memos with single `filteredInventory` memo (filters by `agentFilter`)
- L538-781 — replaced the entire team-admin `useGroupedView` branch (was 244 lines of partitioned/sectioned/searchable agent list) with new layout: `+ inventory` row, "Filter by agent" SearchableSelect, 4-card grid (Signs/Riders/Lockboxes/BrochureBoxes), and a conditional "Other" card pinned at the bottom that only renders when `otherItems.length > 0`
- L1417-1660 — deleted: `AgentBucket`, `AgentInventorySectionProps`, `AgentInventorySection`, `ItemListProps`, `ItemList` (all now dead)

File shrank from 1710 → 1416 lines.

**Summary (3 lines):**
1. Lifted the team-admin's `/dashboard/inventory` 4-card layout into the admin's `/admin/customers/[id]` page for `team_admin` customers: items now flatten into Signs/Riders/Lockboxes/BrochureBoxes cards with per-row `SearchableSelect` to reassign, lockbox `.code` rendered as inline mono badge, identical "X in storage" counters and ScrollableList semantics (max-h-280px after 5 rows).
2. Removed the round-11 partitioned UI (sticky agent search, Unassigned-pinned card, "Agents with inventory" / "Agents with no inventory" collapsibles, AgentInventorySection helper, ItemList helper, partitionedAgents memo) — replaced with one `agentFilter` SearchableSelect (`All agents` / per-member / `Unassigned`) and a single `filteredInventory` memo doing client-side filter over the already-loaded `data.inventory.items`.
3. Preserved verbatim: header + Edit Info/Delete, Team Members card, bulk-reassign sticky action bar + `selectedItems` state + `toggleItemSelected` + `handleBulkReassign`, `handleRowReassign` (still hits `/api/admin/customers/[id]/inventory/bulk-reassign` with `target_member_id`), Add inventory buttons (now include `+ Other` since the dedicated "Other" card lost its `+ Add` button), Currently Deployed card, Recent Orders, all 3 modals, and the non-team-customer `!useGroupedView` legacy branch (843+ lines unchanged). `npx tsc --noEmit` clean for `app/admin/customers/[id]/page.tsx`.

**Screenshot-worthy description:** A `team_admin` customer's admin page now opens with the same calm 4-card grid the broker sees on their own dashboard — pink-100 icon tiles (FileImage / Tag / Lock / Archive), "Signs / Riders / Lockboxes / Brochure Boxes" headings with `{N} in storage` underneath, individual rows like "789 Pine Rd — Coming Soon" each with a right-aligned "Assign to agent" dropdown defaulting to the current assignee (or "Unassigned"). A single "Filter by agent" SearchableSelect above the grid scopes all four cards at once. Lockbox rows show their code as a `font-mono` gray pill next to the type. Above the filter sits the admin-only `+ Sign / + Rider / + Lockbox / + Brochure Box / + Other` button row; below the grid the catch-all "Other" card only appears when there's leftover unmigrated data. The familiar bulk-reassign pink action bar still slides up from the bottom when items are checked.