# Implementation Plan — Ryan 6/3 Follow-up (6 ship items + 1 research)

## §1. Team Inventory — searchable agent filter
**Files**
- ADD: `components/ui/SearchableSelect.tsx` (~80 LOC, shared primitive)
- MODIFY: `app/dashboard/inventory/page.tsx` lines 372-388 (filter) and 326-334 (per-row assign)

**Sketch**
```tsx
// SearchableSelect.tsx
type Option = { value: string; label: string }
export function SearchableSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => options.filter(o =>
    o.label.toLowerCase().includes(query.toLowerCase())), [options, query])
  // input + popover <ul>, Arrow/Enter/Esc, click-outside close (useRef + useEffect)
  // displays options.find(o => o.value === value)?.label when closed
}
```
Swap `<Select options={filterOptions} ...>` → `<SearchableSelect ...>` at `:379`. Per-row assign Select swap is optional but recommended for consistency.

**Effort:** 1h (primitive + 2 swap sites)
**Risk:** Low. Keyboard nav is the only fiddly part — test Esc-to-close, click-outside, Enter-to-pick-highlighted. No new deps.

---

## §2. Place Order — searchable agent picker
**Files**
- MODIFY: `app/dashboard/place-order/page.tsx` lines 233-278

**Sketch** — inline filter, no new primitive (the picker is already a `<Card>` list, not a `<select>`):
```tsx
const [agentQuery, setAgentQuery] = useState('')
const filteredMembers = useMemo(() => {
  const q = agentQuery.trim().toLowerCase()
  return q ? teamMembers.filter(m =>
    m.name.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q))
    : teamMembers
}, [teamMembers, agentQuery])

// Above the card list, between :238 and :252:
<Input
  type="search"
  autoFocus
  placeholder="Search agents by name or email…"
  value={agentQuery}
  onChange={e => setAgentQuery(e.target.value)}
  onKeyDown={e => {
    if (e.key === 'Enter' && filteredMembers.length >= 1)
      handleSelectMember(filteredMembers[0])
  }}
/>
{agentQuery && <p className="text-xs text-gray-500">
  {filteredMembers.length} of {teamMembers.length} agents
</p>}
```
Replace `teamMembers.map(...)` with `filteredMembers.map(...)` at :253. Add `<EmptyState>` when filtered = 0.

**Effort:** 30min
**Risk:** None. Pure client-side, full roster already loaded.

---

## §4. Team Inventory — agent-name one-line CSS fix
**Files**
- MODIFY: `app/dashboard/inventory/page.tsx` lines 322-324 and 407

**Sketch** — Option A (preferred): drop the Badge entirely (the per-row assign Select already shows the assignee name in its collapsed trigger). Delete lines 322-324.

If Ryan wants to keep the visual chip, Option B:
```tsx
<Badge variant={...} className="whitespace-nowrap max-w-[140px] truncate">
  {memberName(item.assignedToMemberId)}
</Badge>
```
Plus widen the team-admin grid to single column at `:407`: `grid gap-6` (drop `md:grid-cols-2`).

**Effort:** 15min
**Risk:** None.

---

## §5. Checkout — remove "agent who sold this property" tag
**Files**
- MODIFY: `components/order-flow/steps/review-step.tsx` lines 1246-1264

**Sketch** — single deletion of the entire `{isTeamAdmin && !isEdit && (<div className="p-4 bg-pink-50 ...">...</div>)}` block. `formData.placed_for_agent_name` is already seeded by `place-order/page.tsx:228` from the picker and continues to flow through `handleSubmit`/`handleAddToCart`/batch endpoint → DB.

**Effort:** 15min
**Risk:** Zero. Value still propagates; no submit-logic change. Verify the legacy admin "on behalf of" fallback at `handleAddToCart:498-509` still hits `/api/admin/customers/[id]` (it does — that path is preserved).

---

