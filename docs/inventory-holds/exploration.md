## Exploration 1

I have everything I need. Now compiling the deliverable.

# Inventory Assignment Code Path Map

Every code path that ASSIGNS a `Customer{Sign,Rider,Lockbox,BrochureBox}` to an order/installation, or that flips `inStorage`. The Customer\* tables have no uniqueness constraint on (id → orderItem), so the race is open everywhere.

---

## 1. Order creation — single (cart-less / on-behalf-of)

**File:** `app/api/orders/route.ts`
**Function:** `POST` (lines 55–484)

**Step A — Write OrderItem rows referencing inventory (lines 337–351, inside `prisma.order.create({ orderItems: { create: [...] } })`):**
- Writes `customerSignId`, `customerRiderId`, `customerLockboxId`, `customerBrochureBoxId` on each `OrderItem` from `item.customer_sign_id` etc.
- **Transaction:** YES — implicit (single `prisma.order.create` with nested `orderItems.create`).
- **Validation:** none — IDs come straight from the validated `createOrderSchema` (lib/validations.ts L21–32) which just types them as `z.string().optional()`. No ownership check, no `inStorage` check, no "is anyone else already pointing at this id" check.

**Step B — Flip `inStorage:false` on referenced inventory (lines 362–400):**
- Builds `inventoryUpdates: Promise<unknown>[]`, pushes one `prisma.customerX.update({ where:{ id }, data:{ inStorage:false } })` per non-null id, then `await Promise.all(inventoryUpdates)`.
- **Transaction:** NO — this runs OUTSIDE the `order.create` transaction. Order is already committed when these run.
- **Conflict behavior today:** none — `update` by primary key will succeed even if `inStorage` is already false (idempotent), so two parallel orders both happily mark the same id false and both end up referencing it. No write to AuditLog.

---

## 2. Order creation — batch (cart checkout)

**File:** `app/api/orders/batch/route.ts`
**Function:** `POST` (lines 54–242)

**Single big `prisma.$transaction` (lines 147–219):**
- Loops `computed` orders. For each, calls `tx.order.create` with nested `orderItems.create` writing `customerSignId / customerRiderId / customerLockboxId / customerBrochureBoxId` (lines 182–196).
- Then per-order, builds `invUpdates: Promise<unknown>[]` with `tx.customerSign.update({ where:{ id }, data:{ inStorage:false } })` (and the three sibling models), `await Promise.all(invUpdates)` (lines 205–216).
- **Transaction:** YES — both order-row creation AND `inStorage:false` flip are inside the same `prisma.$transaction` callback. Good news for atomicity within a single batch; bad news for cross-order racing because:
  - There is NO `where: { inStorage: true }` guard on the update — an order that just stole an item from a parallel cart still "wins" the inStorage flip with no error.
  - The transaction uses Prisma's default isolation level (read committed on Postgres); two concurrent batch requests selecting the same id will both pass and both insert OrderItems referencing it.
- **Conflict behavior today:** silent overwrite. No retry, no rollback, no audit row.

---

## 3. Order edit (customer / team_admin self-service)

**File:** `app/api/orders/[id]/edit/route.ts`
**Function:** `PATCH` (lines 41–243)

**Inside `prisma.$transaction` (lines 155–230):**
- Deletes ALL existing `OrderItem` rows for the order (`tx.orderItem.deleteMany`).
- `tx.orderItem.createMany` re-creates them with new `customerSignId / customerRiderId / customerLockboxId / customerBrochureBoxId` (lines 160–175).
- **Inventory diff (lines 132–143, 177–195):**
  - `idsToRestore`: items the OLD order pointed at that the NEW order doesn't → `tx.customerX.updateMany({ where:{ id: { in: [...] } }, data:{ inStorage:true } })`.
  - `newSignIds / newRiderIds / newLockboxIds / newBrochureIds`: → `tx.customerX.updateMany({ where:{ id: { in: [...] } }, data:{ inStorage:false } })`.
- **Transaction:** YES — both deletes, line-item creates, restore-updates, and lock-updates are inside one `$transaction`.
- **Conflict behavior today:** none — `updateMany` has no `inStorage:true` precondition on the lock side. Editing my order can silently re-lock an item that another parallel edit/order just locked for itself; the OrderItem on my order will FK-point at it regardless. No audit row.

---

## 4. Order status → completed (admin marks done)

**File:** `app/api/orders/[id]/route.ts`
**Function:** `PUT` (lines 44–278)

This path doesn't ASSIGN new customer inventory IDs to order items, but it DOES flip `inStorage:false` when a "storage" item gets translated into an `Installation*` row:
- Line 204: `prisma.customerRider.update({ where:{ id: item.customerRiderId }, data:{ inStorage:false } })` — only when `item.itemCategory === 'storage'`.
- Line 228: `prisma.customerLockbox.update({ where:{ id: item.customerLockboxId }, data:{ inStorage:false } })` — only when `item.itemCategory === 'storage'`.
- No equivalent for signs / brochure boxes here.
- **Transaction:** NO — these are stray `prisma.X.update` calls inside the for-loop over `order.orderItems` (lines 179–258), not wrapped in `$transaction`. The `installation.create` and the `installationRider.create / installationLockbox.create` calls are also not in a transaction.
- **Conflict behavior today:** idempotent no-op if already `inStorage:false`. No audit row.

