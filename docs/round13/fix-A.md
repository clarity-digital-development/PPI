Typecheck clean. All 11 entry points (5 cluster + 5 per-card + helper definition) now route through `openAddModal`.

**Diff locations** in `C:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx`:
- `:108-119` — new `openAddModal(type)` helper: when `agentFilter` is a real memberId (not `''` and not `'unassigned'`), seeds `formData.assigned_to_member_id` with it; otherwise leaves it `''`.
- `:637-651` — 5 top-cluster "Add inventory" buttons now call `openAddModal(<type>)`.
- `:818-822, :862-866, :918-922, :962-966, :987-991` — 5 per-card "Add" buttons (Sign / Rider / Lockbox / Brochure Box / Other) now call `openAddModal(<type>)`.

**Summary**: Added an `openAddModal` helper that pre-seeds `formData.assigned_to_member_id` from `agentFilter` when a specific agent is selected, leaving "All agents" and "Unassigned" untouched. Replaced all 10 inline open-modal handlers with calls to it so the auto-assign applies uniformly across every entry point.