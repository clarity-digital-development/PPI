No general Combobox primitive exists — only `AddressAutocomplete` (Google Maps specific). Note: TodoWrite is not needed for a single mapping/research task.

## Findings

**File:** `c:\Users\tanne\PPI\app\dashboard\inventory\page.tsx` (this IS the Team Inventory page — same route renders the team-admin view when `role === 'team_admin'`).

### 1. Current shape of the agent filter
- Component: native `<Select>` primitive (`components/ui/select.tsx`) — wraps a real `<select>` element, so the dropdown is **OS-native and cannot be styled or made searchable**.
- Populated at `inventory/page.tsx:291-295` from `teamInventory.members` (fetched from `/api/teams/inventory`):
  ```
  const filterOptions = [
    { value: '', label: 'All agents' },
    ...members.map((m) => ({ value: m.id, label: m.name })),
    { value: 'unassigned', label: 'Unassigned' },
  ]
  ```
- Rendered at `inventory/page.tsx:372-388` inside a `Card` ("Filter by agent" label).
- State: `agentFilter` string (`:119`), passed as `?member_id=` query param on refetch (`:171`).

### 2. Where the agent name renders on each inventory row
- `inventory/page.tsx:322-324` — inside `renderItem(...)`:
  ```
  <Badge variant={item.assignedToMemberId ? 'info' : 'neutral'}>
    {memberName(item.assignedToMemberId)}
  </Badge>
  ```
- The per-row assignment `<Select>` (which also shows the name when collapsed) is at `:326-334`.

### 3. CSS classes governing row layout
Row container at `inventory/page.tsx:310-337`:
- `<li className="p-3 bg-gray-50 rounded-lg">`
- Outer flex: `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3` (`:311`)
- Left cluster (icon + label + code): `flex items-center gap-3 min-w-0` with `<span className="text-sm text-gray-700 truncate">` (`:312-320`)
- Right cluster (Badge + Select): `flex items-center gap-2 flex-shrink-0` (`:321`)
- Parent column: each card lives in `<div className="grid md:grid-cols-2 gap-6">` (`:407`) — so on desktop the row is **half-viewport wide**, and Badge + Select fight the label for that ~400px slot.

### 4. Proposed CSS for name-wrap fix
The Badge has no `max-w` or `whitespace-nowrap` and the right cluster is `flex-shrink-0`, so the Badge text wraps inside its pill. Two minimal options:

**Option A (preferred, lowest risk):** Drop the Badge — the assign `<Select>` already shows the assignee name in its collapsed trigger. Removes redundancy AND solves the wrap.

**Option B (keep Badge):** Add `whitespace-nowrap max-w-[140px] truncate` to the Badge at `:322-324` and `min-w-0` to the right cluster at `:321` so it can compress instead of forcing a wrap. Also widen the desktop grid to single column for the team view (`grid gap-6` instead of `grid md:grid-cols-2 gap-6` at `:407`) — gives each row full width.

### 5. Proposed change: filter → searchable input
**No reusable Combobox exists.** `AddressAutocomplete` is Google-Maps-bound and not reusable.

Recommend a **new minimal primitive** `components/ui/SearchableSelect.tsx` rather than inline pattern, because we also need it on Place Order (item #2) and likely Admin customer detail (#8). Minimum surface:
```
<SearchableSelect
  value={agentFilter}
  onChange={setAgentFilter}
  options={filterOptions}   // same {value,label}[] shape as Select
  placeholder="Search agents…"
/>
```
Implementation: text `<input>` + filtered `<ul>` popover, keyboard nav (Arrow/Enter/Esc), click-outside close, controlled value. No new deps — ~80 LOC. Mirrors existing `Select` API so the swap is one-line at `:379-384` and at the per-row Select at `:326-334` (per-row swap optional but consistent).

### 6. Reuse footprint
The same `members.map(m => ({value, label}))` pattern appears in:
- `app/dashboard/teams/page.tsx` — team management roster (probably doesn't need search)
- `app/dashboard/order-history/page.tsx` — likely has the agent filter Ryan also flagged
- `app/dashboard/service-requests/page.tsx`
- `app/admin/customers/[id]/page.tsx` — relevant to item #8
- The per-row assign `<Select>` inside this same file (`:326`)
- **Place Order** (item #2) will need the same fix in its agent picker

→ Building `SearchableSelect` as a shared primitive is justified. Place Order (#2) confirmation will need a separate mapping pass to locate its agent picker, but it will consume the same component.