This path also reads `customerRider.findUnique` (L187) and `customerLockbox.findUnique` (L220) to look up the rider/lockbox type — pure reads, no race impact on assignment.

---

## 5. Admin: Cancel order

**File:** `app/api/admin/orders/[id]/cancel/route.ts`
**Function:** `POST` (lines 16–118)

- Calls Stripe to cancel the PI (lines 47–60).
- **Inventory restore (lines 64–94):** loops `order.orderItems`, pushes `prisma.customerX.update({ where:{ id }, data:{ inStorage:true } })` for each non-null `customerSignId / customerRiderId / customerLockboxId / customerBrochureBoxId`. `Promise.all`.
- **Transaction:** NO — bare parallel updates, not in `$transaction`. Then `prisma.order.update({ status:'cancelled', paymentStatus:'failed' })` runs after.
- **Conflict behavior today:** idempotent. No audit row.

---

## 6. Stripe webhook: payment_intent.payment_failed / canceled

**File:** `app/api/webhooks/stripe/route.ts`
**Function:** `restoreOrderInventory(paymentIntentId, reason)` (lines 13–44), called from `payment_intent.payment_failed` (L145) and `payment_intent.canceled` (L160) cases.

- Finds the Order by `paymentIntentId`, loops `orderItems`, pushes `prisma.customerX.update({ where:{ id }, data:{ inStorage:true } })` for each non-null inventory id.
- **Transaction:** NO.
- **Conflict behavior today:** idempotent. No audit row. Comment in code says "safe to call multiple times".

This is the auto-restore that happens when 3DS dies or the card declines after the order has been created — it's the ONLY mechanism that ever unsticks the inventory if the user abandons the flow.

---

## 7. Admin: return a deployed item to storage

**File:** `app/api/admin/customers/[id]/inventory/route.ts`
**Function:** `PATCH` (lines 166–278)

When body `action === 'return_to_storage'` (lines 190–208):
- `prisma.customerSign.update({ where:{ id: item_id, userId: customerId }, data:{ inStorage:true } })` (and three siblings).
- **Transaction:** NO.
- **Conflict behavior:** no check that the item is currently `inStorage:false` or that no live order points at it — this can decouple the inventory state from any open orderItems silently. No audit row.

Also in this same file:
- `POST` (lines 5–164) — admin creates new inventory rows. Initial state always `inStorage: data.in_storage ?? true`. No order linkage.
- `PATCH` for `type:'rider'|'lockbox'` quantity adjust (lines 215–268) — deletes/creates `CustomerRider` and `CustomerLockbox` rows. No `inStorage:false` flip and no order linkage check before deleting.
- `DELETE` (lines 280–342) — hard-deletes a Customer\* row by id. **No check** for live `OrderItem` rows referencing it. Because the OrderItem FK column is nullable and has `onDelete` default (NoAction), Prisma will throw a FK violation rather than orphan — but there is no preventative check or user-friendly error mapping.

---

## 8. Customer self-service add inventory

**File:** `app/api/inventory/signs/route.ts`
**Function:** `POST` (lines 25–53) — creates a `CustomerSign` with `inStorage: body.in_storage ?? true`. No order linkage.

---

## 9. Team admin: assign / unassign agent owner

**File:** `app/api/teams/inventory/route.ts`
**Function:** `PATCH` (lines 91–126)
- Writes `assignedToMemberId` only (not `inStorage`, not order linkage): `model.update({ where:{ id }, data:{ assignedToMemberId: memberId } })`.
- **Transaction:** NO. Ownership-checked (item must belong to caller or caller must be admin).
- **Conflict behavior today:** none. No audit row, even though `AuditAction.InventoryAssign` and `AuditAction.InventoryReassignBulk` constants exist in `lib/audit.ts` — they are defined but never called from this PATCH.

The `GET` on the same file lists inventory; pure read.

---

## 10. Read-only paths that drive UI cart selection

These don't write but DEFINE what the cart UI offers, so the hold logic needs to be visible here too:

- `app/api/inventory/route.ts` GET (L48–64): lists items with `where: { userId, inStorage: true, ...memberFilter }`. **A held-but-not-yet-checked-out item must disappear from this list for both the holder and other cart sessions** (or be marked as held-by-someone-else).
- `app/api/admin/customers/[id]/route.ts` GET (L42–85): splits `inStorage:true` vs `false` for the admin detail page.
- `app/api/admin/inventory/route.ts` GET: lists all customer inventory for admin search with `in_storage` flag exposed.

---

## 11. Seeds

