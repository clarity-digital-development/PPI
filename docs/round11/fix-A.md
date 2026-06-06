Confirmed: the `scripts/_adjust-service-centers.ts` error pre-exists and is unrelated to my change. My edit introduces zero new TS errors.

C:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx:1248-1260

Replaced the plain `<select>` agent picker in the Add Inventory modal with `SearchableSelect`, mirroring the per-row reassign pattern (same options shape, "Search agents..." placeholder, pinned "Unassigned (team pool)" as first option with `value=''`). The `assigned_to_member_id` field name on the form/API payload is unchanged. `tsc --noEmit` is clean for this file (only pre-existing unrelated error in `scripts/_adjust-service-centers.ts:45`).