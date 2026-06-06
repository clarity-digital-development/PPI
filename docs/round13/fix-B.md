Both edits are intact and typecheck is clean.

---

**Miss #2 — Quantity bug in Add Other Item modal — FIXED**

**Approach:** Fix (a) — fan out N rows. `CustomerOtherItem` has no `quantity` column (schema.prisma:356-365), so schema-stable client-side fix.

**Diff:**
- `C:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx:237-241` — Add Other branch now forwards `formData.quantity` to the POST body (previously dropped, causing `parseInt(undefined) || 1 → 1` on the server).
- `C:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\route.ts:29-30` — Added 50-row safety cap to the `quantity` clamp so no single request can fan out unbounded rows.

**Why:** The server `'other'` handler at `route.ts:162-170` already correctly fans out N rows via `Array.from({length: quantity}, …)` + `createMany`. The bug was purely client-side: the `else if (addType === 'other')` branch only set `body.description`, never `body.quantity`. Frame 18's "x2" display works because the UI counts duplicate-description rows (per-row granularity model established by the round-12 migration).

**Verification:**
- `npx tsc --noEmit` → exit 0 (clean).
- Logic trace: submit `{description:"Metal frame test", quantity:2, addType:"other"}` → client sends `{type:"other", description:"Metal frame test", quantity:2}` → server `quantity = min(50, max(1, 2||1)) = 2` → falls into `quantity !== 1` branch → `prisma.customerOtherItem.createMany({ data: [{...}, {...}] })` → 2 rows in `customer_other_items` for that `userId` → UI groups duplicates and renders "Metal frame test x2".
- Server-side safety: quantity=99 from a malicious client clamps to 50; quantity=0 / NaN / negative clamps to 1.

**No schema migration required.** No new audit entry added — the existing audit at `route.ts:180-188` already excludes `'other'` by convention (no `assignedToMemberId` column on the table) and only fires for assignment-at-add events; plain inventory creates of other types aren't audited either, so adding one just for Other would be inconsistent.