- `scripts/seed-admin-test-inventory.js`: creates `CustomerSign / CustomerRider / CustomerLockbox / CustomerBrochureBox` rows with `inStorage:true`. Idempotent count-then-create. No transaction, no order link.
- `scripts/seed-test-account.ts` (L59–76): creates rows with `assignedToMemberId`. No `inStorage` writes, no order link.

---

## Summary table

| # | Path | File:line | Tx? | Writes | On conflict today |
|---|---|---|---|---|---|
| 1a | Single order create — OrderItem FK | `app/api/orders/route.ts:337-351` | yes (nested) | `customerSignId/RiderId/LockboxId/BrochureBoxId` | none |
| 1b | Single order create — inStorage flip | `app/api/orders/route.ts:362-400` | NO | `inStorage:false` | silent overwrite |
| 2 | Batch order create + inStorage flip | `app/api/orders/batch/route.ts:147-219` | yes ($transaction) | FK + `inStorage:false` | silent overwrite (no precondition) |
| 3 | Order edit | `app/api/orders/[id]/edit/route.ts:155-230` | yes ($transaction) | OrderItem replace + `inStorage:true`/`false` updateMany | silent overwrite |
| 4 | Order → completed | `app/api/orders/[id]/route.ts:204,228` | NO | `inStorage:false` (storage-only riders/lockboxes) | idempotent |
| 5 | Admin cancel order | `app/api/admin/orders/[id]/cancel/route.ts:64-93` | NO | `inStorage:true` | idempotent |
| 6 | Webhook restoreOrderInventory | `app/api/webhooks/stripe/route.ts:13-44` | NO | `inStorage:true` | idempotent |
| 7 | Admin return-to-storage | `app/api/admin/customers/[id]/inventory/route.ts:193-202` | NO | `inStorage:true` | no live-order check |
| 8 | Customer add sign | `app/api/inventory/signs/route.ts:39-46` | NO | new row `inStorage:true` | n/a (insert) |
| 9 | Team admin assign agent | `app/api/teams/inventory/route.ts:124` | NO | `assignedToMemberId` | none |

---

## Where AuditLog is/should be wired

`lib/audit.ts` already exports `AuditAction.InventoryAssign`, `InventoryReassignBulk`, `CartCheckoutBegin/Succeed/Fail`. **Zero of the inventory-write paths above currently call `audit()`** — only `app/api/admin/customers/[id]/route.ts` PUT (role-change) writes audit rows today. So hold-create / hold-expire / hold-conflict will be the first inventory-domain audit consumers.

---

## Race-relevant findings

1. **No DB-level uniqueness** prevents two `OrderItem.customerSignId = X` rows existing on two different active orders. The whole correctness story relies on the in-app `inStorage` flag, which is read-then-written without a `where: { inStorage: true }` precondition anywhere.
2. **Path 1 (single POST)** runs the `inStorage:false` updates OUTSIDE the order-create transaction. If the process dies between L356 (order created) and L398 (Promise.all), the order claims items the inventory still thinks are free.
3. **Path 2 (batch POST)** is the closest to safe — single `$transaction`, but still has no read-side guard, so two concurrent transactions on Postgres' default Read Committed both see `inStorage:true`, both flip, both win.
4. **Path 3 (edit PATCH)** has the worst racing surface: a single edit re-writes line items AND flips lock state on potentially many items. Two concurrent edits on two different orders that both happen to add the same sign id will both succeed.
5. **Paths 5, 6, 7 (restore paths)** are unconditional `inStorage:true` — they can silently revive an item that a parallel order has already legitimately claimed since the restore was queued. This is the inverse race: restore-then-checkout collision.
6. The current cart is `localStorage` only. There is no server-side "this user is building a cart" state today, which is why a soft-hold table is needed before checkout — by the time POST `/api/orders/batch` fires, all hold conflicts must already have been surfaced in the UI, not at checkout.

Files referenced (absolute paths):
- `C:\Users\tanne\PPI\prisma\schema.prisma`
- `C:\Users\tanne\PPI\app\api\orders\route.ts`
- `C:\Users\tanne\PPI\app\api\orders\batch\route.ts`
- `C:\Users\tanne\PPI\app\api\orders\[id]\edit\route.ts`
- `C:\Users\tanne\PPI\app\api\orders\[id]\route.ts`
- `C:\Users\tanne\PPI\app\api\admin\orders\[id]\cancel\route.ts`
- `C:\Users\tanne\PPI\app\api\webhooks\stripe\route.ts`
- `C:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\route.ts`
- `C:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts`
- `C:\Users\tanne\PPI\app\api\admin\inventory\route.ts`
- `C:\Users\tanne\PPI\app\api\inventory\route.ts`
- `C:\Users\tanne\PPI\app\api\inventory\signs\route.ts`
- `C:\Users\tanne\PPI\app\api\teams\inventory\route.ts`
- `C:\Users\tanne\PPI\lib\audit.ts`
- `C:\Users\tanne\PPI\lib\validations.ts`
- `C:\Users\tanne\PPI\scripts\seed-admin-test-inventory.js`
- `C:\Users\tanne\PPI\scripts\seed-test-account.ts`

