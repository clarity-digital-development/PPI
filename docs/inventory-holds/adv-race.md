Now I have enough grounding. Let me think hard about attack sequences against this plan.

The plan's correctness argument hinges on this claim:
> "The conditional `updateMany({ where: { id, heldByHoldId: holdId, inStorage: true } })` is atomic — if `count !== 1`, throw 409"

Let me look for ways this breaks.

I see three concrete attacks. Let me develop the strongest one.

---

## ATTACK SEQUENCE: Lazy-sweep ABA double-claim race at checkout

**Setup state at t=0:**
- `CustomerSign(id='SIGN-A', inStorage: true, heldByHoldId: NULL, heldUntil: NULL)`
- No live holds on SIGN-A
- Two users in different browser sessions: T1 (Alice, ownerUserId=U1) and T2 (Bob, ownerUserId=U2)
- Default Postgres isolation level: **Read Committed** (Prisma's default, and the plan does NOT raise it)

**The attack — exploits the lazy-sweep window in `acquireHold`:**

```
t=0  (T0): An OLD expired hold exists: InventoryHold(id='HOLD-OLD', itemId='SIGN-A',
           expiresAt = now() - 20min, consumedByOrderId=NULL, releasedAt=NULL).
           CustomerSign.heldByHoldId = 'HOLD-OLD', heldUntil = now() - 20min.
           (Cron sweeper crashed; this is exactly what "lazy sweep" is supposed to handle.)

t=1  T1 POST /api/inventory/holds  for SIGN-A
     Opens TX-A at Read Committed.
       a) DELETE FROM inventory_holds WHERE item_id='SIGN-A' AND expires_at < now()
          -- (lazy sweep) deletes HOLD-OLD. Returns count=1.
       b) INSERT INTO inventory_holds (id='HOLD-A', item_id='SIGN-A', owner=U1,
          expires_at=now()+15min) -- succeeds.
       c) UPDATE customer_signs SET held_by_hold_id='HOLD-A', held_until=now()+15min
          WHERE id='SIGN-A' AND (held_by_hold_id IS NULL OR held_by_hold_id='HOLD-OLD'
          OR held_until < now())
          -- Suppose this is the guard. count=1. About to commit.

t=2  T2 POST /api/inventory/holds  for SIGN-A   (still BEFORE T1 commits)
     Opens TX-B at Read Committed.
       a) DELETE FROM inventory_holds WHERE item_id='SIGN-A' AND expires_at < now()
          -- This BLOCKS waiting for TX-A's row lock on HOLD-OLD (TX-A already deleted it).

t=3  TX-A commits. HOLD-OLD is gone. HOLD-A exists. customer_signs row points at HOLD-A.

t=4  TX-B's DELETE unblocks. In Read Committed, after the blocking write commits,
     the DELETE re-reads with the new snapshot. HOLD-OLD is no longer visible
     (deleted by TX-A). count=0. No error.
       b) INSERT INTO inventory_holds (id='HOLD-B', item_id='SIGN-A', owner=U2,
          expires_at=now()+15min) -- SUCCEEDS. There is NO unique constraint on
          (item_type, item_id) for live holds — the plan explicitly defers that
          to "follow-up: defense-in-depth".
       c) UPDATE customer_signs SET held_by_hold_id='HOLD-B' WHERE id='SIGN-A' AND
          (held_by_hold_id IS NULL OR held_by_hold_id IN (expired ids) OR
           held_until < now())
          -- After TX-A committed, customer_signs.heldByHoldId='HOLD-A' and
          held_until=now()+15min. Neither condition matches. count=0.
          -- TX-B detects the conflict and ROLLS BACK. SAFE so far.
```

OK, the "embedded denorm column" defends against this case **as long as the WHERE clause on the CustomerSign update is exactly that strict**. But the plan never specifies the WHERE clause precisely — it only specifies it at *claim* time. Let me find a different angle.

---

## ATTACK 2: Sweeper vs. acquire race — "ghost claim" lost-update

**Setup state at t=0:**
- `InventoryHold(id='HOLD-OLD', itemId='SIGN-A', expiresAt = now() - 30s, consumedByOrderId=NULL)`
- `CustomerSign(id='SIGN-A', inStorage: true, heldByHoldId='HOLD-OLD', heldUntil = now() - 30s)`
- Two concurrent processes: the **cron sweeper** (T1) and a **new acquire** (T2).

```
t=0  T1 GET /api/cron/inventory-hold-sweeper (fires every 60s)
     Opens TX-S at Read Committed.
       a) SELECT id FROM inventory_holds WHERE expires_at < now() AND
          consumed_by_order_id IS NULL AND released_at IS NULL
          -> [HOLD-OLD]
       b) Builds expiredHoldIds = ['HOLD-OLD'].

t=1  T2 POST /api/inventory/holds  for SIGN-A
     Opens TX-A at Read Committed.
       a) Lazy-sweep DELETE: deletes HOLD-OLD inside TX-A. Acquires row lock on HOLD-OLD.
          (Wait — does it actually acquire a row lock on a row another tx is about
          to read? In Read Committed, a DELETE takes an exclusive row lock. The
          sweeper's SELECT in step (a) above did NOT take a lock — it was a plain
          SELECT — so TX-A's DELETE succeeds immediately without blocking.)
       b) INSERT HOLD-NEW (id='HOLD-NEW', itemId='SIGN-A', expires=now()+15min)
       c) UPDATE customer_signs SET held_by_hold_id='HOLD-NEW',
          held_until=now()+15min WHERE id='SIGN-A' AND (held_by_hold_id IS NULL
          OR held_by_hold_id='HOLD-OLD' OR held_until < now())
          -- This needs an exclusive row lock on SIGN-A. Sweeper hasn't touched
          it yet. Succeeds. count=1.
     TX-A commits at t=1.5.

t=2  Back in sweeper TX-S:
       c) UPDATE customer_signs SET held_by_hold_id=NULL, held_until=NULL
          WHERE held_by_hold_id IN ('HOLD-OLD')
          -- The plan's exact filter from step #8: "where: { heldByHoldId: { in: expiredHoldIds } }"
          -- Read Committed: at the moment this UPDATE runs, it takes the LATEST
          committed snapshot for the predicate. customer_signs.heldByHoldId is
          now 'HOLD-NEW' (TX-A committed). Predicate doesn't match. count=0.
          GOOD — the plan's defense holds here.
       d) DELETE FROM inventory_holds WHERE id IN ('HOLD-OLD')
          -- HOLD-OLD is already gone (TX-A deleted and committed it). count=0.
          GOOD.
       e) Write InventoryHoldExpired audit row for HOLD-OLD.
          -- Spurious audit row (HOLD-OLD was already lazy-swept and replaced),
          but not a correctness violation. Just noise.
```

OK, this attack also fails to break things — the plan's `where: { heldByHoldId: { in: expiredHoldIds } }` filter saves it. Good. But notice: **the sweeper's correctness depends entirely on that filter being present, and on no operator ever writing `WHERE heldUntil < now()` instead.**

Let me try a stronger angle.

---

## ATTACK 3: PRIMARY — Checkout race exploits unique-PK constraint on InventoryHold + lazy-sweep

This one I believe actually works. The key insight: **the plan never says how it guarantees only one live `InventoryHold` per `(itemType, itemId)`.** It explicitly defers the partial unique index. It claims the conditional UPDATE on `Customer*` provides the guarantee. Let me find a sequence where the conditional UPDATE on `Customer*` passes for TWO different transactions.

**Setup state at t=0:**
- `CustomerSign(id='SIGN-A', inStorage: true, heldByHoldId: NULL, heldUntil: NULL)` — clean state, no prior holds.
- Two users T1 (Alice/U1) and T2 (Bob/U2), each in their own browser.

```
t=0   T1 POST /api/inventory/holds (for SIGN-A)
      Opens TX-A.
        - lazy sweep: no-op (no holds exist)
        - INSERT InventoryHold(id='HOLD-A', item='SIGN-A', owner=U1, expires=t+15m)
        - UPDATE customer_signs SET held_by_hold_id='HOLD-A', held_until=t+15m
          WHERE id='SIGN-A' AND (held_by_hold_id IS NULL OR held_until < now())
          count=1. 

t=0.5 T2 POST /api/inventory/holds (for SIGN-A) -- concurrent.
      Opens TX-B at Read Committed.
        - lazy sweep: SELECT ... WHERE expires_at < now() ... finds 0 (HOLD-A is fresh).
        - INSERT InventoryHold(id='HOLD-B', item='SIGN-A', owner=U2, expires=t+15m)
          -- INSERT does NOT conflict with HOLD-A (different PK, no unique index
          on item_id). Succeeds.
        - UPDATE customer_signs SET held_by_hold_id='HOLD-B', held_until=t+15m
          WHERE id='SIGN-A' AND (held_by_hold_id IS NULL OR held_until < now())
          -- BLOCKS: TX-A holds the exclusive row lock from its UPDATE.

t=1   TX-A commits. customer_signs.held_by_hold_id='HOLD-A'.

t=1.1 TX-B unblocks. In Read Committed, UPDATE re-evaluates the WHERE predicate
      against the latest committed row. held_by_hold_id='HOLD-A' (not NULL), and
      held_until=t+15m (not < now()). Predicate FAILS. count=0.
      TX-B's helper sees count=0 → throws HoldConflictError. Route rolls back TX-B.
      But — IMPORTANT — TX-B rolls back the INSERT of HOLD-B too. So we end up with
      exactly one live hold (HOLD-A). 
```

OK, this also fails. The Read Committed re-evaluation on UPDATE saves it. Postgres specifically does this for UPDATE/DELETE under Read Committed — it locks the row, re-reads after the blocking tx commits, and re-checks the WHERE clause. (This is the famous "EvalPlanQual" behavior.)

So the live-hold uniqueness IS protected by the conditional UPDATE. Good.

Now let me try the checkout step itself.

---

## ATTACK 4: PRIMARY — Same hold ID consumed twice by parallel batch checkout requests

This one I believe works. The plan's claim is:

> "claimHoldsInTx ... uses conditional updateMany({ where: { id, heldByHoldId: holdId, inStorage: true }, data: { inStorage: false, heldByHoldId: null, heldUntil: null } }) — if count !== 1, throw HoldRaceError"

The bug: **after a successful checkout, the row's `heldByHoldId` is set to NULL and `inStorage` to FALSE. A second concurrent call that thinks it holds the same hold will see `count=0` and throw.** That looks safe.

But what about a *user-driven double-submit* — same user double-clicks "checkout"? Let me think...

Actually, the scary case: **`/api/orders/batch` is not idempotent.** If the user double-clicks, both requests hit. Both validate, both create Stripe PaymentIntents (different ones — PI creation isn't idempotent without `idempotency_key`, which the code doesn't set). One succeeds at claim time, the other 409s and rolls back the second tx — but the *second Stripe PaymentIntent is already created and may be auto-confirmed*. So the customer is double-charged. That's a real bug, but it's NOT a "hold race" bug — it's a payment-flow bug that exists today and is orthogonal to holds.

Let me focus harder. I need a sequence that the plan's design genuinely fails to handle.

---

## ATTACK 5: PRIMARY — Stripe webhook restore vs. concurrent re-hold ("zombie hold release")

This one I believe is a real correctness break. Let me trace carefully.

**Setup state at t=0:**
- Alice (U1) just checked out an order containing SIGN-A. Order created, PaymentIntent in `requires_action` (3DS).
- DB state:
  - `Order(id='ORD-1', userId=U1, paymentIntentId='PI-1', paymentStatus='processing')`
  - `OrderItem(orderId='ORD-1', customerSignId='SIGN-A')`
  - `CustomerSign(id='SIGN-A', inStorage=FALSE, heldByHoldId=NULL, heldUntil=NULL)` — claim cleared the hold cols during checkout per the helper
  - `InventoryHold(id='HOLD-A', itemId='SIGN-A', ownerUserId=U1, consumedByOrderId='ORD-1')` — marked consumed by the helper

Wait — actually re-reading the helper spec:
> "data: { inStorage: false, heldByHoldId: null, heldUntil: null }"

The helper clears `heldByHoldId` on the Customer* row at claim. Good. And it presumably sets `consumedByOrderId` on the InventoryHold row.

Now Alice abandons 3DS. Stripe sends `payment_intent.payment_failed`. Webhook route fires `restoreOrderInventory()`.

Per the plan step #16:
> "after the existing `inStorage: true` flips, also clear `heldByHoldId`/`heldUntil` and delete any `InventoryHold` rows where `consumedByOrderId = thisOrder.id`. Idempotent."

```
t=0    Alice's 3DS times out. Stripe fires webhook payment_intent.payment_failed for PI-1.

t=0.1  Webhook starts running restoreOrderInventory for ORD-1.
       TX-W opens (or not — let's assume the plan uses prisma.$transaction here,
       though the current code at app/api/webhooks/stripe/route.ts doesn't necessarily).
         a) UPDATE customer_signs SET in_storage=TRUE WHERE id='SIGN-A'
         b) (about to clear hold cols + delete hold row)

t=0.2  Meanwhile, Alice — frustrated her order failed — refreshes the inventory
       page, sees SIGN-A is back, and clicks "add to cart" again.
       POST /api/inventory/holds for SIGN-A.
       TX-A opens.
         - Lazy sweep: no expired holds (HOLD-A is consumed, not expired —
           consumedByOrderId IS NOT NULL, so lazy-sweep's filter
           "WHERE expires_at < now() AND consumed_by_order_id IS NULL" SKIPS it).
         - INSERT InventoryHold(id='HOLD-NEW', item='SIGN-A', owner=U1, expires=t+15m)
           Succeeds (no unique constraint).
         - UPDATE customer_signs SET held_by_hold_id='HOLD-NEW', held_until=t+15m
           WHERE id='SIGN-A' AND (held_by_hold_id IS NULL OR held_until < now())
           -- BLOCKS on TX-W's row lock from step (a).

t=0.3  TX-W continues:
         b) UPDATE customer_signs SET held_by_hold_id=NULL, held_until=NULL
            WHERE id='SIGN-A'
            -- (Note: this UPDATE is unconditional per the spec — "clear
            heldByHoldId/heldUntil". The plan doesn't specify a WHERE guard.)
         c) DELETE FROM inventory_holds WHERE consumed_by_order_id='ORD-1'
            -- Deletes HOLD-A (the consumed one). HOLD-NEW is not consumed yet,
            but TX-A hasn't committed yet, so TX-W doesn't see HOLD-NEW
            (Read Committed snapshot at statement start).
       TX-W commits.

t=0.4  TX-A's blocked UPDATE re-evaluates. customer_signs.held_by_hold_id=NULL
       (cleared by TX-W step b), held_until=NULL. Predicate
       "(held_by_hold_id IS NULL OR held_until < now())" matches.
       UPDATE applies: customer_signs.held_by_hold_id='HOLD-NEW'. count=1.
       TX-A commits. State now:
         - CustomerSign(id='SIGN-A', inStorage=TRUE, heldByHoldId='HOLD-NEW', heldUntil=t+15m)
         - InventoryHold(id='HOLD-NEW', itemId='SIGN-A', consumedByOrderId=NULL)
       Consistent! Alice has the sign held again. 
```

Hmm — Read Committed's EvalPlanQual on UPDATE saves us again, because TX-W's clear-hold-cols UPDATE committed *before* TX-A's UPDATE re-evaluated. So TX-A wins cleanly.

But let me invert it — what if TX-A starts BEFORE TX-W:

```
t=0    State: HOLD-A consumed, CustomerSign.heldByHoldId=NULL, inStorage=FALSE.

t=0.1  Alice clicks "add to cart" on the SAME sign (maybe SIGN-A appears in her
       inventory list because she clicked the page before the checkout was finalized
       — there's a 100ms window where SIGN-A still appears free if heldByHoldId
       wasn't yet set, OR maybe an admin manually restored it earlier).
       Actually — let me set this up cleanly: pre-condition is that SIGN-A
       inStorage=TRUE somehow. Skip to a cleaner scenario.
```

Let me try yet another angle.

---

## ATTACK 6: PRIMARY — `restoreOrderInventory` race deletes a NEW hold (wrong WHERE clause)

The plan's step #16 says:
> "delete any `InventoryHold` rows where `consumedByOrderId = thisOrder.id`. Idempotent."

That filter is on `consumedByOrderId`, not on `itemId`. So this is fine. BUT — does the plan ever filter on `itemId` for the clear? Let me re-read:

> "after the existing `inStorage: true` flips, also clear `heldByHoldId`/`heldUntil`"

This is ambiguous. If implemented as `UPDATE customer_signs SET heldByHoldId=NULL, heldUntil=NULL WHERE id=$signId`, it will clear a NEW hold that some other tx just installed. That's bad.

Let me construct it:

**Setup state at t=0:**
- Order ORD-1 had SIGN-A. Customer abandoned 3DS.
- DB: `CustomerSign(id='SIGN-A', inStorage=FALSE, heldByHoldId=NULL, heldUntil=NULL)`. (Cleared at claim.)
- `InventoryHold(id='HOLD-OLD', itemId='SIGN-A', consumedByOrderId='ORD-1')`.

Now suppose ANOTHER user (Bob, U2 — say SIGN-A is on a *team*, not personal inventory, so Bob can see it through the team_admin filter) somehow can also see/claim SIGN-A. Or even simpler: imagine an admin restored SIGN-A's `inStorage=true` via an admin route between the abandoned checkout and the webhook firing (Stripe webhooks can be delayed by minutes).

```
t=0     Order ORD-1 in 'processing'. SIGN-A inStorage=FALSE, no hold.
        Customer admin sees the order is stuck and manually flips
        CustomerSign.inStorage=TRUE via the admin inventory page.

t=10s   Bob loads /api/inventory, sees SIGN-A available. Clicks "add to cart".
        POST /api/inventory/holds for SIGN-A. Succeeds.
        DB: CustomerSign(SIGN-A, inStorage=TRUE, heldByHoldId='HOLD-BOB', heldUntil=t+15m).
        InventoryHold(HOLD-BOB, itemId=SIGN-A, owner=U2, consumedByOrderId=NULL).
        (HOLD-OLD still exists, consumedByOrderId=ORD-1.)

t=2min  Stripe finally delivers payment_intent.payment_failed for PI-1.
        Webhook fires restoreOrderInventory(ORD-1):
          a) UPDATE customer_signs SET in_storage=TRUE WHERE id='SIGN-A'
             (no-op, already TRUE — but no guard against "this might have
              moved to another owner".)
          b) UPDATE customer_signs SET held_by_hold_id=NULL, held_until=NULL
             WHERE id='SIGN-A'
             -- CLOBBERS Bob's hold! count=1, but Bob's HOLD-BOB column gone.
          c) DELETE FROM inventory_holds WHERE consumed_by_order_id='ORD-1'
             -- Deletes HOLD-OLD. HOLD-BOB still exists, untouched.

t=2min+ Now state is:
          CustomerSign(SIGN-A, inStorage=TRUE, heldByHoldId=NULL, heldUntil=NULL)
          InventoryHold(HOLD-BOB, item=SIGN-A, owner=U2, expires=t+13min, consumedByOrderId=NULL)
        
        GET /api/inventory for a third user, Carol: per the plan's filter
        "heldByHoldId IS NULL OR heldUntil < now() OR heldByHoldId IN <my live hold ids>",
        SIGN-A shows AVAILABLE to Carol (heldByHoldId IS NULL on the row).
        Carol POSTs /api/inventory/holds — lazy sweep doesn't trigger (HOLD-BOB
        not expired). INSERT HOLD-CAROL succeeds. UPDATE customer_signs SET
        heldByHoldId='HOLD-CAROL' WHERE id='SIGN-A' AND (heldByHoldId IS NULL OR
        heldUntil < now()) → count=1. Carol thinks she has it.

t=3min  Bob checks out. claimHoldsInTx looks up his hold ids from his cart,
        finds HOLD-BOB. UPDATE customer_signs SET inStorage=FALSE, heldByHoldId=NULL,
        heldUntil=NULL WHERE id='SIGN-A' AND heldByHoldId='HOLD-BOB' AND inStorage=TRUE
        -- BUT customer_signs.heldByHoldId is NOW 'HOLD-CAROL'. count=0. Bob's
        checkout 409s with HoldRaceError. Bob's order rolls back.

t=4min  Carol checks out. claimHoldsInTx with HOLD-CAROL.
        UPDATE customer_signs SET inStorage=FALSE, heldByHoldId=NULL, heldUntil=NULL
        WHERE id='SIGN-A' AND heldByHoldId='HOLD-CAROL' AND inStorage=TRUE
        -- count=1. Carol's order succeeds.

State: Carol gets the sign. Bob got a confusing 409 he can't explain. No double-
assignment in the END state, BUT Bob's hold was silently stolen by the webhook,
and HOLD-BOB lives in the DB forever (no cleanup path — its expiry will trigger
the sweeper eventually, but the sweeper's "clear customer_signs cols WHERE
heldByHoldId IN expired" finds nothing because Carol already overwrote it).
```

OK — this isn't a "double assignment" but it IS an "inconsistent state": **HOLD-BOB lives on past its purpose, never linked to its CustomerSign, never expired-cleared from customer_signs (because customer_signs no longer references it). The sweeper will delete the InventoryHold row at expiry, but the audit log will say "InventoryHoldExpired" with no cleanup — wrong story.** Also Bob gets a baffling 409.

But this requires admin intervention. Not quite the airtight attack I want. Let me try once more.

---

## ATTACK 7: PRIMARY — Heartbeat `bumpHolds` extends a STOLEN hold

The plan step #11:
> "Mount a 5-minute `setInterval` to `PATCH /api/inventory/holds/bump` while cart is non-empty."

Step #7's bump:
> "PATCH extends TTL by 15 min for all live holds matching `ownerUserId = me AND cartItemId IN body.cartItemIds`."

The bump does NOT check `heldByHoldId` on the `Customer*` row. It only updates `InventoryHold.expiresAt`. So if a hold has been silently dissociated from its CustomerSign (as in Attack 6, or via any sweeper bug), the bump will keep extending it forever.

More importantly: the bump updates `InventoryHold.expiresAt` but **does it also update `CustomerSign.heldUntil`?** The plan says `heldUntil` is "denormalized from `InventoryHold.expiresAt`". If the bump doesn't update both, they desync.

Let me construct:

```
t=0     Alice adds SIGN-A to cart. HOLD-A expires at t+15min.
        CustomerSign.heldByHoldId='HOLD-A', heldUntil=t+15min.

t=5min  Heartbeat fires PATCH bump. The plan says "extends TTL by 15 min for all
        live holds matching ownerUserId = me AND cartItemId IN body.cartItemIds".
        Implementation: UPDATE inventory_holds SET expires_at = now()+15min
        WHERE owner_user_id=U1 AND cart_item_id=...
        InventoryHold.expiresAt = t+20min. CustomerSign.heldUntil still = t+15min.

t=15min Cron sweeper runs. SELECT id FROM inventory_holds WHERE expires_at < now() ...
        HOLD-A not expired (it's t+20min). Skipped. Good.

t=15min Bob loads /api/inventory. Plan's filter:
        "heldByHoldId IS NULL OR heldUntil < now() OR heldByHoldId IN <my live hold ids>"
        For SIGN-A: heldByHoldId='HOLD-A' (not NULL), heldUntil=t+15min < now (YES).
        SIGN-A APPEARS AVAILABLE TO BOB.

t=15min+ Bob clicks "add to cart" on SIGN-A.
        POST /api/inventory/holds. 
        - Lazy sweep: SELECT ids FROM inventory_holds WHERE item_id='SIGN-A' AND
          expires_at < now(). HOLD-A has expires_at=t+20min, not expired. Nothing
          deleted.
        - INSERT HOLD-BOB. Succeeds (no unique constraint on item_id).
        - UPDATE customer_signs SET held_by_hold_id='HOLD-BOB', held_until=t+15min+15min
          WHERE id='SIGN-A' AND (held_by_hold_id IS NULL OR held_until < now())
          -- heldByHoldId='HOLD-A' (not NULL), but heldUntil=t+15min < now (YES).
          Predicate matches. count=1. Bob's hold INSTALLED.

t=15min+ State:
          CustomerSign(SIGN-A, heldByHoldId='HOLD-BOB', heldUntil=t+30min)
          InventoryHold(HOLD-A, item=SIGN-A, owner=U1, expires=t+20min, consumed=NULL)
          InventoryHold(HOLD-BOB, item=SIGN-A, owner=U2, expires=t+30min, consumed=NULL)

t=16min Alice checks out. claimHoldsInTx with HOLD-A.
        UPDATE customer_signs SET inStorage=FALSE, heldByHoldId=NULL
        WHERE id='SIGN-A' AND heldByHoldId='HOLD-A' AND inStorage=TRUE
        -- customer_signs.heldByHoldId='HOLD-BOB'. count=0.
        Alice gets HoldRaceError → 409 → her order rolls back.

t=17min Bob checks out. claimHoldsInTx with HOLD-BOB.
        UPDATE ... WHERE heldByHoldId='HOLD-BOB' AND inStorage=TRUE → count=1.
        Bob's order SUCCEEDS.

End state: Bob got the sign. Alice gets a confusing 409 she can't understand —
her UI showed "12:34 remaining" because her LOCAL TTL was based on the bump's
return value (t+20min), but the SERVER's CustomerSign.heldUntil was t+15min and
silently let Bob steal it.

THIS IS A REAL RACE. The user-visible failure: Alice had a "valid" hold per
her client-side timer, but the server let another user reclaim it because
heldUntil drifted from expiresAt.
```

**This is the bug.** The bump operation only updates `InventoryHold.expiresAt`, not `CustomerSign.heldUntil`. The two values drift, and `GET /api/inventory`'s availability filter checks `heldUntil` (the denormalized column), not `expiresAt`. Result: an Alice with a fresh hold by `expiresAt` looks available to Bob, who can steal it cleanly.

Severity: this is exploitable in normal usage — every cart that lives past 15 minutes triggers it. The first heartbeat at t=5min creates the drift; the moment the original 15-min TTL passes, the sign is steal-able.

---

Let me verify one more time that there is no countermeasure in the plan. Re-reading step #3:

> "lib/inventory-holds.ts (new) — Single source of truth. Exports: acquireHold, releaseHolds, bumpHolds, claimHoldsInTx, sweepExpired, pickModel, HoldRaceError, HoldConflictError. Every state change writes an audit row."

Step #7:
> "PATCH extends TTL by 15 min for all live holds matching ownerUserId = me AND cartItemId IN body.cartItemIds. Returns per-cartItemId { extended: boolean }"

Neither says anything about updating `CustomerSign.heldUntil` during bump. And step #9's `GET` filter explicitly uses `heldUntil` on the customer table (not joining to `inventory_holds.expires_at`):

> "GET filter: include items where `heldByHoldId IS NULL OR heldUntil < now() OR heldByHoldId IN <my live hold ids>`"

Confirmed. The plan is broken.

There's also a secondary version with `acquireHold`'s lazy sweep + the same denorm-drift issue, but the bump-drift attack above is the cleanest.

---

# REFUTED: FALSE — Concrete race condition found

The plan **does not survive** a TTL heartbeat against a concurrent acquirer.

## Root cause

`CustomerSign.heldUntil` is denormalized from `InventoryHold.expiresAt`, but the bump operation (step #7) only updates the source-of-truth (`InventoryHold.expiresAt`), not the denorm column. The `GET /api/inventory` availability filter (step #9) and the conditional UPDATE guard inside `acquireHold` both consult the denorm column. After the first heartbeat fires, every cart item is silently steal-able by any other user.

## Concrete attack — "Heartbeat-drift hold theft"

**Pre-condition.** Alice has SIGN-A in her cart with a hold acquired at `t=0`. `CustomerSign.heldByHoldId='HOLD-A'`, `heldUntil=t+15min`. `InventoryHold.expiresAt=t+15min`. Cart heartbeat interval is 5 minutes (per step #11).

| Time | Actor | Action | Resulting state |
|---|---|---|---|
| `t=5m` | Alice browser | `PATCH /api/inventory/holds/bump` heartbeat fires. Per step #7 the route runs `UPDATE inventory_holds SET expires_at=now()+15min WHERE owner_user_id=U1 AND cart_item_id IN (...)`. **Does NOT touch `customer_signs`.** | `InventoryHold.expiresAt=t+20min`. `CustomerSign.heldUntil` **still `t+15min`**. Drift begins. |
| `t=15m+1s` | Bob | `GET /api/inventory`. Per step #9 the filter is `heldByHoldId IS NULL OR heldUntil < now() OR heldByHoldId IN <my live hold ids>`. For SIGN-A: `heldByHoldId='HOLD-A'` (not NULL), `heldUntil=t+15m < now()` → **TRUE**. | SIGN-A appears available to Bob. |
| `t=15m+2s` | Bob | `POST /api/inventory/holds` for SIGN-A. `acquireHold` runs: (a) lazy-sweep `DELETE FROM inventory_holds WHERE item_id='SIGN-A' AND expires_at < now()` — finds nothing (HOLD-A's `expires_at=t+20m`, not expired). (b) `INSERT InventoryHold(id='HOLD-B', ...)` — succeeds, **no unique constraint on `item_id`** (deferred per §4). (c) `UPDATE customer_signs SET heldByHoldId='HOLD-B', heldUntil=t+30m WHERE id='SIGN-A' AND (heldByHoldId IS NULL OR heldUntil < now())`. `heldUntil=t+15m < now()` → predicate matches → **count=1**. | Two live holds for SIGN-A: HOLD-A (Alice) and HOLD-B (Bob). `customer_signs.heldByHoldId='HOLD-B'`. Bob "owns" the sign. |
| `t=16m` | Alice | `POST /api/orders/batch`. `claimHoldsInTx` runs `UPDATE customer_signs SET inStorage=FALSE, heldByHoldId=NULL, heldUntil=NULL WHERE id='SIGN-A' AND heldByHoldId='HOLD-A' AND inStorage=TRUE`. `customer_signs.heldByHoldId='HOLD-B'` → **count=0**. `HoldRaceError` → tx rolls back → 409 returned. | Alice gets a 409 she cannot explain — her client-side timer (based on the bump's `extended: true` response) shows `~14 min remaining`. |
| `t=17m` | Bob | `POST /api/orders/batch`. `claimHoldsInTx` runs the same UPDATE with `heldByHoldId='HOLD-B'` → **count=1**. Bob's order succeeds. | Bob walks away with Alice's sign. |

## Why the design's defenses don't fire

1. **Lazy-sweep in `acquireHold` doesn't trigger** — it filters on `inventory_holds.expires_at`, which Alice's heartbeat correctly extended. HOLD-A is not expired.
2. **Partial unique index** — explicitly deferred to follow-up per §4. Two live holds on the same `item_id` are allowed at the DB level.
3. **Conditional UPDATE on `customer_signs`** — passes because the predicate consults `heldUntil` (the stale denorm column), which is `< now()`.
4. **Read Committed EvalPlanQual** — irrelevant here; there is no concurrent writer to block on. Alice's heartbeat finished long before Bob arrived.
5. **The cron sweeper** — runs every 60s but only deletes holds where `expires_at < now()`. HOLD-A is not expired.

## Severity

Exploitable in **normal user flow** with no malicious intent — every cart that survives past the first heartbeat (5 min) becomes vulnerable the moment the original 15-min TTL passes. Default cart lifetime in practice (per the cart UX described) is exactly this regime. The end state allows real double-assignment via a slightly different timing variant: if **Alice checks out before Bob installs HOLD-B**, both orders succeed against the same sign (Alice's claim sets `heldByHoldId=NULL, inStorage=FALSE`; Bob's later `acquireHold` then sees the row fully clear, claims it cleanly, and later checkout flips `inStorage=FALSE` on an already-out-of-storage row — except the conditional UPDATE requires `inStorage=TRUE`, so claim fails. So strict double-assignment is blocked at *claim*, but hold-theft + lost orders + confusing 409s for legitimate holders is the practical failure mode).

## Fixes (any one closes the race)

1. **Make bump update both columns** in a single tx: `UPDATE customer_signs SET heldUntil=$newExpiry WHERE heldByHoldId=$holdId` alongside the `inventory_holds` update. Cheapest fix, requires touching step #7 to know which `Customer*` table to update (the `itemType` is on the hold row, so a join or per-type branch is needed).
2. **Drop the `heldUntil` denorm column.** Change step #9's filter to `LEFT JOIN inventory_holds ... ON heldByHoldId=inventory_holds.id WHERE inventory_holds.id IS NULL OR inventory_holds.expires_at < now() OR inventory_holds.owner_user_id=$me`. Removes the drift class entirely; costs one join on the inventory page. Also requires the conditional UPDATE guard in `acquireHold` to use the same join semantics (or to be re-expressed as `WHERE NOT EXISTS (SELECT 1 FROM inventory_holds WHERE id=heldByHoldId AND expires_at > now())`).
3. **Install the deferred partial unique index** on `inventory_holds(item_type, item_id) WHERE consumed_by_order_id IS NULL AND released_at IS NULL`. This makes Bob's `INSERT HOLD-B` fail with `P2002`, so even with drift, only one live hold exists per item. Does NOT prevent the conditional UPDATE on `customer_signs` from succeeding for Bob (it still sees stale `heldUntil < now()`), so this needs to be paired with fix #1 or #2 — otherwise Bob's INSERT fails but Alice's row gets clobbered to `heldByHoldId=NULL` between the lazy-sweep and the failed insert — no, actually the lazy-sweep didn't touch HOLD-A, and the failed INSERT rolls back the tx, so the row stays. So #3 alone IS sufficient: Bob's tx aborts on the duplicate-insert P2002 before the conditional UPDATE runs. Cheapest defense-in-depth.

Recommended: ship **#1 (bump updates both columns)** as primary correctness, and **#3 (partial unique index)** as defense-in-depth. Both are <1h of work and entirely additive.