# Approach A: Dedicated Polymorphic InventoryHold Table

## 1. Schema Changes

### New model: `InventoryHold`

```prisma
// Polymorphic soft-hold on a single Customer* inventory row.
// One row = one item held by one cart for up to TTL.
model InventoryHold {
  id              String           @id @default(cuid())
  itemType        InventoryItemType                      // enum below
  itemId          String                                  // FK target is item-type dependent; not modeled as a Prisma relation
  cartSessionId   String                                  // browser-cart-id (uuid issued by client, see §2); persisted in localStorage today, in Cart row tomorrow
  holderUserId    String                                  // user who created the hold (team_admin, customer, or admin acting on behalf)
  onBehalfOfUserId String?                                // customer the hold is FOR (admin/team_admin on-behalf-of); null for self
  agentMemberId   String?                                 // team_members.id when team_admin is building for a roster agent
  expiresAt       DateTime                                // now() + 15 min on create; refreshed on cart "ping"
  consumedAt      DateTime?                               // set when hold → OrderItem conversion succeeds (kept for audit, swept later)
  consumedByOrderId String?                               // populated at consumption
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  holder          User             @relation("HoldHolder", fields: [holderUserId], references: [id], onDelete: Cascade)
  onBehalfOf      User?            @relation("HoldOnBehalfOf", fields: [onBehalfOfUserId], references: [id], onDelete: Cascade)
  consumedByOrder Order?           @relation(fields: [consumedByOrderId], references: [id], onDelete: SetNull)

  // Lookups: "all live holds for this item" and "all live holds in this cart"
  @@index([itemType, itemId, expiresAt])
  @@index([cartSessionId, expiresAt])
  @@index([holderUserId, expiresAt])
  @@index([expiresAt])              // sweeper scan
  @@map("inventory_holds")
}

enum InventoryItemType {
  sign
  rider
  lockbox
  brochure_box
}
```

### Required partial unique index (raw SQL — Prisma cannot express partial unique)

A normal `@@unique([itemType, itemId])` would block re-holding an item ever again. We need uniqueness **only while the hold is live and unconsumed**:

```sql
-- prisma/migrations/<ts>_inventory_hold_partial_unique/migration.sql
CREATE UNIQUE INDEX inventory_holds_live_item_unique
  ON inventory_holds (item_type, item_id)
  WHERE consumed_at IS NULL AND expires_at > now();
```

This is the **single source of correctness**: at any instant, at most one live unconsumed hold can exist for a given `(itemType, itemId)`. Hold insertion that loses the race throws Prisma `P2002` → translated to HTTP 409.

> Caveat: `WHERE expires_at > now()` is non-IMMUTABLE in Postgres, so the predicate must use a constant-ish form. The portable trick is to **delete or soft-flag expired rows on the sweep** and write the index as `WHERE consumed_at IS NULL`. So the index is actually:

```sql
CREATE UNIQUE INDEX inventory_holds_live_item_unique
  ON inventory_holds (item_type, item_id)
  WHERE consumed_at IS NULL;
```

…and the sweeper (§2) keeps the "live" set honest by setting `consumedAt = expiresAt` (or hard-deleting) when TTL passes. This is the only IMMUTABLE-safe shape Postgres accepts.

### Migration approach