## §6. Cart — per-row Edit button
**Files**
- MODIFY: `app/dashboard/cart/page.tsx` lines 299-316 (add Edit button)
- MODIFY: `app/dashboard/place-order/page.tsx` (read `cart_item_id` from `useSearchParams`, hydrate wizard)
- MODIFY: `components/order-flow/order-wizard.tsx` (thread `editingCartItemId` prop)
- MODIFY: `components/order-flow/steps/review-step.tsx` lines 430-530 (`handleAddToCart` branch)

**Sketch**
```tsx
// cart/page.tsx — next to Remove:
<Link href={`/dashboard/place-order?cart_item_id=${item.id}`}>
  <Button variant="ghost" size="sm">Edit</Button>
</Link>

// place-order/page.tsx:
const cartItemId = searchParams.get('cart_item_id')
const editingItem = cartItemId ? items.find(i => i.id === cartItemId) : null
// when editing, skip the agent-picker gate, use editingItem.agentId
// pass initialFormData={editingItem.formData}, editingCartItemId={cartItemId}, key={cartItemId}

// review-step.tsx — handleAddToCart:
if (editingCartItemId) {
  const oldKeys = new Set(Object.keys(existingItem.holdIds))
  const newKeys = new Set(/* derived from items */)
  const toAcquire = [...newKeys].filter(k => !oldKeys.has(k))
  const toRelease = [...oldKeys].filter(k => !newKeys.has(k))
  // ACQUIRE FIRST (with existing cartItemId), unwind on 409
  // THEN release stale holds (404 on dead holds is harmless)
  updateItem(editingCartItemId, { formData, items, estimatedTotal, holdIds, holdsExpireAt })
  router.push('/dashboard/cart')
}
```
**Critical:** acquire-then-release order. Set `key={cartItemId}` on `<OrderWizard>` to force remount per-row (avoids stale `useState` seed bug).

**Effort:** 2h
**Risk:** Medium. Hold-diff is the failure surface. Test: edit row, swap one sign → other sign succeeds. Edit row with already-expired holds (rows in `expiredRows`) → treat all as toAcquire, skip release.

---

## §7. Admin Add Inventory — quantity for "other"
**Files**
- MODIFY: `app/admin/customers/[id]/page.tsx` line 935-943

**Sketch** — drop the `addType !== 'other'` guard around the Quantity input. Verify `app/api/admin/customers/[id]/inventory/route.ts` POST handler loops on `quantity` for `other` type (it should — GET aggregation works, so multi-row insert must exist).

**Effort:** 15min (5min if POST already supports it)
**Risk:** None.

---

## §8. Admin customer detail — per-agent collapsible sections
**Files**
- MODIFY: `app/api/admin/customers/[id]/route.ts` — add `inventory.items` (per-row); drop `role === 'team_admin'` guard on team load (use `customer.teamId`)
- MODIFY: `app/admin/customers/[id]/page.tsx` lines 406-633 — replace 5-card grid with agent-grouped sections

**Sketch** — server (additive, no breakage):
```ts
// route.ts — append to inventory block
items: {
  signs: signsRaw.map(s => ({ id: s.id, description: s.description,
    size: s.size, inStorage: s.inStorage, assignedToMemberId: s.assignedToMemberId })),
  riders: ridersRaw.map(r => ({ ... })),
  lockboxes: lockboxesRaw.map(l => ({ ... })),
  brochureBoxes: brochureBoxesRaw.map(b => ({ ... })),
}
```
Client:
```tsx
const grouped = useMemo(() => groupByAgent(inventory.items, team.members), ...)
// render:
<OtherCard items={inventory.otherItems} />  // unchanged
{grouped.unassigned.total > 0 && (
  <AgentSection title="Unassigned" defaultOpen items={grouped.unassigned} />
)}
{team.members.map(m =>
  <AgentSection key={m.id} title={m.name} summary="4 signs · 2 riders" items={grouped[m.id]} />
)}
<BulkActionBar selectedIds={selected} onApply={(targetId) =>
  fetch(`/api/admin/customers/${id}/inventory/bulk-reassign`, {
    method: 'POST',
    body: JSON.stringify({ items: selected, target_member_id: targetId })
  })
} />
```
Each `<AgentSection>` uses existing `<Accordion>` primitive, renders 4 sub-lists (Signs/Riders/Lockboxes/Brochure), per-row checkbox + Trash. Bulk-reassign endpoint already exists.

