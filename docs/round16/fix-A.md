All deliverables complete. Here's the summary:

---

**ISSUE 1 — Shipped end-to-end**

**Schema (pushed to live Railway):**
- `c:\Users\tanne\PPI\prisma\schema.prisma:362-374` — added `assignedToMemberId String?` + `@@index` to `CustomerOtherItem`. `npx prisma db push --accept-data-loss` succeeded; `npx prisma generate` regenerated client.

**API — admin GET (`c:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts`):**
- Lines 213-218: added `items.otherItems` per-row array for the grouped UI.
- Lines 220-234: legacy grouped `otherItems` now keys on `(description, assignedToMemberId)` so two agents' identically-named items don't collapse, and the row carries `assignedToMemberId`.

**API — bulk reassign (`c:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\bulk-reassign\route.ts`):**
- Line 7: widened type union to include `'other'`.
- Line 79: added `other: []` bucket.
- Lines 142-150: added `customerOtherItem.updateMany` branch (no hold-precheck — Other has no hold columns).
- Line 162: added `other:` count to audit metadata.

**API — inventory POST (`c:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\route.ts`):**
- Line 166: `other` create now passes `assignedToMemberId`.
- Line 180-189: dropped `type !== 'other'` guard so the assign audit fires for Other too.

**UI — admin customer page (`c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx`):**
- Line 30: widened `otherItems` aggregated type to carry `assignedToMemberId`.
- Line 36: added `items.otherItems` per-row type.
- Line 100, 309, 357: widened `selectedItems`/`toggleItemSelected`/`handleRowReassign` unions to include `'other'`.
- Lines 244-246: forward `assigned_to_member_id` for Other too.
- Lines 419, 433-434: filter-by-agent now filters `otherItems`.
- Line 568-570: `renderRow` type widened to include `'other'`.
- Lines 770-791: replaced the standalone Other card with a grid-resident Card that uses `renderRow('other', ...)` — same per-row Assign SearchableSelect as Signs/Riders/Lockboxes/BrochureBoxes.
- Line 1374: dropped `addType !== 'other'` gate on the Add modal's Assign-to-agent picker.

**Backfill (`c:\Users\tanne\PPI\scripts\_backfill-other-assigned-member.ts`):**
- Longest-name-first, case-insensitive, requires trailing space, refuses empty result, idempotent (skips already-assigned).

Dry-run output:
```
Scanning 30 unassigned CustomerOtherItem rows...
Matched 6 rows.
Skipped 21 rows (customer has no team).
Skipped 3 rows (no agent-name prefix match).
```
The 6 matches were exactly the Semonin items from the screenshot (Peggy Heckert/Nadia Holliday/Jennifer Carroll × Metal Frame/Post).

Apply output: `APPLIED — updated 6 rows, audit row written.`

**Verification on live DB (post-apply):** Semonin's 9 other items now read e.g. `assigned=Peggy Heckert  desc="Metal Frame"` instead of having the agent name baked into description. The 3 generic rows ("Black Metal Frame", "4x8 Large White Frame") correctly remained unassigned — admin can now reassign them in-place via the new dropdown.

**`npx tsc --noEmit` exit code: 0.**