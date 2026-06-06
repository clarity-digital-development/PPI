I have everything needed. Producing the report now.

---

# Explorer A Report — Customer Detail Page Surfaces

## 1. Add Inventory modal — agent-assignment dropdown

**File:** `app/admin/customers/[id]/page.tsx`

**Entry points** that open the modal (each sets `addType` and calls `setShowAddModal(true)`):
- Top-level "Add inventory" action bar in grouped view: lines **604, 607, 610, 613** (Sign / Rider / Lockbox / Brochure Box buttons).
- Non-grouped fallback per-card "Add" buttons: lines **665, 712, 770, 818, 846** (Signs, Riders, Lockboxes, Brochure Boxes, Other).
- Grouped-view Other-items card "Add" button: line **562**.

**The dropdown that picks WHICH agent the new item goes to** lives inside the shared Add Inventory `<Modal>` and renders only when `addType !== 'other' && data.team && data.team.members.length > 0`:
- Conditional block: **lines 1243-1262**
- `<select>` element: **lines 1248-1257**
- Current `onChange` shape: `(e) => setFormData({ ...formData, assigned_to_member_id: e.target.value })` (line 1250).
- Value source: `formData.assigned_to_member_id` (string; declared at line 79, reset at lines 249, and submitted at lines 229-231).
- Options: `<option value="">Unassigned (team pool)</option>` plus `data.team.members.map(m => <option value={m.id}>{m.name}</option>)`.

**Drop-in replacement to `SearchableSelect`** is mechanical: map the same `members` to `{ value: m.id, label: m.name }` plus a leading `{ value: '', label: 'Unassigned (team pool)' }` (identical to the per-row pattern already used at lines 1443-1446), then pass `onChange={(next) => setFormData({ ...formData, assigned_to_member_id: next })}`. The `SearchableSelect` API (`components/ui/SearchableSelect.tsx` lines 12-23) takes string `value`/`onChange` — no event wrapper needed.

**Second dropdown of the same shape** (bulk reassign action bar) at **lines 893-902** — same swap applies if we want consistency, though it's out of scope per the brief.

## 2. Per-agent list — what renders the cards

**File:** `app/admin/customers/[id]/page.tsx`, range **lines 550-651** (grouped-view block, gated by `useGroupedView` at line 434).

- Card component: `AgentInventorySection` (defined lines **1301-1409**), one per `TeamMember`.
- "Unassigned (team pool)" card rendered first at **lines 620-632** with `defaultOpen` true.
- Per-agent map: **lines 634-649** — iterates `data.team.members` in array order, no sort/filter/search.
- Source data: the `grouped` `useMemo` at **lines 398-431** buckets `data.inventory.items.*` by `assignedToMemberId` into `{ unassigned, [memberId]: bucket }`. Pre-creates an empty bucket per known member at lines **410-412** so every agent gets a card even when empty.

**Existing client-side state we can hook a search/filter into:**
- `data.team.members` (line 23 type) — already in memory client-side, perfect to filter.
- `grouped` map — can be re-derived against a filtered member list.
- New `useState` for query is the natural addition; no parent state refactor needed.
- `AgentInventorySection`'s `open` state is local to each instance (line 1314) — virtualizing or paginating won't lose collapse state across the visible window but *will* reset state for off-screen items (acceptable trade-off).

## 3. API for customer detail — pagination?

**File:** `app/api/admin/customers/[id]/route.ts`, GET handler **lines 9-240**.

- Returns the **entire** TeamMember list inline at **lines 159-171** (`prisma.team.findUnique` with `teamMembers: { where: { removedAt: null }, orderBy: { createdAt: 'asc' } }`). **No pagination, no limit, no search param.**
- Also returns every `CustomerSign`/`CustomerRider`/`CustomerLockbox`/`CustomerBrochureBox` row for the customer in `inventory.items.*` (lines 191-218), and aggregates them client-side into `grouped`.
- **Constraint for scaling**: everything is client-side after one fetch. For 1000 agents this means a single response with `team.members[0..999]` + N inventory rows per agent. If we want server-paginated agents, we'd add `?membersPage=` + `?membersSearch=` params and refactor the buckets. The cheapest first step is client-side virtualization/search over the existing payload.

## 4. Scaling-friendly patterns already in the codebase

- **Debounced search input** — same 300 ms `setTimeout` pattern in `app/admin/customers/page.tsx` lines **47-49** and `app/admin/inventory/page.tsx` lines **57-59** (both server-round-trip; for our case we'd debounce a *client-side* filter — even simpler, no `useEffect` needed).
- **`SearchableSelect`** at `components/ui/SearchableSelect.tsx` — has built-in `useMemo`-based filter (lines 46-50), keyboard nav, `scrollIntoView` for highlighted item (lines 76-80). Search-as-you-type is already battle-tested.
- **Scrollable bounded list** — Team Members card at line **525** caps height at `max-h-[300px]` when `> 5` members. Same trick is used for riders at line **722**. Cheap, works fine for ~50 items, breaks for 1000 (no row recycling, every DOM node still mounted).
- **No virtualization libs in `package.json`** — confirmed read of full `package.json` (lines 18-42): no `react-window`, `react-virtual`, `@tanstack/react-virtual`. Adding one is an option but introduces a new dep. For 1000 agents with collapsed-by-default cards each rendering only a header (a `<button>` + 2 lines of text), pure-DOM with a search/filter likely suffices without virtualization.
- **No `useDebounce` hook in `components/ui` or `lib/`** — `Grep` for `useDebounce|debounce` returned only the two inline `setTimeout` usages above.
- **Server-side pagination pattern** on other admin list pages: `app/admin/customers/page.tsx` reads `data.total` separately from `data.customers` (line 38), suggesting `/api/admin/customers` supports a count + a slice — useful reference if we go server-side.

## 5. TeamMember row counts (DB unreachable locally)

`prisma.teamMember.count()` against the live DB returned `ECONNREFUSED` from this sandbox (script: `C:\Users\tanne\PPI\scripts\check-tm-spread.ts`). I did not fabricate numbers. Production counts will need to be pulled via Render's DB shell or a deployed admin route. From schema/code inspection: every active `TeamMember` row contributes one collapsible card; per-agent inventory is `CustomerSign + CustomerRider + CustomerLockbox + CustomerBrochureBox` rows where `assignedToMemberId = member.id`. Tanner's stated 1000-agent target is the planning input.

## Recommended scaling approach (preview for Explorer B / planner)

Given the constraints above, the cheapest path with the highest UX payoff:
1. **Replace the per-agent cards rendering loop with a search-filtered, virtualized-ish list:** a top-of-section `<input>` filters `data.team.members` by name/email in a `useMemo`. Render only the filtered slice; cap visible cards at e.g. 50 and add "Show all (N)" / pagination control. "Unassigned" stays pinned at top.
2. **Total-count badges per card** are already computed (`total` at line 1321) — surface them in the collapsed header so admins can find agents with inventory without expanding.
3. **Sort:** alphabetical by `name` (current order is `createdAt asc` per the API at line 162 — unhelpful at scale).
4. Defer server-side agent pagination until item count actually justifies it (>500 visible agents per customer is unlikely in v1).

Key files for downstream work:
- `C:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx` (modal swap @ 1248-1257; per-agent loop @ 634-649; `grouped` memo @ 398-431)
- `C:\Users\tanne\PPI\components\ui\SearchableSelect.tsx` (drop-in API)
- `C:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts` (lines 159-171 — where any server-side member pagination would live)