**Effort:** 2h
**Risk:** Low–medium. Additive API change is safe (other consumers — `app/admin/orders/[id]/page.tsx:500`, `place-order/page.tsx`, `review-step.tsx:101` — keep working). Watch: the existing per-card rider `+/−` quantity buttons go away (rows are individual now) — flag to Ryan in PR description as intentional UX simplification.

---

## §10. Rural-area coverage — research summary

**Recommended:** USDA RUCA ZIP-code lookup (Approach A from the research doc). Import the free public RUCA 2020 XLSX (~41k rows) into a static `rural_zip` table; flag ZIPs with primary code 8-10 as `is_surcharge`. At checkout, helper `classifyAddress(zip)` returns `{applies, amount_cents:2000, reason}` from a pure DB read — no runtime API call, no key, no rate limit. Display as a discrete "Rural delivery fee" line item between subtotal and tax with a tooltip explaining the drive-time rationale, surfaced as soon as the ZIP validates in the wizard (not at final review). Admin override on the order detail page: Waive button + reason note + audit row; admins can also retroactively apply the surcharge for misclassified ZIPs without a deploy by editing the boolean directly.

- **Schema:** new `rural_zip` table; add `rural_surcharge_cents`, `rural_surcharge_waived`, `rural_surcharge_reason` columns on `orders`. Rate in `app_settings`.
- **Rollout:** ship behind `rural_surcharge_enabled=false`, dry-run against 90 days of orders, spot-check ~20 KY ZIPs vs Google drive time, then enable.
- **Upgrade path:** Census urbanized-area shapefile + point-in-polygon (Approach B) is a drop-in replacement behind the same `classifyAddress` signature if ZIP-level proves too coarse.

Total estimate: ~8h / one focused day. Defer to follow-up PR.

---

## Workflow — Parallel Implementation Plan

**Dependency map**

| Item | Touches | Blocks / Blocked by |
|---|---|---|
| #1 Team Inv search | `SearchableSelect.tsx` (new), `inventory/page.tsx` | Independent |
| #2 Place Order search | `place-order/page.tsx` | Touches same file as #6 → **sequential with #6** |
| #4 CSS one-line fix | `inventory/page.tsx` | Same file as #1 → **sequential with #1** |
| #5 Remove agent tag | `review-step.tsx` | Same file as #6 → **sequential with #6** |
| #6 Cart Edit | `cart/page.tsx`, `place-order/page.tsx`, `order-wizard.tsx`, `review-step.tsx` | Blocks #2 and #5 |
| #7 Other quantity | `admin/customers/[id]/page.tsx` | Same file as #8 → **sequential with #8** |
| #8 Admin per-agent | `admin/customers/[id]/page.tsx`, `api/admin/customers/[id]/route.ts` | Blocks #7 |

**Suggested allocation — 3 agents, 2 waves**

**Wave 1 (parallel):**
- **Agent A** — Items #1 + #4 (same file, sequential within agent): build `SearchableSelect`, swap into Team Inventory, then apply CSS fix. ~1h15.
- **Agent B** — Item #6 alone: Cart Edit end-to-end (cart page, place-order hydration, wizard prop, review-step hold diff). ~2h. Highest-risk piece.
- **Agent C** — Item #8: API additive change + admin page refactor. ~2h.

**Wave 2 (parallel, after Wave 1 merges):**
- **Agent D** — Items #2 + #5 (depend on #6's edits to place-order + review-step landing first to avoid merge churn). ~45min total.
- **Agent E** — Item #7 (depends on #8 landing to avoid grid-vs-section conflicts). ~15min.

**Total wall time:** ~2h (Wave 1) + ~45min (Wave 2) = **~2h45 with 3 agents in parallel**, vs ~7h sequential. Agent B (Cart Edit) is the critical path — start it first, do not block.

**Pre-flight:** confirm `app/api/admin/customers/[id]/inventory/route.ts` POST handles `other` with `quantity > 1` (loop-insert) before starting #7 — if not, add 15min to #7 for server work.