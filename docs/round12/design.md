# Implementation Spec — Admin Team-Admin Inventory View + Other-Items Recategorization

**Branch:** `ryan-feedback-2026-06-02` • **Target:** <= 4h total • **Parallelizable:** UI + Migration

---

## 1. UI Specialist — Admin Team-Admin Account Inventory Rewrite

**File:** `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx`

### 1.1 Hierarchy / surgical edits

**KEEP unchanged** (preserve verbatim):
- Header + Edit/Delete (503-548)
- Team Members section + Add Member (550-595)
- "+ Add inventory" button row (647-665) — move it to live just above the new 4-card grid inside the team-admin branch
- Bulk-reassign sticky action bar (1075-1102) + `selectedItems` Map state (line 100) + `toggleItemSelected` (307-315) + `handleBulkReassign` (322-351)
- Currently Deployed card (1105-1172)
- Recent Orders (1175-1220)
- All 3 modals (1223-1462)
- `!useGroupedView` legacy branch (843-1072) — **non-team customers unchanged**

**REPLACE lines 597-841** (the entire `useGroupedView` block including the legacy "Other items" card) with new 4-card layout.

**DELETE** along with the replaced block:
- State: `agentSearch` / `agentSearchDebounced` (106-107), `withInventoryOpen` / `noInventoryOpen` (109-110), `noInventoryLimit` (112), `SEARCH_CAP` (481)
- Debounce effect (115-118)
- `grouped` useMemo (412-445), `partitionedAgents` memo (452-477)
- `AgentInventorySection` component (1493-1601)
- `Search`, `ChevronDown` imports if unused after delete (audit)

**KEEP** `ItemList` component (1621-1708) — extract per-row JSX into a smaller `<InventoryRow>` helper or reuse `ItemList` directly inside each per-type card. The per-row checkbox + SearchableSelect + trash UX stays identical.

### 1.2 New 4-card layout (inside `useGroupedView` branch)

```tsx
// Branch unchanged
const useGroupedView = !!(data?.team && data.team.members.length > 0);

if (useGroupedView) {
  return (
    <>
      {/* "+ Add inventory" button row — moved here from 647-665 */}
      <FilterByAgentCard members={data.team.members} value={agentFilter} onChange={setAgentFilter} />
      <div className="grid md:grid-cols-2 gap-6">
        <InventoryCard type="sign"          items={filteredSigns}          ... />
        <InventoryCard type="rider"         items={filteredRiders}         ... />
        <InventoryCard type="lockbox"       items={filteredLockboxes}      ... />
        <InventoryCard type="brochure_box"  items={filteredBrochureBoxes}  ... />
      </div>
    </>
  );
}
```

`InventoryCard` mirrors `/app/dashboard/inventory/page.tsx:399-491` markup verbatim:
- Header: icon-tile (`FileImage`/`Tag`/`Lock`/`Archive` in `w-10 h-10 rounded-lg bg-pink-100`) + `<h3>` + `"{N} in storage"` count
- `ScrollableList` wrapper capped ~280px
- Empty state: `"No {type}s in storage"` italic gray
- Per-row: `<Package>` icon + truncated label + **inline mono badge for lockbox `.code`** (only renders when `code` populated — same conditional as `page.tsx:310-314`) + right-side `SearchableSelect` for reassign + checkbox for bulk + trash

### 1.3 Filter-by-agent contract

```ts
const [agentFilter, setAgentFilter] = useState<string>(''); // '' = all, 'unassigned' = null, else memberId

const memberOptions = [
  { value: '', label: 'All agents' },
  ...data.team.members.map(m => ({ value: m.id, label: m.name })),
  { value: 'unassigned', label: 'Unassigned' },
];

const matchesFilter = (item: { assignedToMemberId: string | null }) =>
  agentFilter === '' ? true
  : agentFilter === 'unassigned' ? item.assignedToMemberId === null
  : item.assignedToMemberId === agentFilter;
```

**Client-side filter only** — `data.inventory.items.*` is already loaded; no refetch on filter change. The team-admin's `/dashboard/inventory` refetches; we don't because the admin API returns the full set in one call.

