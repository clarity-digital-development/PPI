I have what I need. Findings below.

---

# Client/Cart UI Audit — Findings

## 1. HIGH — `handleAddToCart` partial-hold leak on tab close
**File:** `components/order-flow/steps/review-step.tsx:456-492`

The unwind in `catch (acqErr)` only fires if a hold POST throws (network error, 409, etc.). It does NOT fire if:
- User closes the tab mid-loop (no `beforeunload` cleanup)
- User hits browser back button (React unmounts before the await resolves; the dangling `fetch` promises continue but `acquired` array is gone)
- Component unmounts because parent navigated away

**Quantified risk:** For a 3-item order (sign + rider + lockbox), the loop window is ~300-900ms of latency. A user who clicks "Add to Cart" then immediately clicks browser-back has a ~50% chance of leaving 1-2 holds stranded for the full 15-min TTL. These holds are NOT tied to any cart row in localStorage, so the heartbeat won't refresh them and `removeItem` can't release them — the sweeper is the only reaper.

**Fix:** The server-side sweeper at 15-min TTL is the safety net (acceptable for low-volume PPI traffic), but consider an `AbortController` tied to a `useEffect` cleanup, OR have the server release any orphaned holds matching `cart_session_id + cart_item_id` if no cart row exists. Document as "by design — sweeper reaps within 15 min."

## 2. MEDIUM — Sequential hold acquisition latency
**File:** `components/order-flow/steps/review-step.tsx:456-483`

The `for…of await` loop is sequential. For a worst-case order (sign + rider + lockbox = 3 holds), at typical Vercel cold-start + DB roundtrip (~300ms each) that's ~900ms of "Adding…" spinner. For a wired-frame-heavy + brochure + sign + rider + lockbox order the user only has 3 hold-eligible items (sign/rider/lockbox — brochures and wire frames are quantity-aggregated per the comment at line 437-438), so the cap is 3 sequential calls.

**Acceptable:** 900ms p99 for a batching admin workflow. Could be a single `POST /api/inventory/holds/batch` round-trip if it becomes annoying, but not urgent.

## 3. HIGH — Hold-map key collision allows silent overwrite + leak
**File:** `components/order-flow/steps/review-step.tsx:480`

`holdIds[`${req.field}:${req.itemId}`]` — if the same `customer_sign_id` appears twice in `items` (e.g. user accidentally selects the same stored sign for both primary and second-post sign), the loop will:
1. Acquire hold A → store under key `customer_sign_id:abc`
2. Acquire hold B for the same item → server returns 409 `item_already_held` (because A holds it)

Actually the partial unique index PREVENTS duplicate live holds, so the second POST will 409 and the unwind releases A. **Good — defended by the server.**

BUT if review-step ever builds items with two DIFFERENT inventory ids that resolve to the same `field:id` key (e.g. via a typo in `buildItems`), the second hold ID would silently overwrite the first in `holdIds`, and the unwind path in `acquired[]` would still release both (acquired is a flat array). The cart row would then carry only ONE hold ID, and `removeItem` would release only that one. The first hold would be orphaned.

**Severity:** HIGH if any future code path produces the same `field:id` twice; LOW today because `buildItems` doesn't.
**Fix:** Use a `Set` of `field:id` keys to detect duplicates upfront and reject, or key by `hold_id` instead.

## 4. PASS — Heartbeat fires on visibility resume after long hidden period
**File:** `lib/cart.ts:200-231`

Trace: `useEffect` deps are `[enabled, intervalMs, bump]`. `bump` is `useCallback(…, [])` so its identity is stable. `enabled` flips only on `checkingOut`/`done`. After 20 min hidden, browser throttles `setInterval` heavily (some browsers fire it at 1Hz, some skip entirely). On visibility restore:
- The `visibilitychange` listener (line 207-210) fires immediately and calls `bump()`.
- The `setInterval` either resumes normally or fires a backlog of callbacks (all gated by `document.visibilityState === 'visible'` so safe).

**Works correctly.** But note the bump will return `extended: false` for any hold that expired during the hidden window — the cart UI will (correctly) push those into `expiredRows`.

## 5. PASS — 30s countdown granularity acceptable for 15-min TTL
**File:** `app/dashboard/cart/page.tsx:426-438`

Worst-case displayed value lags 30s behind reality. For a 15-min TTL with heartbeats every 4 min, the actual margin is huge. Users see "13:42" then "13:12" — fine.

## 6. MEDIUM — Cart-mount heartbeat can flash "expired" before user sees row
**File:** `app/dashboard/cart/page.tsx:49-61` + `lib/cart.ts:204-205`

