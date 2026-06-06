All confirmed. Here is the QA report.

### Per-piece verdict (A / B)

**A (Miss #1 — Contextual auto-assign): PASS**
- Helper `openAddModal` at `page.tsx:108-118` correctly gates on `agentFilter && agentFilter !== 'unassigned'`. Empty string (All agents) and `'unassigned'` both fall to `preassign=''`, matching the spec ("behavior stays as today").
- All **10** open-modal entry points migrated to the helper (5 cluster buttons `:637-651`, 5 per-card buttons `:820, :864, :920, :964, :989`). Spot-checked — no stray `setShowAddModal(true)` calls remain outside the helper.
- Other-case description-reset preserved via the spread `...(type === 'other' ? { description: '' } : {})` — preserves the prior inline `setFormData({ ...formData, description: '' })` behavior.
- Modal dropdown at `:1389-1390` reads `formData.assigned_to_member_id`, so pre-seeding via state works correctly. The assign UI is hidden for `'other'` (`:1382`), so seeding it on Other is harmless.

**B (Miss #2 — Quantity bug): PASS**
- Client fix at `page.tsx:237-241` now forwards `body.quantity = formData.quantity` in the Other branch. Previously dropped → server saw `undefined` → clamped to 1.
- Server handler at `route.ts:163-171` already does the correct fan-out for Other (`Array.from({length: quantity}, …)` → `createMany`). No server change needed for correctness — only the safety cap.
- Safety cap added at `route.ts:29-30`: `Math.min(50, Math.max(1, parseInt(data.quantity) || 1))`. This caps **all** types (sign/rider/lockbox/brochure_box/other), not just Other. Reasonable defensive change; no realistic admin add exceeds 50.
- Schema verified — `CustomerOtherItem` (schema.prisma:356-365) has no `quantity` column. Fan-out (a) is correct; matches the round-12 migration's per-row granularity model and Frame 18's "x2" rendering (UI groups duplicate descriptions).

### Code-quality issues

- **Minor — stale-state risk in `openAddModal`**: the helper does `setFormData({ ...formData, ... })` without resetting `quantity`, `size`, `rider_type`, `lockbox_code`, etc. If an admin opens Add Sign, types quantity=5, cancels, then opens Add Rider, the rider modal will inherit `quantity=5`. This is **pre-existing behavior** (the old inline handlers also didn't reset), so not a regression — but worth a follow-up. Not a ship blocker.
- No `any` introduced. The `body` type stays `Record<string, unknown>`.
- WHY comments are one-liners (`:108`, `:239`, `:29`). Convention respected.
- No regression of round-12 work: the 4-card filtered layout (lines `:803-985`) is structurally unchanged — only button `onClick` handlers swapped. The `agentFilter` state, `filteredInventory` memo, and `SearchableSelect` filter UI at `:648-650` are untouched.
- `audit()` not added for plain Other creates — consistent with the existing convention that `InventoryAssign` only fires when `assignedToMemberId` is set, and Other never has one. Correct call.

### Typecheck status

`npx tsc --noEmit` → **EXIT=0, clean**. No errors, no warnings.

### Behavioral verification result

Dev server not running, so verified via static trace (not live Playwright):

**Miss #1 trace** — `agentFilter='cmXYZ...'` (specific agent) → click `+ Sign` → `openAddModal('sign')` → `preassign='cmXYZ...'` → `setFormData({...formData, assigned_to_member_id:'cmXYZ...'})` → modal opens → dropdown at `:1388-1398` reads `formData.assigned_to_member_id='cmXYZ...'` → renders that agent pre-selected. **Correct.**

With `agentFilter=''` (All) or `'unassigned'` → `preassign=''` → dropdown defaults to "Unassigned (team pool)". **Matches spec.**

**Miss #2 trace** — Add Other with `description='Metal frame test'`, `quantity=3` → client body `{type:'other', description:'Metal frame test', quantity:3}` → server `quantity = min(50, max(1, 3||1)) = 3` → falls to `quantity !== 1` branch → `prisma.customerOtherItem.createMany({data:[{...},{...},{...}]})` → 3 rows in `customer_other_items` → `fetchCustomer()` refetches → UI groups duplicate descriptions → renders "Metal frame test x3". **Correct.**

Edge: `quantity=99` (malicious) → clamps to 50. `quantity=0`/NaN/negative → clamps to 1. **Safe.**

No DB writes performed (no live test data to clean up).

### Recommendation: **SHIP**

Both fixes are minimal, correct, type-clean, and consistent with the round-12 architecture. The one minor observation (stale `formData.quantity` carrying across modal opens) is pre-existing, not a regression, and out of scope for this fix.