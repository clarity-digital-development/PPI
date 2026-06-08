I have sufficient information. Let me compile the report.

---

**ISSUE 1 SURFACE MAP**

**1. Schema diff** — `prisma/schema.prisma:362-371` (model `CustomerOtherItem`). Currently has only `id, userId, description, createdAt`. Mirror `CustomerBrochureBox` (lines 348-360):
```prisma
model CustomerOtherItem {
  id                 String   @id @default(cuid())
  userId             String   @map("user_id")
  description        String
  assignedToMemberId String?  @map("assigned_to_member_id")
  createdAt          DateTime @default(now()) @map("created_at")

  user             User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  assignedToMember TeamMember? @relation(fields: [assignedToMemberId], references: [id], onDelete: SetNull)

  @@index([assignedToMemberId])
  @@map("customer_other_items")
}
```
Also add inverse on `TeamMember` (search for existing `CustomerBrochureBox[]` back-relation and replicate). Push via `npx prisma db push` against live Railway DB.

**2. UI replication sites in `app/admin/customers/[id]/page.tsx`:**
- **Type widening:** line 30 (`otherItems` type — add `assignedToMemberId: string | null`), line 569 (`renderRow` type union — add `'other'`).
- **Filter feed:** lines 414-420 (`empty` shape) and 428-431 (`filteredInventory` filter calls) — add `otherItems` branch identical to `brochureBoxes`.
- **Other card render:** lines 773-810 currently a separate plain card. Replace with the same `<Card>` + `renderRow('other', { id, label: item.description, assignedToMemberId })` pattern used for Brochure Boxes at lines 747-768. Move it into the `grid md:grid-cols-2` block at line 673 so it sits beside the other four sections.
- **Delete the duplicate Other card** in the non-grouped/legacy view at lines 995-1010 (referenced by grep) if it conflicts — confirm both paths during edit.

**3. Bulk-reassign route** `app/api/admin/customers/[id]/inventory/bulk-reassign/route.ts`:
- Line 7: extend `BulkReassignItem['type']` union to include `'other'`.
- Line 77: add `other: []` to `buckets`.
- After line 148: add `if (buckets.other.length) { prisma.customerOtherItem.updateMany({...}) }` block (no held-precheck — Other has no `heldByHoldId`).
- Line 162: add `other: buckets.other.length` to audit metadata.

**4. Add Inventory modal `handleAddInventory`** (line 219-247): line 245's guard explicitly excludes `'other'` (`addType !== 'other'`). Drop the `&& addType !== 'other'` so Other forwards `assigned_to_member_id`. `openAddModal` at line 109 already accepts `'other'` and pre-seeds from `agentFilter` — works as-is. Then in `app/api/admin/customers/[id]/inventory/route.ts:159-173` (the `'other'` case), add `assignedToMemberId` to the row data (the variable is already computed at line 34-37). Also drop the `type !== 'other'` guard at line 180 so the audit fires.

**5. Backfill plan.** Pseudocode (run dry-first):
```ts
const teams = await prisma.user.findMany({ where: { teamId: { not: null } }, select: { id: true, teamId: true } })
for (const c of teams) {
  const members = await prisma.teamMember.findMany({ where: { teamId: c.teamId!, removedAt: null } })
  const items = await prisma.customerOtherItem.findMany({ where: { userId: c.id, assignedToMemberId: null } })
  for (const it of items) {
    const m = members.find(mm => it.description.toLowerCase().startsWith(mm.name.toLowerCase() + ' '))
    if (m) plan.push({ id: it.id, assignedToMemberId: m.id, newDescription: it.description.slice(m.name.length + 1).trim() })
  }
}
```
Script at `scripts/backfill-other-assignments.ts`. Match policy: case-insensitive longest-name-first to avoid "Peggy" matching before "Peggy Heckert". The Semonin items in the screenshot ("Nadia Holliday Metal Frame x2", "Peggy Heckert Metal Frame", "Jennifer Carroll Post") all follow `{FullName} {rest}` and should match cleanly. Cannot count live rows from this sandbox — recommend `DATABASE_URL=$RAILWAY ts-node scripts/backfill-other-assignments.ts --dry-run` to print match counts before applying.

**Note for Issue 2 explorer:** the scroll listener that closes the popover is at `components/ui/SearchableSelect.tsx:118` (`window.addEventListener('scroll', close, true)` — capture phase, fires for every scroll including inside the popover). Fix: skip close when `e.target` is contained within the popover ref.