---

## Exploration 2

I have a complete picture. Returning the data-flow diagram and inventory selection inventory now.

---

# PPI Cart Flow — End-to-End Map

## TL;DR

The current cart is **purely client-side** (localStorage `pp_cart_v1`). Inventory items are referenced by their primary-key id only — no server-side reservation, no hold, no uniqueness constraint. Inventory is only "claimed" (`inStorage=false`) at the very end of `/api/orders/batch`, inside the order-creation transaction. The window between **picking an item in the wizard** and **the batch transaction running** is wide open — minutes for a single cart, hours/days if a draft sits before checkout, and across browser tabs / team members.

## Data-flow diagram

```
                CART FLOW (current, race-prone)
                ───────────────────────────────

  ┌─────────────────────────────────────────────────────────────────────┐
  │  1. ORDER WIZARD (per cart row)                                     │
  │     app/dashboard/place-order/page.tsx                              │
  │     components/order-flow/order-wizard.tsx + steps/*                │
  │                                                                     │
  │     a. GET /api/inventory?on_behalf_of=… | ?member_id=…             │
  │        ── filter: { inStorage: true, ...memberFilter } (NO         │
  │           awareness of holds or cart contents)                      │
  │        → Inventory { signs[], riders[], lockboxes[], brochureBoxes }│
  │                                                                     │
  │     b. User picks specific items in step UIs. The picked ids land   │
  │        in OrderFormData (in-memory React state):                    │
  │          • formData.stored_sign_id              (CustomerSign.id)   │
  │          • formData.second_post_stored_sign_id  (CustomerSign.id)   │
  │          • formData.riders[i].customer_rider_id (CustomerRider.id)  │
  │          • formData.second_post_riders[i].customer_rider_id         │
  │          • formData.customer_lockbox_id         (CustomerLockbox.id)│
  │          • formData.customer_brochure_box_id    (unused today —     │
  │            brochure_box step never sets it; brochure items go in    │
  │            with NO customer_brochure_box_id ref)                    │
  │                                                                     │
  │     c. Review step (review-step.tsx → buildItems()) flattens the    │
  │        form into an items[] array. Each item carries:               │
  │          { item_type, item_category, description, qty, unit_price,  │
  │            total_price, customer_sign_id?, customer_rider_id?,      │
  │            customer_lockbox_id?, customer_brochure_box_id?,         │
  │            custom_value? }                                          │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  (cart-enabled path: team_admin / admin / on-behalf-of)
  ┌─────────────────────────────────────────────────────────────────────┐
  │  2. "ADD TO CART" — review-step.tsx handleAddToCart                 │
  │     Calls useCart().addItem({...}) → lib/cart.ts                    │
  │                                                                     │
  │     ⚠ NOTE: handleAddToCart REWRITES the items array as             │
  │       item_type: 'misc' (description + price only). The             │
  │       customer_*_id refs ARE DROPPED HERE — the cart row's          │
  │       `items` array no longer carries them. The original ids        │
  │       survive only inside CartItem.formData (the wizard snapshot).  │
  │                                                                     │
  │     Persisted shape (localStorage key 'pp_cart_v1'):                │
  │       CartItem {                                                    │
  │         id, agentId, agentName, agentEmail,                         │
  │         formData: OrderFormData,        ← inventory ids live HERE   │
  │         items: [{item_type:'misc',description,…}],  ← stripped       │
  │         estimatedTotal, propertyAddress, addedAt                    │
  │       }                                                             │
  │                                                                     │
  │     Persistence: window.localStorage, one shared key per browser    │
  │     ('pp_cart_v1'). Sync across tabs via 'storage' event +          │
  │     intra-tab via custom 'pp_cart_change' event.                    │
  │                                                                     │
  │     ⚠ Consequences:                                                 │
  │       - No server record exists                                     │
  │       - No expiry — drafts can sit indefinitely                     │
  │       - Two team_admins (or two browsers / two tabs) cannot see     │
  │         each other's selections                                     │
  │       - The same team_admin can /place-order twice, pick the same   │
  │         CustomerSign twice, and both land in cart unflagged         │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  3. CART PAGE — app/dashboard/cart/page.tsx                         │
  │                                                                     │
  │     handleCheckoutAll() builds batchPayload by REPLAYING each       │
  │     CartItem.formData fields → batch order body. But it uses        │
  │     cartItem.items (the stripped 'misc' array), NOT a rebuilt one.  │
  │                                                                     │
  │     batchPayload = {                                                │
  │       payment_method_id,                                            │
  │       orders: items.map(c => ({                                     │
  │         property_*, installation_*, is_gated_community, gate_code,  │
  │         has_marker_placed, sign_orientation*, post_type,            │
  │         items: c.items,    ← 'misc' stripped items, no inventory   │
  │                              ids attached                           │
  │         requested_date, is_expedited,                               │
  │         placed_for_agent_name                                       │
  │       }))                                                           │
  │     }                                                               │
  │                                                                     │
  │     POST /api/orders/batch                                          │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  4. /api/orders/batch — app/api/orders/batch/route.ts               │
  │     For each order in batch:                                        │
  │       - Look up postType                                            │
  │       - computeOrderPricing()                                       │
  │     Create ONE PaymentIntent for grand total.                       │
  │     prisma.$transaction(async tx => {                               │
  │       for each computed order: tx.order.create({                    │
  │         data: { ..., orderItems: { create: items.map(...) } }       │
  │       })                                                            │
  │       for each item with customer_*_id:                             │
  │         tx.customerSign.update({ where:{id}, data:{inStorage:false} │
  │         tx.customerRider.update({...})                              │
  │         tx.customerLockbox.update({...})                            │
  │         tx.customerBrochureBox.update({...})                        │
  │                                                                     │
  │       ⚠ NO uniqueness check, NO SELECT … FOR UPDATE, NO check that  │
  │         the row is still inStorage=true before flipping it.         │
  │     })                                                              │
  │                                                                     │
  │     On payment_intent.payment_failed/canceled the Stripe webhook    │
  │     calls restoreOrderInventory() to flip items back to inStorage.  │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  DB rows touched:                                                   │
  │   Order (one per cart row, shared paymentIntentId)                  │
  │   OrderItem (one per items[] entry; FK columns customerSignId,      │
  │              customerRiderId, customerLockboxId,                    │
  │              customerBrochureBoxId — nullable, no unique idx)       │
  │   CustomerSign / CustomerRider / CustomerLockbox /                  │
  │     CustomerBrochureBox: inStorage flipped to false                 │
  └─────────────────────────────────────────────────────────────────────┘
```

