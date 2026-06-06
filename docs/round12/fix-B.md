Clean.

---

# SPECIALIST B — RESULTS

## Script
- `c:\Users\tanne\PPI\scripts\_recategorize-other-items.ts`
- Report: `c:\Users\tanne\PPI\scripts\_recategorize-other-items.report.json`
- `npx tsc --noEmit --skipLibCheck scripts/_recategorize-other-items.ts` → clean
  - (Whole-project `tsc` fails inside `app/admin/customers/[id]/page.tsx` — that's Specialist A's in-flight UI rewrite, not this script.)

## Spec deviation worth flagging
`CustomerOtherItem` has **no `quantity` column** (spec §2.3 wrong). Each row is qty=1 by definition; the "x2" Nadia rows in Tanner's screenshot were 2 separate rows. So "qty-N splitting" was a no-op — every `OtherItem` row produced exactly 1 typed row.

## Dry-run (before apply)
```
scanned: 97, planned: 95
sign: 95, rider: 0, lockbox: 0, brochure_box: 0
skippedTestData: 2 (admin@pinkposts.com "White Metal Frame (test)" + "Bracket — test item")
skippedUnparseable: 0
```

## Live run (--apply)
```
scanned: 97, planned: 95, created: 95, deleted: 95
sign: 95, rider: 0, lockbox: 0, brochure_box: 0
skippedTestData: 2, skippedUnparseable: 0
```
All 95 wrapped in `prisma.$transaction` (create + delete atomic). Zero failures. Audit row written: `id=cmq2vus3j002ngcmfeljbhyaq`, action=`inventory.reassign.bulk`, source=`script:_recategorize-other-items`.

## Idempotency re-run (dry)
```
scanned: 2 (only the 2 test rows remain), planned: 0
```
Re-running with `--apply` would be a no-op (test rows skip on every pass unless `--include-tests`).

## Sample verification (post-migration data)

**Semonin Broker Account** (the 6-agent-prefix customer Ryan called out):
- "Metal Frame" → Nadia Holliday (x2)
- "Metal Post" → Nadia Holliday (x2)
- "Metal Frame" → Peggy Heckert
- "Metal Post" → Jennifer Carroll
  → agent-name prefix correctly **stripped** from description (was "Nadia Holliday Metal Frame", now just "Metal Frame" with FK to her TeamMember row). Labels stay legible because the agent name is now structurally attached via `assignedToMemberId`, not stuffed into a freeform string.

**Nick Ratliff / NRRT** (non-team, 18 rows originally → 18 new `CustomerSign` rows, all unassigned as expected):
- 9x "Metal Frame", 7x "Wire Frame Text NRRT", 2x "stake for lockbox" — all `assignedToMemberId=null`, `inStorage=true`, original `createdAt` preserved.

**Residual `customer_other_items`**: 2 rows (both `admin@pinkposts.com` test data). Empty for all real customers — admin page's "Other items" sections will now render empty/hidden via existing `.length > 0` guards.

## Unparseable descriptions (for human review)
None in this dataset. The 2 needs-review entries are both test data deliberately skipped:
- `cmphmqk2x000qiwmfbd79ebzu` admin@pinkposts.com "White Metal Frame (test)"
- `cmphmqk58000riwmfw48pp5vb` admin@pinkposts.com "Bracket — test item"

If Tanner wants those folded into CustomerSign too, re-run `npx tsx scripts/_recategorize-other-items.ts --apply --include-tests`.

## Agent-match warnings
None — zero ambiguous name collisions in current dataset.