### 1.4 Per-row reassign — REUSE round-11 endpoint

Reuse existing `handleRowReassign` (354-390) **as-is**:

```ts
handleRowReassign(item.id, type, newMemberId)
  → POST /api/admin/customers/[id]/inventory/bulk-reassign
    body: { items: [{ id, type }], assignToMemberId: newMemberId | null }
```

No new endpoint. No API change. **Do NOT** wire the new layout to `/api/teams/inventory` PATCH — admin path stays admin path.

### 1.5 Non-team customer branch

Unchanged. `!useGroupedView` → legacy 2-col aggregated view (843-1072). The "Other items" card (600-643) deletes from the team-admin branch but the legacy branch already has its own "Other" rendering — **leave it alone**; after migration runs in prod, the array will be empty and the section auto-hides via existing `.length > 0` guards.

### 1.6 UI effort: **~2h**

---

## 2. Migration Specialist — Recategorize CustomerOtherItem

**File:** `c:\Users\tanne\PPI\scripts\_recategorize-other-items.ts` (new)

### 2.1 CLI contract

```
npx tsx scripts/_recategorize-other-items.ts [--dry-run] [--include-tests]
```

- Default: writes. Use `--dry-run` first in prod.
- `--include-tests`: process rows matching `/test|asdf|^\.+$/i`. Default skips them and logs to skip list.

### 2.2 Parsing rules (validated against Explorer C's 23 distinct descriptions)

```ts
// Normalize first
const norm = description.trim().replace(/\s+/g, ' ');

// 1. Test-data guard
if (!includeTests && /\btest\b|asdf|^\.+$/i.test(norm)) → SKIP (log to needs_review)

// 2. Agent-prefix peel (only if parent has a team)
if (parent.teamId) {
  for (const member of teamMembers) {
    const prefix = member.name + ' ';
    if (norm.toLowerCase().startsWith(prefix.toLowerCase())) {
      assignedToMemberId = member.id;
      remainder = norm.slice(prefix.length).trim();
      break; // first match wins; log warning if 2+ members would match
    }
  }
}
const typeStr = remainder ?? norm;

// 3. Type routing (case-insensitive)
if (/rider/i.test(typeStr))                                            → CustomerRider*
else if (/brochure(?!\s+box\s+frame)/i.test(typeStr))                  → CustomerBrochureBox
else if (/lockbox/i.test(typeStr) && !/stake for lockbox/i.test(typeStr)) → CustomerLockbox*
else if (/frame|post|sign|bracket|directional|wire|metal|for sale|open house|neighborhood/i.test(typeStr))
                                                                       → CustomerSign
else                                                                   → SKIP (needs_review)
```

\* **CustomerRider / CustomerLockbox require FK lookups** (`riderId`, `lockboxTypeId`). Per Explorer C, the **only** lockbox-keyword row is `"stake for lockbox"` (a sign accessory) which routes to CustomerSign via the exclusion above. **No rider-keyword rows exist** in the current 97. Implement the Rider/Lockbox branches defensively (skip + log to needs_review if encountered) — don't try to guess catalog FKs.

### 2.3 Quantity-N splitting

`CustomerOtherItem` has a `quantity` column. For each row: create N individual rows on the target table (loop, no `createMany`, so each gets its own id and createdAt). Per Explorer C the 2 Nadia Holliday rows are `x2` — that's where splitting matters.

### 2.4 Per-row transaction shape

```ts
for (const row of otherItems) {
  const decision = parse(row);
  if (decision.skip) { needsReview.push({ row, reason: decision.reason }); continue; }

  if (dryRun) { plan.push({ rowId: row.id, target: decision.target, qty: row.quantity, memberId: decision.memberId }); continue; }

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < row.quantity; i++) {
      await tx[decision.targetTable].create({
        data: {
          userId: row.userId,
          description: decision.remainder ?? row.description, // verbatim — printed labels stay legible
          inStorage: true,
          assignedToMemberId: decision.memberId, // null when no team or no agent match
          createdAt: row.createdAt,
        },
      });
      created++;
    }
    await tx.customerOtherItem.delete({ where: { id: row.id } });
  });
}
```