## Critical bug observed while mapping

`app/dashboard/cart/page.tsx` checkout builds `batchPayload.orders[i].items` from `cartItem.items`. But `review-step.tsx` `handleAddToCart` writes those items as `{ item_type: 'misc', description, qty, unit_price, total_price }` only — **the customer_sign_id / customer_rider_id / customer_lockbox_id / customer_brochure_box_id references are stripped before save** (see `review-step.tsx:427`). Therefore: orders placed via the cart today never carry inventory-id references into `/api/orders/batch`, and the per-item `customerSign.update({ inStorage:false })` loop in `batch/route.ts:206` is effectively dead code for cart orders. Items the cart user "picked" do NOT get marked out-of-storage.

The single-order POST `/api/orders` path DOES carry inventory ids (it calls `buildItems()` directly, not `handleAddToCart`), so the inventory-flip works for non-cart orders only. The hold design needs to fix BOTH the soft-hold race AND restore the inventory ids in the cart pipeline (e.g. by replaying `buildItems()` against `cartItem.formData` at checkout instead of using the stripped `cartItem.items`).

## Inventory-selection UIs (every place a customer claims a specific row)

For each UI: the file, the inventory category, what formData field receives the id, and whether that id survives into the API call.

| # | UI surface | File | Inventory table | Form field set | Survives to single-order API? | Survives to cart/batch API today? |
|---|---|---|---|---|---|---|
| 1 | "Sign in inventory" `<Select>` (first post) | `components/order-flow/steps/sign-step.tsx` line 74 | `CustomerSign` | `formData.stored_sign_id` | yes (buildItems → `customer_sign_id`) | **NO** (stripped in handleAddToCart) |
| 2 | "Use sign from inventory" → `<Select>` (second post) | `components/order-flow/steps/second-post-step.tsx` line 225 | `CustomerSign` | `formData.second_post_stored_sign_id` | yes | **NO** |
| 3 | Owned-rider picker (per rider, source='owned') — auto-matched by riderType slug | `components/order-flow/steps/rider-step.tsx` `toRiderSelection`; `RiderSelector/hooks/useRiderSelection.ts` | `CustomerRider` | `formData.riders[i].customer_rider_id` | yes | **NO** |
| 4 | Owned-rider picker for second post | `components/order-flow/steps/second-post-step.tsx` `toRiderSelection` | `CustomerRider` | `formData.second_post_riders[i].customer_rider_id` | **NO even single-order** — `review-step.tsx` line 691 omits `customer_rider_id` from the second_post_riders item payload | NO |
| 5 | Per-item lockbox picker buttons ("From your inventory") | `components/order-flow/steps/lockbox-step.tsx` line 50 | `CustomerLockbox` | `formData.customer_lockbox_id` (only for `sentrilock` or `mechanical_own` options) | yes | **NO** |
| 6 | Brochure box "Install my own" / "Purchase" | `components/order-flow/steps/brochure-box-step.tsx` | `CustomerBrochureBox` | (none — `formData.customer_brochure_box_id` exists in the type but no step writes to it) | N/A — `customer_brochure_box_id` is never sent | N/A |

### Notes on item-flow gotchas the hold design must handle

