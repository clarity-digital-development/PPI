Clean. Done.

---

## Summary

**Files created:**
- `C:\Users\tanne\PPI\lib\orders\lockbox-description.ts` — shared helper exporting `lockboxDescriptionSuffix({ serialNumber, code })` and `hasLockboxIdentifier(description)`. Single source of truth for the "— Serial: X · Code: Y" prefer-order so the live wizard and the backfill can't drift.
- `C:\Users\tanne\PPI\scripts\_backfill-lockbox-descriptions.ts` — one-time backfill, idempotent (skips rows already containing `Serial:`/`Code:`), writes one `inventory.reassign.bulk` audit row at the end with the run's counts and a `source: 'script:_backfill-lockbox-descriptions'` metadata tag.

**Files modified:**
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx` — `lockboxIdentifierSuffix()` now delegates to the shared `lockboxDescriptionSuffix` helper. Identical behavior, no logic duplication.

**Backfill run output (live Railway DB):**

```
Scanning 3 lockbox items with a customerLockboxId FK…

Results:
{ scanned: 3, updated: 3, skippedAlreadyEnriched: 0, skippedNoSerialNoCode: 0, skippedMissingLockbox: 0 }

PJ Elder order (PPI-MPZUUVAG-4DFJ) — before/after:
{
  itemId: 'cmpzuuvam00av15qs769je5g2',
  before: 'Sentrilock/Supra Install',
  after: 'Sentrilock/Supra Install — Code: 2093483'
}
```

**Idempotency confirmed:** second run reported `updated: 0, skippedAlreadyEnriched: 3`.

**PJ Elder verification:** the OrderItem on `PPI-MPZUUVAG-4DFJ` now reads `Sentrilock/Supra Install — Code: 2093483` (matching the code stored on the linked `CustomerLockbox`). Customer order detail, admin detail, and any re-sent confirmation email will now surface the code. All 3 historically-eligible rows updated; the remaining 19 FK-less lockbox items in the DB are not enrichable (no source of truth) and were correctly left alone.

`npx tsc --noEmit` clean before and after.