All try/catch wrappers preserved. tsc clean. Both emails delivered. All checks complete.

### Per-item verdict

| Item | Status | Notes |
|---|---|---|
| Schema FK + db push | PASS | `customer_lockbox_id String?` + `@@index` + reverse relation on CustomerLockbox, `onDelete: SetNull` (non-destructive). Live column + index confirmed via runtime queries. |
| A install-time copy | PASS | One-line addition in `app/api/orders/[id]/route.ts` at the only `installationLockbox.create` call site. `customerLockboxId: item.customerLockboxId ?? null` — null-safe, preserves legacy behavior. WHY comment matches convention. |
| B backfill | PASS (with caveat) | Script ran idempotently; linked 1 of 19. Remaining 18 skipped with structured reason `no-lockbox-orderitems-with-customerLockboxId` — confirmed accurate: pre-FK-era OrderItems carry no inventory FK, so derivation via Order is genuinely impossible. Audit row written. The 18 unresolved rows still render via the legacy `.code` fallback so SR emails do not regress. A future fallback strategy (user + lockboxType match by installedAt-near-createdAt) was correctly flagged by the agent. |
| C email prefers live FK | PASS | All three SR-email surfaces (`installations/[id]/service-request`, `service-requests`, `admin/service-requests/[id]`) updated identically: include `customerLockbox: { select: { code, serialNumber } }` and map prefers `customerLockbox?.code ?? lb.code ?? null`. HTML escapes downstream in `lib/email.ts` unchanged. Try/catch around email sends preserved at every site. No new `any` introduced (the 3 pre-existing `as any` casts in `service-requests/route.ts` are outside the diff). |

### DB state
- Total InstallationLockbox rows: **19**
- With `customerLockboxId` set (post-backfill): **1**
- Still NULL: **18** — all skipped with reason `no-lockbox-orderitems-with-customerLockboxId`. Their parent Orders' OrderItems lack `customerLockboxId` (pre-FK era), so live link is structurally unrecoverable from the Order graph. Their `InstallationLockbox.code` copies (where present) still render via the legacy fallback path in C, so no regression.
- Sample row:
  ```json
  {
    "id": "cmpyqqzvj008h15qsae9su25u",
    "installationId": "cmpyqqzvd008g15qs9ltizt6t",
    "lockboxTypeId": "cmje4ffxu000t9omf39s41b3i",
    "customerLockboxId": "cmpaifid8002n15p2t58vncva",
    "code": "2090511",
    "customerLockbox": { "code": "2090511", "serialNumber": null },
    "lockboxType": { "name": "Sentrilock/Supra" }
  }
  ```
  FK + code align (both `2090511`). Live FK resolution confirmed working through the new include.

### Test emails sent (to tannercarlson@vvsvault.com)
- **E1** `sendServiceRequestConfirmationEmail` Resend id: `fee5c456-fe20-4100-9361-9b18523f53ad` — HTML, customer-facing, pink "Existing lockboxes at this property" block rendering `Sentrilock/Supra (Code: 2090511)` from the live FK-resolved `existingLockboxes` payload.
- **E2** `sendAdminServiceRequestNotification` Resend id: `68d908b9-7fd1-4528-b579-41fb2c59ab40` — text format, admin notification, includes the same lockbox line in the plain-text trailer.

### Files touched in this QA
- `c:\Users\tanne\PPI\scripts\_qa-verify-fk.ts` (new, QA-only)

### Recommendation: **SHIP**

All four work units behave as claimed and verified end-to-end against the live Railway DB and live Resend pipeline. The 18 unresolved historical rows are a genuine structural limitation (their source data simply does not exist on the Order graph), not a defect in the backfill script — and they degrade gracefully to the pre-existing `.code` fallback so the worst case is parity with current production behavior, never a regression. The schema change is additive + nullable + `onDelete: SetNull`, so rollback is safe. tsc clean across the whole project. Try/catch around all email sends preserved. No new `any` introduced. Ship it; open a follow-up ticket for the secondary backfill strategy (`user` + `lockboxType` + `installedAt`-near-`createdAt` heuristic) at low priority.