### 2.5 Idempotency

After a clean run, `customer_other_items` is empty → next run finds 0 rows → no-op. **Do not** add a guard against re-creating CustomerSigns; the script only acts on rows still present in `customer_other_items`, so deletion of the source row is the natural idempotency boundary.

### 2.6 Audit row (single, at end)

```ts
await audit({
  actorId: 'system',
  action: 'data_migration.recategorize_other_items',
  meta: { dryRun, processed, created, deleted, skipped, needsReview: needsReview.length, byTarget: { sign: N, rider: 0, lockbox: 0, brochureBox: 0 } },
});
```

### 2.7 Output

Console + write `scripts/_recategorize-other-items.report.json` with:
- `processed`, `created`, `deleted`, `skipped`
- `needs_review[]`: `{ id, userId, description, quantity, reason }` for human triage
- `agent_match_warnings[]`: rows where 2+ TeamMembers matched the prefix

### 2.8 Validation hooks before write

- Re-query Explorer C's expected target distribution: post-run, expect ~82 new CustomerSign rows + 2 deleted test rows. Log a delta if reality differs by >5%.
- Refuse to run on non-dev DB if `processed > 200` (safety guard against catalog explosion).

### 2.9 Migration effort: **~1.5h**

---

## 3. Edge Cases (both specialists)

| Case | Handling |
|---|---|
| Customer has no team | Migration: `assignedToMemberId = null`. UI: falls into `!useGroupedView` branch, unchanged. |
| Ambiguous agent prefix (2 TeamMembers same name) | First match wins; push to `agent_match_warnings[]`. Per Explorer C this is **0 rows** today. |
| Trailing whitespace / mixed case | `norm = description.trim().replace(/\s+/g, ' ')`; all regexes are `/i`. |
| Quantity = 0 row | Skip + log to needs_review. |
| Parent userId missing / orphaned row | Skip + log to needs_review. |
| Lockbox `.code` not populated | Badge conditional renders only when truthy — same as source `page.tsx:310-314`. |
| 0 agents on team (team_admin with empty roster) | `useGroupedView` = false (`members.length > 0` guard at 448) → legacy view. No surprise. |
| Filter set to deleted agent | Won't happen — `data.team.members` is the source of truth for both filter options and item.assignedToMemberId. |

---

## 4. Explicit Defer List (NOT this round)

- Round 11 bulk-reassign sticky bar — **unchanged**
- Role filter on `/admin/customers` index — **unchanged**
- Legacy quantity-bump UI for non-team customers — **unchanged**
- Schema changes — **none** (Other table stays in schema, just unused after migration)
- `/api/teams/inventory` GET admin override — **not needed** (admin uses its own endpoint)
- Audit-trail viewer on customer page — **not added**

---

## 5. Parallelization Contract

**Zero file collision.** UI specialist owns `app/admin/customers/[id]/page.tsx`. Migration specialist owns new `scripts/_recategorize-other-items.ts`. Migration writes Prisma rows; UI reads via existing `/api/admin/customers/[id]` (already returns all 4 item types with `assignedToMemberId`, per Explorer B §4). 

**API contract frozen:** UI relies on `POST /api/admin/customers/[id]/inventory/bulk-reassign` body `{ items: [{ id, type }], assignToMemberId }` — unchanged from round 11.

**Sync point:** after both land, run migration in dev with `--dry-run`, eyeball the report, then write. Then load admin customer page for `supportstaff@semonin.com` (the 6-agent-prefix customer) to visually confirm the 6 Semonin rows now show under the right agents in the new 4-card layout.

---

## 6. Effort Summary

| Phase | Owner | Time |
|---|---|---|
| UI rewrite (replace 597-841, add 4-card grid, wire filter) | A | 2h |
| Migration script + report + dry-run validation | B | 1.5h |
| `tsc --noEmit` + visual smoke test in dev | both | 0.5h |
| **Total** | | **~4h** |