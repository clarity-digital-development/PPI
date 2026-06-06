# Agent-List Scaling + UI Polish Design

## 1. Agent-list pattern: **D primary + A supporting** (collapsible by inventory-presence, with search)

**Primary structure** — three stacked sections with collapse state:

```
[Unassigned (team pool)]        <- always pinned, always open
[Search agents...        ]      <- sticky filter, debounced 200ms
[Agents with inventory (12) v]  <- open by default
  - alphabetical cards
[Agents with no inventory (988) >]  <- collapsed by default
  - on expand: render first 50, "Show 938 more" button
```

**Why D over A/B/C:**

- **D vs A (search + pagination):** Pagination as the *primary* mechanism hides the 10-or-so agents who actually have inventory behind a page picker. The 90/10 split (most agents have nothing, a few have everything) is the dominant shape — D makes that visible at a glance, A flattens it.
- **D vs B (tabs):** Tabs add a click before any data appears. Collapse sections show the inventory-bearing agents inline with zero interaction, and the "no inventory" count tells you whether to bother expanding.
- **D vs C (virtualization):** No new dep. At 1000 collapsed cards, each is a `<button>` + 2 text spans = ~5 DOM nodes/card = 5k nodes. That's fine; React reconciliation handles it. The expensive thing isn't DOM count — it's `SearchableSelect` instances (addressed in §3).
- **The search bar (borrowed from A)** is the supporting element. Filters BOTH sections simultaneously by name/email. When a query is active, both sections auto-expand and pagination caps lift (filtered results always fully shown, up to a 200-row safety cap).

This serves all three use cases:
- **"Find Agent X to reassign":** type name → instant filter across both sections.
- **"See what each agent has":** default view shows exactly the agents with inventory; collapsed section gives the headcount context.
- **"Find departing agent's inventory":** "Agents with inventory" section IS the answer — already filtered to the meaningful set.

## 2. Behavior contract

**Search input:**
- Fields searched: `member.name`, `member.email` (lowercased substring match, both sides lowercased).
- Debounce: **200ms** (client-side filter only, no network — faster than the 300ms used for server round-trips).
- Placeholder: `Search agents by name or email...`.
- Clear button (X) when non-empty.
- Sticky positioning: `sticky top-0 z-10 bg-white` within the agents container so it stays accessible during scroll.

**Sort:**
- Within each section: alphabetical by `name` (case-insensitive, `localeCompare`). Server currently returns `createdAt asc` — sort client-side in the `grouped` memo; cheap at 1000 items.
- Inventory section sorted by name, NOT by inventory count desc (avoids the list reshuffling as items move).

**Sectioning rule:**
- "Agents with inventory" = `member.total > 0` where `total = signs + riders + lockboxes + brochureBoxes` (already computed in `AgentInventorySection` — lift to the memo).
- "Agents with no inventory" = `member.total === 0`.

**Pagination shape:**
- "No inventory" section: collapsed by default. On expand, render first **50** alphabetically. Footer: `Show 938 more agents` button → renders next 50, repeat. No numbered pages. Reset to 50 when section collapses.
- "With inventory" section: no pagination (this set is bounded by reality — agents you've actually assigned items to. If it exceeds 100, render all anyway; that's still ~500 DOM nodes for collapsed cards).
- When search is active: ignore pagination caps; render all matches up to a 200-result safety cap with a "Refine your search" hint past that.

**Unassigned pinning:**
- Always rendered first, outside the two sections, regardless of search query.
- Search DOES filter inventory inside the Unassigned bucket (by item description/MLS, if we have it) — wait, scope check: search is for *agents*, not items. Unassigned has no agent name to match. Decision: **Unassigned card is unaffected by search**; it stays open and visible. The search input UI should make this clear via placeholder copy ("Search agents..." — Unassigned is not an agent).
- `defaultOpen={true}` preserved.

**Empty states:**
- No agents at all on team: render existing fallback (non-grouped per-card view stays as-is for teams of 0).
- Search returns 0 matches: `No agents match "<query>"` inline message in place of both sections; Unassigned still shown above.
- "No inventory" section with 0 members: hide the section header entirely.

## 3. Performance budget

**Initial render (no search, default collapse state):**
- 1 Unassigned card (open, full content).
- 1 search input.
- 1 "With inventory" section header + ~10 cards (open, with content + per-item rows + 1 `SearchableSelect` per row for reassign).
- 1 "No inventory" section header (collapsed, just a button + count).

**DOM cost:** ~10 expanded agent cards with their inventory tables = the dominant cost, identical to today's UX for a team of 10. The 990 hidden agents cost zero DOM until expanded.

**`SearchableSelect` constraint** — this is the real budget item:
- `SearchableSelect` mounts a popover internally but the popover content is only rendered when `open === true` (verified at `components/ui/SearchableSelect.tsx`). The collapsed closed state is just a `<button>` with current value text. Cheap.
- The per-row reassign select (one per inventory item) renders ONLY when the agent card is expanded AND the item exists. Items are bounded by what an agent actually has (typically <50), not by total agents.
- **Key invariant:** never render `SearchableSelect` for collapsed agent cards. Today's `AgentInventorySection` already guards content behind `open` — preserve that. Result: at 1000 agents, default view has SearchableSelect instances ≈ (items on the ~10 inventory-bearing agents) ≈ 50-200. Identical to today's small-team scale.
- When the 50-cap pagination expands "No inventory" agents — those have zero items by definition, so zero SearchableSelects.

No virtualization needed. No `react-window` dep.

## 4. Customer list filter (item 3)

Three-pill row mirroring `app/admin/inventory/page.tsx` lines 170-184:

```
[All] [Customers] [Team Admins]
```

State: `useState<'' | 'customer' | 'team_admin'>('')`. Server-side via `?role=` param honored ONLY when caller is internal admin (preserve `roleScope` constraint at `route.ts` lines 25-28). Add to `URLSearchParams` so refresh preserves filter. Insert as a second row beneath the search input (full-width search on mobile preserved). Skip "Agents" pill — agents aren't `User` rows, they're `TeamMember` rows; out of scope.

## 5. Add-inventory modal swap

Drop-in. Replace `<select>` at lines 1248-1257 with:

```tsx
<SearchableSelect
  value={formData.assigned_to_member_id}
  onChange={(next) => setFormData({ ...formData, assigned_to_member_id: next })}
  options={[
    { value: '', label: 'Unassigned (team pool)' },
    ...data.team.members.map(m => ({ value: m.id, label: m.name })),
  ]}
  placeholder="Select agent..."
/>
```

Mirrors the per-row pattern at lines 1443-1446 exactly. No event-wrapper needed (component takes raw string in `onChange`).

## Effort estimates

| Item | Estimate |
|---|---|
| 1. Add-inventory modal SearchableSelect swap | **15 min** |
| 2. Agent-list scaling (search + sectioned collapse + pagination) | **1.75 h** |
| 3. Customer list role filter pills (UI + API param) | **45 min** |
| `tsc --noEmit` + smoke pass | **15 min** |
| **Total** | **~2.75 h** |

Within the 3h budget. Item 2 is the only non-mechanical piece; items 1 and 3 are confined to known patterns already in the codebase.