Clean.

---

## #5 — PJ Elder Bell Lawn lockbox link bug — **not reproducible; data is correct**

### (a) Bug-confirmation findings — Bell Lawn order is correctly linked

Ran `c:\Users\tanne\PPI\scripts\diagnose-pj-elder-lockbox.js` against Railway:

```
Order: PPI-MPZUUVAG-4DFJ (cmpzuuvaj00ar15qslti2hgxk)
Address: 312 Bell Lawn Drive, Nicholasville
Customer: Philip "PJ" Elder (cmneyufq0002e1dpeusbirg4e)
Status: pending  Created: 2026-06-04T18:55:13Z

  Order items (5):
    - post/new      | Signature Pink Post (install & pickup)
    - sign/storage  | Sign Install: FOR SALE (from storage)         customerSignId  = cmpaih60q002v15p26ve92sax
    - rider/storage | Rider Install: Pj Elder (from storage)        customerRiderId = cmpaigbqn002o15p2mhf1c3y2
    - lockbox/owned | Sentrilock/Supra Install                      customerLockboxId = cmp05jmns00as15l6wtsk3gd9  customValue (code) = 2093483
    - solar_lighting/install | Solar Lighting × 2

  CustomerLockbox rows (1):
    cmp05jmns00as15l6wtsk3gd9 | Sentrilock/Supra | code=2093483 | inStorage=false

  Diagnosis: lockbox order items=1, linked=[cmp05jmns00as15l6wtsk3gd9], DEPLOYED-BUT-UNLINKED=[]
```

**The Bell Lawn OrderItem's `customerLockboxId` correctly references PJ's single deployed lockbox, and the lockbox's code (2093483) matches `customValue` on the order item.** The install crew has the link they need.

I also ran a wider sweep (since deleted) across ALL deployed (`inStorage=false`) lockboxes in the entire Railway DB: 3 deployed, 3 linked, 0 unlinked. The bug pattern does not currently exist in live data.

### Historical orders that DID exhibit the pattern (already completed; no crew impact remaining)

Searching all of PJ's orders surfaced two older completed orders with the broken pattern:
- `PPI-MP30G742-7TQZ` — 2708 Green Valley court, completed 2026-05-12 — SentriLock Install with `customerLockboxId=NULL`
- `PPI-MNHUNNOB-ACBR` — 110 White Conkwright rd., completed 2026-04-02 — SentriLock Install with `customerLockboxId=NULL`

Both are status=`completed` with active `Installation` rows and `InstallationLockbox` rows already created. The crew already handled them; backfilling the OrderItem on a completed order would not affect any downstream view. (PJ's CustomerLockbox row was created 2026-05-10 — so the April order pre-dates it and there is no row to link to anyway.)

### (b) Root cause + fix in the wizard — none required

End-to-end trace of `customer_lockbox_id` flow:
- `components/order-flow/steps/lockbox-step.tsx:18-28` — `handlePickStored` correctly writes `customer_lockbox_id: lockbox.id` into formData
- `components/order-flow/steps/lockbox-step.tsx:106-111, 149-153, 193-197` — every "leave inventory" branch (`at_property`, `mechanical_rent`, `none`) correctly clears `customer_lockbox_id: undefined`
- `components/order-flow/steps/review-step.tsx:702-723` — `buildItems` lockbox branches for `sentrilock` and `mechanical_own` both emit `customer_lockbox_id: formData.customer_lockbox_id` (added in v2.7.0, predates the May 12 broken order)
- `lib/validations.ts:30, 81` — Zod schema accepts `customer_lockbox_id`
- `app/api/orders/route.ts:362` — persists `customerLockboxId: item.customer_lockbox_id`
- `app/api/orders/route.ts:395-401` — flips `inStorage:false` only when `item.customer_lockbox_id` present (so the broken pattern cannot arise from this path)
- `app/api/orders/batch/route.ts:292` — batch route also persists `customerLockboxId: item.customer_lockbox_id || null`
- `app/api/orders/[id]/edit/route.ts:194` — edit route preserves it
- `app/dashboard/cart/page.tsx:106-141` — cart-to-batch payload spreads `...item`, preserving all id fields through localStorage round-trip
- `lib/orders/order-to-formdata.ts:182, 187` — edit-mode reverse mapping correctly recovers `customer_lockbox_id`

No typos, no shadowed variables, no branches that drop the id. `npx tsc --noEmit` clean.

### (c) Backfill — not needed

- Bell Lawn (`PPI-MPZUUVAG-4DFJ`) is already correctly linked.
- The two historical NULL orders are both `completed`; one (April 2) pre-dates the existence of any CustomerLockbox row for PJ. Backfilling completed orders would not change any operational view. I deliberately did NOT write a destructive backfill update for completed-and-installed orders.

### Files
- `c:\Users\tanne\PPI\scripts\diagnose-pj-elder-lockbox.js` — kept (new, untracked) — the diagnostic for the bug report, repeatable
- No source files modified

### Conclusion
The bug as described in the task is not reproducible against current Railway data or current code. The Bell Lawn install crew can already find the lockbox via the OrderItem.customerLockboxId link. The fix appears to have already landed (the `buildItems` lockbox branch has been carrying `customer_lockbox_id` since v2.7.0). Two pre-fix historical orders show the broken pattern but are already completed.