- **Sign duplicates collapsed for UX** (`sign-step.tsx` line 78–88, same in `second-post-step.tsx`): multiple `CustomerSign` rows with identical description+size are grouped, and the dropdown only shows the first row's id. If the customer has 3 "Coldwell Banker 24x18" signs, picking from the dropdown always claims the SAME physical id — racing themselves into the same row repeatedly even though physical inventory exists. Hold design should either expose distinct rows or auto-pick the next-available-not-held row server-side.
- **Riders matched by slug**, not by user pick (`rider-step.tsx` `toRiderSelection` line 23): `customer_rider_id` is set to the FIRST `CustomerRider` row whose `riderType === slug`. Two `RiderSelection` entries with the same slug end up pointing at the same `CustomerRider.id`. Same self-racing problem.
- **Brochure boxes are aggregated**, not individually picked (`inventory/route.ts` line 109): the API returns `{ quantity: N }` only — there is no UI to select a specific `CustomerBrochureBox.id`. Hold design needs a "next available" lease for the brochure-box case.
- **GET /api/inventory filters by `inStorage: true` only** — it has no concept of "held" vs "available." Picking already-held items isn't currently preventable from the UI.
- **Inventory ids carried in form state are also serialized into `CartItem.formData`** in localStorage. A hold key would need to be persisted alongside (in localStorage today, in the server-cart row tomorrow) so it can be released on `removeItem`/`clearCart`.
- **No `OrderItem` uniqueness constraint** on `customerSignId` / `customerRiderId` / `customerLockboxId` / `customerBrochureBoxId` (verified `prisma/schema.prisma:410-425`). Even if two batches race past inventory checks, the DB will happily create two `OrderItem` rows pointing at the same physical item.
- **`/api/orders/batch` does not validate `inStorage=true` before flipping**: it blindly sets `inStorage:false` even if another order already claimed the row. A real hold flow needs `tx.customerSign.update({ where: { id, inStorage: true } })` (with the conditional `where`) OR a `holdId` claim check inside the transaction so the second writer fails fast.
- **AuditLog model is already present** (`schema.prisma:651`) and ready to record hold-created / hold-expired / hold-conflict events.

## Key files (absolute paths)

- `C:\Users\tanne\PPI\lib\cart.ts` — localStorage cart hook (`pp_cart_v1`)
- `C:\Users\tanne\PPI\app\dashboard\cart\page.tsx` — cart UI + checkout caller
- `C:\Users\tanne\PPI\app\dashboard\place-order\page.tsx` — wizard host, inventory loader
- `C:\Users\tanne\PPI\app\api\inventory\route.ts` — inventory GET (no hold awareness)
- `C:\Users\tanne\PPI\app\api\orders\route.ts` — single-order POST + inventory flip
- `C:\Users\tanne\PPI\app\api\orders\batch\route.ts` — batch POST + inventory flip (lines 205–216)
- `C:\Users\tanne\PPI\components\order-flow\types.ts` — OrderFormData shape
- `C:\Users\tanne\PPI\components\order-flow\steps\sign-step.tsx` — sign picker
- `C:\Users\tanne\PPI\components\order-flow\steps\lockbox-step.tsx` — lockbox picker
- `C:\Users\tanne\PPI\components\order-flow\steps\rider-step.tsx` — rider picker
- `C:\Users\tanne\PPI\components\order-flow\steps\second-post-step.tsx` — second-post sign + rider pickers
- `C:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx` — `buildItems()` (authoritative item-with-ids builder) + `handleAddToCart` (strips ids)
- `C:\Users\tanne\PPI\components\order-flow\RiderSelector\hooks\useRiderSelection.ts` — rider/inventory matching logic
- `C:\Users\tanne\PPI\prisma\schema.prisma` — `CustomerSign` (l. 261), `CustomerRider` (l. 278), `CustomerLockbox` (l. 294), `CustomerBrochureBox` (l. 312), `OrderItem` (l. 410), `AuditLog` (l. 651)

---

## Exploration 3

No shared code with order creation either. Here's the answer:

---

**Inventory allocation by service requests: NO.**

Service requests are **pure work-order records** — they describe a job (removal/service/repair/replacement) to be performed at an existing Installation (or an unlisted address) and optionally carry a Stripe invoice. They never read, write, hold, decrement, or reassign any `CustomerSign` / `CustomerRider` / `CustomerLockbox` / `CustomerBrochureBox` row. Confirmed by grepping all four model names across every service-request route — zero matches.

**No code shared with order creation.** `/api/orders/route.ts` and `/api/orders/batch/route.ts` contain no references to `serviceRequest` / `ServiceRequest`, and the service-request routes do not import any cart, order, or inventory-allocation helpers. The only cross-model touches are read-only and one-way:
- Create-time: read `Installation` (to attach `installationId`) and read the original `Order` + `OrderItem.description` strings only to populate the admin email body with "what was installed" — no inventory rows queried.
- Completion-time: when a `removal` is completed, set `Installation.status='removed'` + `removedAt`. This is the closest thing to "freeing inventory," but it acts on the `Installation`, not on any `Customer*` item row. (Implication for the hold work: if you later add a step that returns items to `inStorage=true` on removal completion, this PUT handler at `app/api/admin/service-requests/[id]/route.ts:146-154` is where it would live.)

