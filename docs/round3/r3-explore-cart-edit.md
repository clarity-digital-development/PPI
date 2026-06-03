I have a complete picture now. Let me compile the analysis.

---

## Cart Edit Button — Wiring Plan

### 1. Current cart row shape (`app/dashboard/cart/page.tsx`, lines 260-337)

Each row is a `<Card>` with a two-column flex layout:
- **Left**: agent name, property address, first 4 line-items
- **Right**: estimated total, hold countdown / "Reservation expired" warning, and a single **Remove** text-button (lines 299-316)

Page-level buttons (lines 246-256): **Next order** (links to `/dashboard/place-order?on_behalf_of=...`) and **Clear cart**. No per-row Edit today. Cart state comes from `useCart()` which exposes `{ items, updateItem, removeItem, clearCart }` — `updateItem(id, patch)` already exists (used only by the heartbeat to refresh `holdsExpireAt`).

### 2. Re-opening the wizard pre-populated

**Today there is no edit-cart-item route.** Place-order accepts only `?on_behalf_of=...` (line 55). The wizard's `mode='edit'` already exists but is wired for editing a *placed order* (PATCH-saves to `/api/orders/[id]/edit`), not a cart draft.

**Proposal**: add a new query param to the place-order page:

```
/dashboard/place-order?cart_item_id=cart_1717...
```

When present, the page reads `useCart()`, finds the matching row, and passes the wizard:
- `initialFormData={cartItem.formData}` (already a full `OrderFormData` snapshot — see `lib/cart.ts` line 32)
- `inventory={memberInventory}` loaded from `/api/inventory?member_id=...` (or `?on_behalf_of=...` for the admin flow), using `cartItem.agentId`
- a new prop `editingCartItemId={cartItem.id}` to flip Review-step's "Add to cart" button into "Update cart item"

This stays in **create mode** (not the existing `mode='edit'`) — it's still a draft, not a placed order.

### 3. Wizard's current initial-state source

`order-wizard.tsx` line 127-129:
```ts
const [formData, setFormData] = useState<OrderFormData>(
  initialFormData ? { ...defaultFormData, ...initialFormData } : defaultFormData
)
```
Source is the `initialFormData` prop only — no URL/localStorage/context reads inside the wizard. So passing `initialFormData={cartItem.formData}` from the place-order page is sufficient. The wizard has no awareness of the cart.

Heads-up: `useState(initial)` only seeds once. If the user clicks Edit on row A, then navigates to row B without unmounting, the wizard keeps row A's state. Easy fix: set `key={cartItemId}` on `<OrderWizard>` to force remount per-row.

### 4. Replace-not-append on save

`review-step.tsx` lines 430-530 currently:
1. Mints a NEW `cartItemId`
2. Acquires holds tagged to that new id
3. Reads `localStorage` raw and pushes a new row

For edit-save, we need an "upsert by id" path. Cleanest wiring:

- Add `updateItem` to `useCart()` semantics — it already exists but only patches; it works for our needs since `id` stays the same. We'll do `updateItem(editingCartItemId, { formData, items, estimatedTotal, propertyAddress, holdIds, holdsExpireAt })`.
- In `review-step.tsx`, branch on the new `editingCartItemId` prop:
  - If unset → existing "Add to cart" path (mint new id).
  - If set → reuse the existing id, perform the hold diff (below), then call `updateItem` instead of the raw localStorage push, then `router.push('/dashboard/cart')`.

No new API endpoint needed for cart state — it's still localStorage.

### 5. Hold diff on save (the dangerous part)

A cart row carries `holdIds: Record<string, string>` keyed by `${field}:${itemId}` (e.g. `customer_sign_id:abc123`). On edit-save:

**Step A — compute diffs** between the OLD `holdIds` keys and the NEW selections derived from the freshly-built `items` array (use the same loop on lines 440-450 of review-step to produce `newKeys: Set<string>`):

- `toRelease = oldKeys − newKeys` → items the user removed/swapped out
- `toAcquire = newKeys − oldKeys` → items the user newly picked
- `toKeep = oldKeys ∩ newKeys` → unchanged, reuse existing hold ids

**Step B — acquire-then-release** (order matters):

1. For each `toAcquire`, POST `/api/inventory/holds` with the EXISTING `cartItemId` so the new hold is owned by the same row. Collect new hold ids into `nextHoldIds` (along with `toKeep` reused entries).
2. If ANY POST fails (409 inventory conflict), unwind only the *newly acquired* holds (do NOT release `toKeep` — the user can recover their original selection by hitting Cancel). Surface error, abort save.
3. Only after all acquires succeed, DELETE each `toRelease` hold via `/api/inventory/holds?id=...` (fire-and-forget — the sweeper reaps on TTL anyway).
4. Compute the new earliest `holdsExpireAt` across `nextHoldIds`.
5. Call `updateItem(cartItemId, { …, holdIds: nextHoldIds, holdsExpireAt })`.

**Acquire-before-release** is critical — if we release first and then the acquire 409s, the user loses BOTH the old and new items. Acquiring first means worst case they keep what they had.

**Cancel/back-out**: if the user opens Edit, picks new items (acquiring fresh holds), then navigates away without saving, those speculative holds will leak. Two options:
- **Best**: route changes to the in-wizard hold acquisition so it only fires at "Update cart item" submit, not during step navigation (matches today's "Add to cart" behavior — holds only acquired on the review submit).
- Fallback: add a `beforeunload` / route-change guard that releases any holds whose id is not already in `cartItem.holdIds`.

The existing wizard already defers all hold acquisition to the review-step submit (lines 430-492 are inside `handleAddToCart`), so option 1 falls out for free — we just don't acquire anything until the user clicks "Update cart item".

**Edge case**: if `expiredRows.has(cartItem.id)` (the row's old holds already 409'd in the heartbeat), treat the edit as "all selections are toAcquire" — skip the release step, since the old hold ids are already dead server-side. Add a guard in the diff: filter `toKeep` against a server confirmation, or simpler — just attempt the releases anyway (404s on dead holds are harmless).

### Files to touch
- `c:\Users\tanne\PPI\app\dashboard\cart\page.tsx` — add Edit button per row, link to `/dashboard/place-order?cart_item_id=...`
- `c:\Users\tanne\PPI\app\dashboard\place-order\page.tsx` — read `cart_item_id` from `useSearchParams`, look up via `useCart`, pass `initialFormData` + new `editingCartItemId` prop, set `key` for remount
- `c:\Users\tanne\PPI\components\order-flow\order-wizard.tsx` — thread `editingCartItemId` prop into review step
- `c:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx` — branch `handleAddToCart` on `editingCartItemId`: implement the hold diff (acquire-then-release) and call `updateItem` instead of the raw localStorage push
- `c:\Users\tanne\PPI\lib\cart.ts` — no shape changes; `updateItem` already exists and works for upsert-by-id