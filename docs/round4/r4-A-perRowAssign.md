Clean typecheck. Done.

Files modified:
- `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx`

Summary:
- Added a per-row `SearchableSelect` to each item row inside `ItemList` in the agent-grouped admin customer detail view, matching the team-admin Team Inventory UX.
- Introduced `handleRowReassign` that reuses `/api/admin/customers/[id]/inventory/bulk-reassign` with a single-item payload, so we inherit the existing held-item conflict handling (alerts the admin to release the hold via Admin → Inventory Holds on 409 `items_held`).
- Plumbed `teamMembers`, `currentMemberId` (null for the Unassigned bucket, member.id for each per-agent bucket), and per-row in-flight state through `AgentInventorySection` → `ItemList`; `tsc --noEmit` passes clean.