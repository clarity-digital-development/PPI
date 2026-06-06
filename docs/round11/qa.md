One pre-existing error in `scripts/_adjust-service-centers.ts` (unrelated). Both specialists' files compile clean.

### Per-item verdict (A / B / C)

**A (Add-inventory modal SearchableSelect swap): PASS.** Diff shows the `<select>` at lines 1248-1257 replaced with `<SearchableSelect>` using the exact options shape and props the per-row reassign uses. Empty-string value preserved for "Unassigned (team pool)". `assigned_to_member_id` field name unchanged → no API contract change. One-line WHY comment present. Mirrors existing patterns in the file.

**B (Agent-list scaling): PASS with one minor note.** Implementation matches the design doc faithfully — sectioned partition (`withInventory` / `noInventory`) based on `total > 0`, alphabetical case-insensitive sort via `localeCompare`, 150ms debounce, sticky search, pagination cap of 50 with "Show 50 more", search override that auto-expands sections and caps at 200, overflow message, empty-state Card, Unassigned pinned above and unaffected by search. `SearchableSelect` mount cost stays zero at rest because `AgentInventorySection`'s `open` guard is preserved (defaultOpen=false on all wrapped sections). No `any`. Per-row + bulk reassign handlers untouched (only indentation differs on one `onReassign` line). 
*Minor:* The "Show more" button label `Show {Math.min(50, noRemaining)} more agents ({noRemaining} remaining)` is slightly more verbose than the design spec's `Show 938 more agents` but it's clearer for the user — non-blocking.

**C (Customer-list role filter): PASS.** Three pill row inserted between header and table, styling mirrors `app/admin/inventory/page.tsx:170-184` exactly (`bg-pink-500 text-white` active / `bg-gray-100 text-gray-600` idle). URL state via `router.replace(..., { scroll: false })`, hydrates from `?role=` on mount. API guard correct: `isInternalAdmin` gate (`user.role !== 'team_admin'`) prevents a team_admin from crafting `?role=team_admin` and seeing other brokerages — their `roleScope` stays locked to `{ role: 'customer', teamId: ... }`. Invalid `role=` values fall through to the default `in: ['customer','team_admin']` union. `search` + `role` coexist via shared `URLSearchParams`.

### Code-quality issues
- **Item 4 (Semonin rename) NOT IN DIFF.** No code, migration, or script renames `supportstaff@semonin.com`'s `fullName`/`name` to "Semonin Broker Account". Docs in the working tree still call it "Admin Team Account". Local Postgres is offline (ECONNREFUSED on port 5432) so I cannot directly confirm DB state, but there is **no committed work for this rename**. Either it was done as a manual SQL run that's already in prod (not auditable from repo) or it was missed entirely. Verdict: **unverifiable — flag back to operator**.
- `initialRole` IIFE in `app/admin/customers/page.tsx:36-39` runs every render but is only consumed by `useState`'s initializer — harmless, but a `useState<RoleFilter>(() => { ... })` lazy initializer would be marginally cleaner.
- No `any` introduced. Types are tight: `RoleFilter`, `narrowRole`, `partitionedAgents` member shapes are all inferred or explicitly typed correctly.

### Typecheck status
`npx tsc --noEmit`: clean for all three changed files. The single pre-existing error in `scripts/_adjust-service-centers.ts:45` is unrelated (baseline).

### Behavioral verification result
- **Initial render, no search, 1000 agents:** Unassigned card (open) + sticky search input + "Agents with inventory" Card (open, ~10 collapsed agent cards) + "Agents with no inventory" Card (collapsed, header only). ~12 DOM-rendered agent cards; ~990 dormant. `SearchableSelect` count at rest: 0 (every agent card defaults closed; popovers only mount on user click).
- **Type query in search:** 150ms debounce → `partitionedAgents` re-memos → both sections force-open (`isSearching` disables collapse toggle) → results capped at 200. Overflow hint renders past 200.
- **Unassigned pinning:** Card rendered above the sticky search input, not inside the partitioned block. Unaffected by `agentSearchDebounced` (verified — the search filter only touches `withInventory`/`noInventory` arrays, not the `grouped.unassigned` bucket fed to the pinned card).
- **Per-row reassign / bulk reassign:** handlers (`handleRowReassign`, `handleBulkReassign`) untouched. `AgentInventorySection` props unchanged. The sticky action bar lives elsewhere and was not modified.
- **URL state:** `/admin/customers?role=team_admin&search=acme` reload → `initialRole='team_admin'`, search input pulls from local state (`search` state isn't currently URL-hydrated — pre-existing, not regressed).

### Recommendation
**SHIP A, B, C** — they meet spec, typecheck clean, and don't regress round 4/5 work.

**HOLD on item 4 (Semonin rename) until verified** — no code in this branch implements the rename; operator must confirm whether (a) the rename was applied directly to prod DB out-of-band (in which case mark verified and add a one-line note to the changelog), or (b) it was missed and still needs a small migration script. Cannot validate locally — DB connection refused.