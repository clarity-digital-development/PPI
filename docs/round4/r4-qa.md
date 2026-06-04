All four sites have the same reservation pattern — consistent. The deploy-order risk is real but documented.

Now I have everything needed to write the QA verdict.

### Per-item QA verdict

| Item | Verdict | Notes |
|---|---|---|
| #1 Admin per-row assign dropdown | PASS | `SearchableSelect` wired correctly; props match component API (`className`, `disabled`, `value`, `onChange`, `options`, `searchPlaceholder`, `aria-label`); `rowReassigning` keyed by `${type}:${id}` properly disables in-flight rows; no-op short-circuit when `nextId === currentMemberId` prevents accidental fires; reuses the bulk endpoint so hold-conflict (`409 items_held`) handling is preserved; checkbox `<label>` correctly nested inside the row div so click semantics still work. |
| #2 Rider rename + custom-text | PASS | Toggle label updated. `addCustomTextRider` generates collision-resistant ids (`Date.now()` + random suffix). Custom-text round-trips through both wizard and edit (parser at `lib/orders/order-to-formdata.ts:90-101, 137-148`). Source label correctly switched to "Pickup" for `at_property`. Review-step and second-post-step both updated. `setSource` filter at `useRiderSelection.ts:128-135` correctly drops custom riders when switching to "owned" (intended). Removed unused `cn` import in `SelectedRidersList.tsx` — clean. |
| #3 Investigation accuracy | PASS | Verified directly against Railway: order `PPI-MPYB4102-7DCE` (13007 Lavenia, $60.77, `pi_3TeI3vHYBBlnMslH1LV4IorH`) and `PPI-MPYC7V8C-NBST` (3323 Dell Road, $63.95, `pi_3TeIXvHYBBlnMslH07YbuePE`) are real, succeeded, live-mode PIs, with `paid_at` ≈ `created_at` (batch path), and both have meaningful property notes. Root cause analysis (batch route had no synchronous email send) is correct. |
| #4 Notes in email + email-send wiring | PASS with P1 caveat | Reservation pattern (`updateMany` conditional on `confirmationEmailSentAt: null`) is applied uniformly across 4 sites (single POST, batch POST, webhook, admin charge). `installationNotes` plumbed end-to-end. `escapeHtml` confirmed present (line 510). Caveat below. |
| #5 PJ Elder lockbox | PASS | Verified via raw SQL against Railway: order `PPI-MPZUUVAG-4DFJ` lockbox item has `customer_lockbox_id="cmp05jmns00as15l6wtsk3gd9"` and code `2093483`. Bug is not reproducible against current data/code. Agent correctly declined to write a destructive backfill against `completed` orders. Code trace of the wizard write path is accurate (every branch in `lockbox-step.tsx`, `review-step.tsx`, and the API routes preserves the FK). |
| #6 Schedule Trip validation removal | PASS | Both endpoints (`/api/installations/[id]/service-request` and `/api/service-requests`) require `description` which is still always built; removal of the items-required guard is safe. Copy update on the trip-fee notice and "Optional" labeling are appropriate. |

### Issues found

- **P1 — Deploy ordering risk** — `app/api/orders/batch/route.ts:468`, `app/api/orders/route.ts:432`, `app/api/admin/orders/[id]/charge/route.ts:78`, `app/api/webhooks/stripe/route.ts:91`. The reservation `updateMany` references `confirmationEmailSentAt`, a column added to the Prisma schema but not yet in the live DB. If code is deployed before `npm run db:push`, the reserve call will throw `P2022 ColumnNotFound`. In the batch route this throw escapes the inner `try` (the try only wraps the email send, not the reserve), so the entire route 500s AFTER orders are created and charged. Suggested fix: wrap the reserve `updateMany` in a try/catch that, on schema-error, logs and falls back to direct email send (or runs `db:push` in the deploy pipeline as a hard prerequisite — which the agent did call out, so this is a process issue, not a code bug).
- **P2 — Minor inconsistency** — `lib/orders/order-to-formdata.ts:93, 140`. The "restored" custom rider id uses `custom-text-restored-${description.length}-${name.length}` for stability across reads. This is fine for round-trip identity (same input produces same id), but two different custom-rider order items with the same description length and same name length would collide. Extremely unlikely in practice but worth knowing if multiple custom riders appear on one order. Suggested fix: include the rider index or a content hash if collisions become a problem.
- **P2 — Useless `useMemo`** — `components/order-flow/RiderSelector/RiderSelector.tsx:53-55` (pre-existing, not introduced here) uses `useMemo` for a side effect; should be `useEffect`. Not in scope of this round.

### Typecheck

`npx tsc --noEmit` → exit 0, clean.

### Recommendation

**Ship**, with the operational requirement (already documented by the agent) that `npm run db:push` runs as part of the deploy pipeline BEFORE the new code rolls. No P0s found. All six items address what Ryan asked for. The data-level claims in #3 and #5 verified directly against Railway production.