- `prisma db push` for the model + enum (additive only — no existing column touched).
- Hand-written raw SQL migration file checked into `prisma/migrations/` for the partial unique index (since `db push` won't emit it).
- New `Order` back-relation `holds InventoryHold[]` added on the existing `Order` model — purely additive, no migration impact.
- New `User` back-relations `heldInventory InventoryHold[] @relation("HoldHolder")` and `inventoryHeldForMe InventoryHold[] @relation("HoldOnBehalfOf")` — also additive.

No changes to `CustomerSign / CustomerRider / CustomerLockbox / CustomerBrochureBox` or `OrderItem`. The `inStorage` boolean keeps its existing meaning ("physically in storage at customer site") — **holds are layered on top, not a replacement**.

---

## 2. Hold Lifecycle

### When a hold is created

**On cart-add, not on wizard pick.** Rationale:
- Picking inside the wizard is exploratory — users back-button and change their mind. Holding on pick would lock items that never make it to cart.
- Cart-add is the first moment the user has expressed "I want this combination."
- It keeps the wizard purely client-side and avoids round-trips on every dropdown change.

The new `POST /api/inventory/holds` endpoint is called from `review-step.tsx#handleAddToCart` (and from `place-order/page.tsx` for the single-order POST path — see §4). Request body: the `{itemType, itemId}` list extracted from `formData` plus a `cartSessionId`.

A `cartSessionId` is a uuid stored in `localStorage` under `pp_cart_session_v1` (created on first cart interaction). When the server-side Cart table ships in track #4, the cart's primary key replaces this uuid — the column already accepts a string, no schema change needed.

### TTL refresh ("keep-alive")

`PUT /api/inventory/holds/refresh` accepts `{ cartSessionId }` and extends `expiresAt = now() + 15 min` for every live hold in that session. Called from `lib/cart.ts` on a 2-minute interval while the cart UI is mounted, and once on cart-page mount. This is the standard "user has the cart open" pattern.

### When holds are released

| Event | Mechanism |
|---|---|
| User removes a cart row | `lib/cart.ts#removeItem` calls `DELETE /api/inventory/holds?cartItemId=…` — deletes all holds whose `cartItemId` matches (see §4 — we add `cartItemId` to the table actually; see addendum). |
| User clears cart | `DELETE /api/inventory/holds?cartSessionId=…` |
| Order created successfully (`/api/orders/batch` or `/api/orders`) | Inside the same `$transaction`, holds are **consumed** — `consumedAt`/`consumedByOrderId` set. (Not deleted, so we can audit & investigate disputes.) |
| Payment fails (Stripe webhook `payment_intent.payment_failed`) | `restoreOrderInventory()` already flips `inStorage:true`. We do NOT recreate the hold — the user must re-add to cart. |
| TTL elapsed | Sweeper marks `consumedAt = expiresAt` (releasing the partial-unique slot) and writes an audit row. |
| User logs out | Holds keyed by `cartSessionId` persist (uuid lives in localStorage). Holds keyed by `holderUserId` are *not* auto-released — they expire normally. This avoids the "I tabbed out and lost my cart" problem. |

### Addendum to schema — `cartItemId`

Adding to the model above:

```prisma
  cartItemId      String                                  // localStorage CartItem.id; lets us release per-row without parsing
  @@index([cartItemId])
```

Because a single cart row may consume 1 sign + 4 riders + 1 lockbox, removing one cart row needs to release exactly its holds — keying on `cartItemId` is the cleanest way.

### Who runs the TTL sweep

Two complementary mechanisms:

1. **Lazy expire-on-read** in `POST /api/inventory/holds` (creation path): before attempting the insert for `(itemType, itemId)`, run `UPDATE inventory_holds SET consumed_at = expires_at WHERE item_type = $1 AND item_id = $2 AND consumed_at IS NULL AND expires_at <= now()` inside the same transaction. This guarantees a never-swept stale hold can never block a fresh user.
2. **Background cron** — a new Vercel cron entry (or a `scripts/sweep-holds.ts` invoked by Railway scheduled job — the project already runs Railway):
   - Every 60 seconds: `UPDATE inventory_holds SET consumed_at = expires_at WHERE consumed_at IS NULL AND expires_at <= now() RETURNING id, item_type, item_id, holder_user_id`.
   - For each returned row, write an audit row (`AuditAction.InventoryHoldExpired`, see §4).

The lazy path is the correctness guarantee. The cron is for hygiene + auditability (so audit rows fire promptly even if no one ever tries to re-hold).

---

## 3. Atomic Claim Algorithm

The conversion `hold → OrderItem assignment` happens inside the existing `/api/orders/batch` `$transaction`, with one tightened isolation level and an explicit conditional update. Pseudocode for the relevant block (replaces lines 147–219 in `app/api/orders/batch/route.ts`):

```ts
const result = await prisma.$transaction(async (tx) => {
  // Step 1: collect every (itemType, itemId) the caller is trying to consume.
  // The cart UI now sends inventory ids alongside items (see §4 fix to handleAddToCart).
  const claims: Array<{itemType: InventoryItemType, itemId: string}> = ...;

  // Step 2: lock the hold rows we expect to own.
  //   - We own a hold if (cartSessionId = ours OR holderUserId = ours)
  //     AND consumedAt IS NULL AND expiresAt > now().
  //   - SELECT ... FOR UPDATE forces serial access to these hold rows for
  //     the duration of the tx, so two concurrent /batch calls from the same
  //     user can't both consume the same hold.
  const myHolds = await tx.$queryRaw<HoldRow[]>`
    SELECT id, item_type, item_id, consumed_at, expires_at
      FROM inventory_holds
     WHERE (cart_session_id = ${cartSessionId} OR holder_user_id = ${userId})
       AND consumed_at IS NULL
       AND expires_at > now()
       AND (item_type, item_id) IN (${Prisma.join(claims.map(c =>
             Prisma.sql`(${c.itemType}::"InventoryItemType", ${c.itemId})`))})
     FOR UPDATE
  `;

  // Step 3: every claim MUST have a corresponding live hold owned by us.
  // If not, someone else's hold (or no hold) covers this item — abort the
  // whole batch with 409 Conflict + the offending items.
  const missing = claims.filter(c =>
    !myHolds.some(h => h.itemType === c.itemType && h.itemId === c.itemId)
  );
  if (missing.length > 0) {
    throw new HoldConflictError(missing);   // audit + 409 in catch
  }

  // Step 4: create orders + OrderItems referencing the inventory ids (atomic with hold consumption).
  for (const computed of computedOrders) {
    const order = await tx.order.create({
      data: { ..., orderItems: { create: computed.items } }
    });

    // Step 5: consume the holds we just locked. UPDATE is conditional on
    // (id IN our locked set) so a stale hold cannot be re-consumed.
    await tx.inventoryHold.updateMany({
      where: {
        id: { in: myHolds.filter(h => belongsToOrder(h, computed)).map(h => h.id) },
        consumedAt: null,    // belt + suspenders — FOR UPDATE already gives us this
      },
      data: { consumedAt: new Date(), consumedByOrderId: order.id }
    });

    // Step 6: flip inStorage:false WITH the precondition that nobody else
    // raced past the hold layer. If this fails, the tx rolls back.
    for (const item of computed.items) {
      if (item.customer_sign_id) {
        const r = await tx.customerSign.updateMany({
          where: { id: item.customer_sign_id, inStorage: true },
          data: { inStorage: false }
        });
        if (r.count !== 1) throw new InventoryRaceError(item.customer_sign_id);
      }
      // ...same for rider/lockbox/brochureBox
    }
  }
  return { orderIds: ... };
}, {
  isolationLevel: 'Serializable',
  timeout: 15000,
  maxWait: 5000,
});
```

Why this is safe under N concurrent requests:

- **The partial unique index** guarantees only one cart can hold a given item at a time. By the time we reach `/batch`, two carts cannot both believe they have a hold.
- **`SELECT ... FOR UPDATE`** on the hold rows blocks any other transaction trying to consume or release those same hold rows until commit, even if a parallel attacker tries to inject a duplicate hold via raw SQL.
- **`updateMany` with `consumedAt: null` precondition** on hold consumption + `inStorage: true` precondition on the inventory flip catches the unlikely case where the sweeper or another path mutated state between our SELECT and our UPDATE inside the tx.
- **`Serializable` isolation** + Prisma error code `P2034` retry (caught in the outer `try`) handles the rare serialization-failure case without exposing 500s.
- **`HoldConflictError`** is the user-facing race-loser path: the second cart to attempt checkout sees "Sign #abc123 was just claimed by another cart in your team; please pick a different one."

Single-order `POST /api/orders` is rewritten identically: the inventory flips that today run **outside** any transaction are pulled inside a new `prisma.$transaction(..., { isolationLevel: 'Serializable' })`, using the same hold-claim → order-create → inventory-flip sequence. This closes the most exposed race surface identified in the audit.

---

## 4. File-by-File Change List

### Add

| File | Purpose |
|---|---|
| `prisma/schema.prisma` (additive — new `InventoryHold` model + `InventoryItemType` enum + back-relations on `User`, `Order`) | Model definition |
| `prisma/migrations/<ts>_inventory_hold_partial_unique/migration.sql` | The partial unique index (raw SQL; `db push` won't emit it) |
| `lib/inventory-holds.ts` | Server helpers: `acquireHolds()`, `refreshHolds()`, `releaseHolds()`, `consumeHoldsInTx()`, `sweepExpiredHolds()`. All audit-emitting. Single source of truth — every API route below calls these. |
| `lib/cart-session.ts` | Client helper to get/create `pp_cart_session_v1` uuid in localStorage |
| `app/api/inventory/holds/route.ts` | `POST` (acquire), `DELETE` (release by cartSessionId or cartItemId) |
| `app/api/inventory/holds/refresh/route.ts` | `PUT` (keep-alive) |
| `app/api/cron/sweep-holds/route.ts` | Sweeper endpoint, called by Vercel/Railway cron (auth via `CRON_SECRET` env var) |
| `scripts/sweep-holds.ts` | CLI/Railway cron entry that hits the sweep endpoint |
| `__tests__/inventory-holds.test.ts` (or your existing test pattern) | Concurrency tests: two carts racing for same item, hold expiry, refresh, consume |

### Edit

| File | Change |
|---|---|
| `lib/audit.ts` | Add `AuditAction.InventoryHoldCreated`, `InventoryHoldExpired`, `InventoryHoldReleased`, `InventoryHoldConflict`, `InventoryHoldConsumed`. (`CartCheckoutBegin/Succeed/Fail` already exist — wire them in `/batch`.) |
| `lib/cart.ts` | `addItem()` → call `POST /api/inventory/holds` with extracted `{itemType, itemId}` list from formData; store returned hold ids on CartItem. `removeItem()` → call `DELETE /api/inventory/holds?cartItemId=…`. `clearCart()` → `DELETE …?cartSessionId=…`. Mount a 2-min `setInterval` to call `PUT …/refresh`. |
| `components/order-flow/steps/review-step.tsx` | **Fix the cart-strips-ids bug** found in Exploration 2. `handleAddToCart` must keep `customer_sign_id / customer_rider_id / customer_lockbox_id / customer_brochure_box_id` on each item OR (cleaner) carry the formData as today AND have `cart/page.tsx` rebuild items via `buildItems(cartItem.formData)` at checkout. Either way, the holds are acquired here before localStorage write — if the POST fails with 409, surface the conflicting item id to the wizard and refuse to add to cart. |
| `app/dashboard/cart/page.tsx` | At `handleCheckoutAll`, rebuild items via `buildItems()` from `cartItem.formData` (not `cartItem.items`) so inventory ids survive. Send `cartSessionId` in the batch payload. On 409, show "Inventory conflict — item X was claimed elsewhere; remove this cart row and re-pick" with a button that links to the wizard for that row. |
| `app/dashboard/place-order/page.tsx` | Single-order non-cart path: between "user clicks Place Order" and the `POST /api/orders`, acquire holds for the chosen items first; on success, the order POST consumes them. (This keeps single-order semantics aligned and lets the user see "another agent just took this sign" before card-charging.) |
| `app/api/orders/route.ts` (single-order POST) | Wrap order create + inventory flip in `prisma.$transaction(..., { isolationLevel: 'Serializable' })`. Add `consumeHoldsInTx()` call. Add conditional `where: { id, inStorage: true }` precondition on each Customer* update. Catch `P2002`/`P2034` → 409. |
| `app/api/orders/batch/route.ts` | Replace lines 147–219 with the algorithm in §3. Add `cartSessionId` to request body via validation. Catch `P2002`/`P2034`/`HoldConflictError` → 409 with list of conflicting items. |
| `app/api/orders/[id]/edit/route.ts` | Inside the existing `$transaction`, before adding the NEW inventory ids to OrderItems, acquire just-in-time holds inside the same tx (or skip the hold and rely on the conditional `where: { id, inStorage: true }` updateMany + `Serializable`). Use whichever is simpler — edit path is admin/customer one-at-a-time, lower race risk than parallel team-admin cart building. |
| `app/api/inventory/route.ts` (GET) | Exclude items with a live hold owned by **someone else** (any hold whose `cartSessionId` ≠ caller's AND `holderUserId` ≠ caller's AND `consumedAt IS NULL` AND `expiresAt > now()`). The same query returns a `heldByMe` flag for items the caller already holds — UI shows "(in your cart)" badge instead of hiding. |
| `app/api/webhooks/stripe/route.ts` `restoreOrderInventory()` | After restoring `inStorage:true`, also `UPDATE inventory_holds SET consumed_at = NULL, expires_at = now() - interval '1 second'` for that order's holds — i.e. mark them as released (so partial-unique slot reopens and audit shows a release, not a consume). Wrap in a tx. Idempotent. |
| `app/api/admin/orders/[id]/cancel/route.ts` | Same treatment as the webhook — release holds on cancel. Add to existing flow. |
| `vercel.json` (or Railway cron config) | Schedule `GET /api/cron/sweep-holds` every 60s with `Authorization: Bearer $CRON_SECRET` |
| `lib/validations.ts` | Add `holdAcquireSchema`, `holdReleaseSchema`, `batchPayloadSchema` field for `cart_session_id` |

### Forward-compat note

When track #4 (server-side Cart table) lands, the `cartSessionId` column on `InventoryHold` becomes an FK to `Cart.id` with `onDelete: Cascade`. The cleanup logic (releasing holds on cart row removal) then becomes free — the cascade does it. No retroactive data migration needed because cart session uuids and Cart row ids are both strings.

---

## 5. Failure Modes Designed AROUND

1. **Two team_admins on different machines pick the same `CustomerSign` simultaneously.** Both attempt `POST /api/inventory/holds` for the same `(sign, abc123)`. The partial unique index `inventory_holds_live_item_unique` accepts one row; the second insert throws `P2002`, the API returns 409, and the second admin's cart-add is rejected with "another team member just claimed this sign — refresh inventory." The wizard re-fetches `/api/inventory` (which now excludes the held item) and the admin picks a different sign. No double-assignment is possible because the index is the gatekeeper, not application logic.

2. **Same team_admin opens two browser tabs and tries to place two orders that both consume the same lockbox.** Both tabs share `cartSessionId` (localStorage) so both holds appear under the same session — but the partial unique index still rejects the second hold. The second tab's cart-add returns 409 with "this item is already in your cart on another tab." We could *allow* this (same session = same user) but rejecting is correct: the user genuinely cannot install one physical lockbox at two addresses.

3. **The same `/api/orders/batch` request is retried by the client (network blip → user hits "Pay" twice).** First request enters the `$transaction`, `FOR UPDATE`-locks the hold rows, consumes them, commits. Second request enters its tx, the `SELECT ... FOR UPDATE` returns zero matching live holds (they're now `consumedAt IS NOT NULL`), `HoldConflictError` fires, 409 back to the client. Order is created exactly once. The Stripe idempotency layer (existing) handles the payment side; the hold layer handles the inventory side. No duplicate OrderItem rows pointing at the same `customerSignId`.

A bonus fourth: the `inStorage: true` precondition on the inventory `updateMany` inside the tx is a final backstop — even if every layer above somehow failed (raw SQL injection, manual DB tweak), the second writer's `updateMany` returns `count: 0` and the tx rolls back.

---

## 6. Failure Modes ACCEPTED

1. **Stale browser tab races a fresh tab inside the 15-minute window.** A team_admin adds Sign #abc to cart at 10:00, walks away. At 10:14:50 the keep-alive refreshes the hold to expire at 10:29:50. The admin closes the laptop. The hold persists for ~15 more minutes blocking other team members. Acceptable because: (a) 15 min is the design constraint, (b) the cron sweeper expires it promptly after, (c) other team members get a clear "held by [admin name] until 10:29" tooltip in the inventory list (we expose `heldByOther` + `heldUntil` on the GET). The alternative — heartbeat-on-mouse-move with 2-min TTL — adds complexity for marginal benefit on the rare "abandoned laptop" case.

2. **Cron sweeper down for an extended period (e.g. Railway scheduler outage).** Expired holds stay `consumedAt IS NULL` in the DB. The partial unique index thinks the slot is still occupied. **Mitigation comes from the lazy expire-on-read in `acquireHolds()`** — any user attempting to claim that exact item will trigger an in-transaction `UPDATE … WHERE expires_at <= now()` that releases the slot, then succeeds. The visible-elsewhere symptom is "the inventory GET still shows item as `heldByOther`" until either someone tries to re-claim it or the sweeper recovers. No double-assignment is ever possible because the index + lazy-sweep combo is correct; the only degradation is "an item appears falsely-held for longer than 15 min in the UI." Acceptable because no data integrity is at risk and the lazy path auto-heals on demand. We also accept that we will **not** add a third defense (e.g. a per-request "sweep if last sweep > 5min" trigger) — the cost of complexity is higher than the cost of "occasionally an item looks held when it isn't."