**Files involved (all service-request code paths):**
- `prisma/schema.prisma:533-579` — `ServiceRequest` model + `ServiceRequestType` / `ServiceRequestStatus` enums. Relations: `installationId` (nullable), `userId`. No FKs to any inventory table.
- `app/api/service-requests/route.ts` — POST (unlisted-address create), GET (customer/team_admin list)
- `app/api/service-requests/[id]/route.ts` — PATCH (customer edit/cancel)
- `app/api/installations/[id]/service-request/route.ts` — POST (create against an existing installation; sets `Installation.status='removal_scheduled'` for removal+date)
- `app/api/admin/service-requests/route.ts` — admin list
- `app/api/admin/service-requests/[id]/route.ts` — admin PUT (status/admin_notes/scheduled_date; sets `Installation.status='removed'` on removal completion)
- `app/api/admin/service-requests/[id]/invoice/route.ts` — Stripe invoicing only; no inventory touches
- `app/admin/service-requests/page.tsx`, `app/dashboard/service-requests/page.tsx` — UI

**Columns on `ServiceRequest`** (none are inventory IDs): `id, installationId?, userId, type, status, description?, requestedDate?, notes?, adminNotes?, completedAt?, invoiceAmount?, invoiceStatus?, invoicePaymentIntentId?, invoicePaidAt?, unlistedAddress?, unlistedCity?, unlistedState?, unlistedZip?, createdAt, updatedAt`.

**Bottom line for the soft-hold design:** service requests are out of scope. The 15-minute TTL hold mechanism only needs to integrate with the order-creation paths (`/api/orders/route.ts`, `/api/orders/batch/route.ts`) and the cart. The only forward-looking touchpoint worth noting is the removal-completion handler at `app/api/admin/service-requests/[id]/route.ts:146-154` if/when "removed installation returns items to storage" becomes a feature — but that's a release path, not a hold path, and is unrelated to the race you're solving.

---

## Exploration 4

Confirmed - only mentioned in the planning doc, not implemented.

---

# Concurrency Audit — Soft-Hold Prerequisites

## Every `prisma.$transaction` call

| File:Line | Form | Isolation | Purpose |
|---|---|---|---|
| `C:\Users\tanne\PPI\app\api\orders\batch\route.ts:147` | Interactive callback `$transaction(async (tx) => ...)` | **Default** (Read Committed; no `{ isolationLevel: ... }` option set) | Creates N orders + flips `inStorage:false` on linked Customer* items. Updates fire as `Promise.all(invUpdates)` inside the tx. **No pre-read of `inStorage`, no `where: { inStorage: true }` guard — blind writes.** |
| `C:\Users\tanne\PPI\app\api\orders\[id]\edit\route.ts:155` | Interactive callback `$transaction(async (tx) => ...)` | **Default** (Read Committed) | Replaces order items, restores `inStorage:true` for items removed from the order, sets `inStorage:false` for newly-added items via `updateMany`. Again blind — does not check whether the new ids are already held by another order. |
| `C:\Users\tanne\PPI\app\api\stripe\payment-methods\[id]\route.ts:125` | Array form `$transaction([...])` | **Default** | Demotes other `paymentMethod.isDefault`, promotes the selected one. Unrelated to inventory. |

## The big offender: `app/api/orders/route.ts` (single-order POST)

Lines 302–400. Inventory writes here are **not inside any transaction**:

- `prisma.order.create(...)` runs first (line 302)
- Then `inventoryUpdates` is built as a fresh `Promise<unknown>[]` of `prisma.customerSign.update(...)` / `customerRider.update(...)` / `customerLockbox.update(...)` / `customerBrochureBox.update(...)` calls (lines 362–395)
- Flushed with `Promise.all(inventoryUpdates)` (line 398) — separate connection per call, no atomicity with the order create

So the most common checkout path has *zero* transactional coupling between "this order references item X" and "item X is marked inStorage:false".

## Unique constraints on the `Customer*` tables

Read `prisma/schema.prisma` lines 261–335. Every `@unique` and `@@unique` in the schema is listed below — **none** of the four soft-hold target tables (`CustomerSign`, `CustomerRider`, `CustomerLockbox`, `CustomerBrochureBox`) carry any uniqueness or partial-unique constraint beyond `id`. There is also nothing on `OrderItem.customerSignId / customerRiderId / customerLockboxId / customerBrochureBoxId` — `OrderItem` has no `@@unique` at all. Two `OrderItem` rows in two different orders can both point at the same `customerSignId` today, and the database will happily accept it.

All `@unique` / `@@unique` in the schema (none on Customer* or OrderItem):
- `accounts (provider, providerAccountId)`
- `sessions.session_token`
- `verification_tokens.token`, `(identifier, token)`
- `password_reset_tokens.token`
- `users.email`
- `team_members.user_id`
- `post_types.name`, `rider_catalog.name`, `lockbox_types.name`
- `orders.order_number`
- `installations.order_id`
- `payment_methods.stripe_payment_method_id`
- `promo_codes.code`

