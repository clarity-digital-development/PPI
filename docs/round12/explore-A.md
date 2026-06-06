I have everything needed. Let me give the report.

---

# Team Inventory View Mapping — for Specialist A

## 1. Filter-by-agent control

- **Component:** `SearchableSelect` from `@/components/ui` (`app/dashboard/inventory/page.tsx:6`).
- **Markup:** lines `364–380` — wrapped in a `Card variant="bordered"` with a "Filter by agent" label.
- **State:** `agentFilter` (`page.tsx:119`); `'' = all agents`, `'unassigned'` = only unassigned items, or a `TeamMember.id`.
- **Sentinel:** `''` is "All agents" (label set at `page.tsx:287`).
- **Options shape** (`page.tsx:286–290`):
  ```
  [{ value: '', label: 'All agents' },
   ...members.map(m => ({ value: m.id, label: m.name })),
   { value: 'unassigned', label: 'Unassigned' }]
  ```
- **Interaction:** filter change triggers `useEffect` (`page.tsx:165–186`) → refetches `/api/teams/inventory?member_id=<filter>`. Server-side filter, not client-side.

## 2. The 4 cards

- **File:line range:** `page.tsx:399–491` (the `grid md:grid-cols-2 gap-6` block).
- **Card header format:** icon-tile + `<h3>Signs</h3>` + `<p>{N} in storage</p>` (e.g. `page.tsx:407–410` for Signs; identical pattern for Riders `425–433`, Lockboxes `447–456`, Brochure Boxes `470–479`).
- **Icons** (lucide-react, `page.tsx:7`): `FileImage` (Signs), `Tag` (Riders), `Lock` (Lockboxes), `Archive` (Brochure Boxes). Each in a `w-10 h-10 rounded-lg bg-pink-100` tile.
- **Empty state per card:** `<p className="text-sm text-gray-500 italic">No signs in storage</p>` (and analogous strings) — e.g. `page.tsx:418, 441, 464, 487`.
- **Item-row markup:** single `renderItem(type, item)` helper (`page.tsx:300–341`) — used for all four types. Renders:
  - `<Package>` icon + truncated `item.label`
  - inline `item.code` mono badge if present (`page.tsx:310–314`) — **this is the lockbox code rendering** (same JSX used for all types but only lockboxes populate `code` in the API).
  - right-side `SearchableSelect` for assignment (only rendered when `hasMembers`)
  - "Add team members on My Team" inline link when no members exist (`page.tsx:330–337`)
  - inline error message (`page.tsx:338`)
- **ScrollableList wrapper** (`page.tsx:45–67`): caps card body height at ~280px (5 rows) and scrolls within the card, with "Showing all {N} — scroll to see more" footer.

## 3. Data shape returned by API

`GET /api/teams/inventory[?member_id=...]` (`app/api/teams/inventory/route.ts:8–79`) returns:
```ts
{
  members: { id: string; name: string }[],   // active TeamMembers (removedAt: null)
  signs:        TeamItem[],
  riders:       TeamItem[],
  lockboxes:    TeamItem[],  // includes `code` (lockbox.code)
  brochureBoxes: TeamItem[]
}
// TeamItem = { id, label, code?, inStorage, assignedToMemberId }
```
Filtering happens server-side via the `assignWhere` clause (`route.ts:17–22`).

## 4. Per-row assign API

- **Endpoint:** `PATCH /api/teams/inventory` (`route.ts:91–146`).
- **Body:** `{ type: 'sign'|'rider'|'lockbox'|'brochure_box', id: string, memberId: string | null }`.
- **Admin compat (CRITICAL for the lift):** already handles admins. `route.ts:109` skips the `item.userId !== user.id` ownership check when `user.role === 'admin'`; `route.ts:119` skips the same-team check for admins. So the admin can PATCH any team-admin's item — **same endpoint works as-is.**
- **GET also admin-safe?** Partially. `route.ts:26,30,34,40` always filters `userId: user.id` — so an admin hitting `/api/teams/inventory` sees their OWN inventory, not the customer's. **Specialist A will need either** (a) a new query param like `?user_id=<customerId>` admin-only, or (b) a parallel admin endpoint, or (c) reuse the round-11 admin inventory endpoint already wired into `/admin/customers/[id]`. Recommend (a) — minimal surface, same response shape.
- Client-side call: `page.tsx:229–233`. Optimistic update with rollback (`page.tsx:226, 246`).
- Active-cart guard: `route.ts:126–142` returns 409 with `code: 'item_held'` and `expires_at`.

## 5. Edge cases

- **0 agents:** `hasMembers = false` (`page.tsx:281`) → per-row `SearchableSelect` is **not rendered** (`page.tsx:317`); inline "Add team members on the My Team page" link shown (`page.tsx:330–337`). Filter dropdown still renders with `'All agents'` + `'Unassigned'` only.
- **1 agent:** Works normally — `memberOptions` = `['Unassigned', <that agent>]`; filter = `['All agents', <agent>, 'Unassigned']`.
- **1000 agents:** `SearchableSelect` has a `searchPlaceholder="Search agents..."` (`page.tsx:324, 375`) — it's a *searchable* select, so scale is handled via type-to-filter. No virtualization confirmed (would need to inspect `components/ui/SearchableSelect`), but the search input mitigates UX. Server returns full member list every fetch — no pagination on `members` array (`route.ts:43–48`).
- **Filter mismatch after assign:** lines `239–243` re-fetch with the active filter so reassigned items disappear from the filtered view correctly.
- **All-empty inventory:** `hasTeamInventory = false` (`page.tsx:292–297`) → renders a single empty card with `Archive` icon and contextual copy depending on whether `agentFilter` is active (`page.tsx:386–397`).

## Key files for Specialist A
- `c:\Users\tanne\PPI\app\dashboard\inventory\page.tsx` (team-admin view: lines 279–499)
- `c:\Users\tanne\PPI\app\api\teams\inventory\route.ts` (GET + PATCH — PATCH already admin-aware; GET needs an admin override for `userId`)
- `ScrollableList` helper: `page.tsx:45–67`
- `HowInventoryWorks` helper: `page.tsx:70–107`
- `renderItem` helper: `page.tsx:300–341`