The initial `void bump()` runs synchronously on mount. If a hold expired between cart-page navigation and bump completion (~200ms), `onConflict` fires before the first render shows the countdown. Result: user sees "Reservation expired — remove & re-pick" with no transition from a live countdown — confusing but factually correct.

Worse: if the user just came from `handleAddToCart` (which JUST acquired holds with 15-min TTL), the bump should always succeed. But if the user opened cart from a stale browser tab they left open overnight, ALL rows immediately flash red. The UI does handle this with the amber banner at line 361-367 ("Some reservations expired while your cart was open"), but the messaging assumes the cart was already open — it wasn't, it was just loaded.

**Fix:** Tweak banner copy to handle both "while open" and "since you last visited" cases, OR auto-remove rows whose holds have already expired on mount.

## 7. HIGH — `removeItem` race: remove + re-add could double-hold (briefly)
**File:** `lib/cart.ts:118-126`

`removeItem` fires DELETE fire-and-forget AND immediately updates localStorage. If the user removes a sign row then re-adds the SAME sign from the customer page before the DELETE roundtrips (~200-500ms), the re-add POST will hit the server while the original hold is still live → 409 `item_already_held`. The user sees "One of these items is already in another cart" even though THEY just removed it.

**No double-charge risk** (the partial unique index protects atomically), but the UX is broken for quick remove-then-readd. Probability low (humans don't usually re-add in <500ms) but possible for keyboard-driven flows.

**Fix:** Either await the DELETE before updating localStorage, or have the server-side hold acquire accept a "release-then-acquire" flag for `cart_session_id` matches.

## 8. MEDIUM — Cart selectedPaymentMethod stales when user adds card on cart page
**File:** `app/dashboard/cart/page.tsx:63-79`

`fetchPayments` runs once on mount (`useEffect(…, [])`). There's no "add card" UI ON the cart page (unlike review-step's `AddCardModal`), so a user with zero cards sees the amber prompt at line 374 directing them to `/dashboard/billing`. After adding a card, they must navigate BACK to the cart — which remounts and re-fetches. So in practice this works, but ONLY because there's no in-page add-card.

If you ever add an `AddCardModal` to the cart page, the `selectedPaymentMethod` will not auto-update unless `handleCardAdded` is implemented to refetch. Current state: **PASS by accident, fragile to future changes.**

## 9. HIGH — Heartbeat-on-mount with all-expired holds: data loss invisible
**File:** `lib/cart.ts:172-198` + `app/api/inventory/holds/bump/route.ts`

When a user closes browser at 14 min and reopens at 16 min:
- Cart page mounts → reads localStorage → renders all rows with their stale `holdsExpireAt` (showing "Reserved for 14:32" or similar — already past target time, so `HoldCountdown` shows "0:00").
- `useHoldHeartbeat` fires initial bump → server's `bumpHolds` returns `byCartItem` entries with `extended: false` for every row whose holds the sweeper already reaped.
- `onConflict` fires N times → all rows go into `expiredRows`.

But there's a subtle bug: `bumpHolds` is called with `cartItemIds: cartItem.ids`. If the holds are already SWEEPER-REAPED (i.e., the DB rows have `released_at` set or were deleted), the server may return NO entry in `byCartItem` for that id — neither `extended: true` nor `extended: false`. Tracing `lib/cart.ts:187-194`:

```
for (const ci of cartItemIds) {
  const r = data.byCartItem?.[ci]
  if (r?.extended) { … }
  else if (r && !r.extended) { onConflictRef.current?.(ci) }
  // if r is undefined → neither branch fires
}
```

If the server omits already-reaped holds from `byCartItem`, the row is silently left in a zombie state: countdown shows "0:00" but no `expiredRows` entry, so the "expired" warning doesn't render and checkout WILL be attempted. The server's batch endpoint will then 409 on `claimHoldsInTx`.

**Fix:** Either ensure `bumpHolds` returns `{ extended: false, reason: 'not_found' }` for every requested cart_item_id (verify server contract), OR treat missing entries as conflicts client-side:
```ts
if (r?.extended) { … }
else { onConflictRef.current?.(ci) }   // missing OR not extended
```
Recommend the client-side fix — defense in depth.

---

**Summary:** Findings 1, 3, 7, and 9 are the most actionable. Finding 9 in particular is a concrete client-side bug worth fixing immediately — change the `else if (r && !r.extended)` to `else` so missing server entries also trigger the conflict UX.