## Other concurrency primitives in the codebase

- `isolationLevel`, `Serializable`, `RepeatableRead`: **0 matches** anywhere.
- `$queryRaw` / `$executeRaw` / `pg_advisory_lock` / `SELECT ... FOR UPDATE`: **0 matches** in app code. (The 4 `FOR UPDATE` hits in `supabase/schema.sql` are Postgres RLS `FOR UPDATE` policy clauses, not row locks — that file is also from a prior Supabase iteration, not the live Prisma path.)
- Optimistic-concurrency `version` / `revision` columns on Customer*: **none**. No `@updatedAt` is being used as a CAS token either.
- Retry-on-`P2002` / unique-conflict handlers: **0 matches**.
- Existing `InventoryHold` / `inventory_locks` / `Reservation` table or model: **none** (only referenced in `docs/ryan-feedback-plan-2026-06-02-v2.md`, i.e. the plan being executed now).
- Restoration path on payment failure: `restoreOrderInventory()` in `C:\Users\tanne\PPI\app\api\webhooks\stripe\route.ts:13` blindly flips `inStorage:true` for every Customer* id referenced by the failed order's items — also unconditional, no guard for "was this item later legitimately re-assigned by someone else?"

## Verdict — what protection exists vs. what's missing

**Exists:**
- The batch checkout and the order-edit endpoint *do* wrap order writes + their inventory flips in a Prisma interactive transaction. Under Postgres' default Read Committed, that gives atomicity (all-or-nothing on commit) but **not** isolation against a concurrent transaction that reads the same row before either commits.
- Stripe payment-failure webhook restores `inStorage:true` so an abandoned 3DS doesn't permanently lock items.

**Missing — every guardrail the soft-hold work needs:**

1. **No uniqueness or exclusion constraint** preventing two `OrderItem` rows from pointing at the same `customerSignId` / `customerRiderId` / `customerLockboxId` / `customerBrochureBoxId`. The DB will accept the double-assignment silently.
2. **No conditional write.** Every `inStorage:false` write today is `where: { id: ... }` — it never checks `inStorage: true` as part of the WHERE, so it can't fail-loud on a race; it just clobbers.
3. **No row-level lock.** No `SELECT ... FOR UPDATE`, no advisory lock, no Prisma `$queryRaw` lock helper.
4. **No isolation level upgrade.** No transaction uses `Serializable` or `RepeatableRead`, so even inside the `batch` and `edit` transactions, two concurrent inventory reads-then-writes can both succeed.
5. **No retry / conflict handler.** No code anywhere catches Prisma `P2002` or `P2034` (transaction conflict), meaning even if a constraint or serializable conflict were added, the API would 500 instead of re-try.
6. **The dominant checkout path (`app/api/orders/route.ts` POST) doesn't even use a transaction for inventory flips** — order create and `inStorage:false` updates happen on separate Prisma calls, so failure between them already leaks (just not racily). Soft-hold work must either move this into a tx or, preferably, gate inventory consumption on an explicit hold-consumption call that *is* transactional and conditional.
7. **No hold-state table, TTL, or expiry sweeper.** No `InventoryHold` model, no scheduled job, no cron.

### Recommendation summary for the soft-hold implementation

Given the audit, the locked-in design needs to introduce, at minimum:
- A new `InventoryHold` table keyed by `(itemType, itemId)` with `expiresAt`, `cartSessionId`/`userId`, `holderActorId`. Add a `@@unique([itemType, itemId])` partial unique on rows where `expiresAt > now()` is not expressible in Postgres directly via Prisma; the cleanest enforcement is a **partial unique index added via raw SQL migration** (`CREATE UNIQUE INDEX ... WHERE expires_at > now()`), or a unique on `(itemType, itemId)` with rows hard-deleted/rewritten on release.
- Hold acquisition done inside a `prisma.$transaction(async (tx) => ..., { isolationLevel: 'Serializable' })` block OR via `tx.$queryRaw\`SELECT ... FOR UPDATE\`` on the Customer* row before inserting the hold. Either gives the "lose the race" path you need.
- Catch `P2002` (unique constraint) and `P2034` (serializable conflict) and translate to a 409 "Item just got claimed by another cart" response; write an audit row via `lib/audit.ts`.
- Make `app/api/orders/route.ts` POST consume the hold inside the same transaction it creates the order (and move its bare `prisma.customerSign.update` calls into that tx). Same for `batch` — it should consume holds, not blindly flip `inStorage`.
- Sweeper: a cron (or lazy-on-read) that deletes holds where `expiresAt < now()` and writes an audit row.

No part of the current codebase will resist a double-assignment today — the protection has to be built from scratch, but the existing `restoreOrderInventory()` pattern in `app/api/webhooks/stripe/route.ts:13` is a clean precedent for the kind of idempotent inventory-side-effect helper the hold expiry sweeper should look like.