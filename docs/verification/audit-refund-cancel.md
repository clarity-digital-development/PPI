I have enough to produce the audit. Note: the customer-facing `canCancel` UI helper still uses UTC midnight (line 143-152), but the server-side `app/api/orders/[id]/cancel/route.ts` correctly uses `easternMidnightMs`. This is a UI/server cutoff discrepancy worth flagging.

---

# Refund + Cancel Audit (branch `ryan-feedback-2026-06-02`)

## Wiring verification

| Item | Status | Evidence |
|------|--------|----------|
| Customer Cancel button on `/dashboard/orders/[id]` | Verified | `app/dashboard/orders/[id]/page.tsx:487-496` (button gated by `canCancel()`) and modal at 500-509 |
| Auto-refund under $250 (single click) | Verified | `app/api/orders/[id]/cancel/route.ts:87-100` — only returns 409 `requiresConfirmation` when `totalCents >= 25000`. Sub-$250 falls straight through to `refundOrder({ auto: true })` (line 102-108) |
| Double-confirm modal over $250 | Verified | Route returns `{ requiresConfirmation: true, amount, message }` at 409 (`route.ts:92-99`); client renders 'high-value' step (`page.tsx:551-555`, modal at 573-591); second click sends `{ confirmed: true }` |
| 24h cutoff vs `scheduledDate` (server) | Verified | `route.ts:73-85` uses `easternMidnightMs(scheduledDate) - 24h` (ET, not UTC — the Megan-10pm-style fix) |
| 24h cutoff (client `canCancel` hides button) | Concern (low) | `app/dashboard/orders/[id]/page.tsx:143-152` still uses `setUTCHours(0,0,0,0)`, NOT `easternMidnightMs`. Server is authoritative so no money-safety risk, but the button can appear ~4h after the true ET cutoff (or hide ~4h early), which can confuse customers. Worth a follow-up. |
| Cutoff skipped for Next-Available | Verified | `route.ts:73` (`if (order.scheduledDate)`), `page.tsx:147` (`if (!o.scheduledDate) return true`) |
| Refund email → BROKER, not agent | Verified | `lib/orders/refund-recipient.ts:39-76` — placedByUserId → team_admin via teamId → else self → fallback to user. `lib/refunds.ts:198` and webhook `route.ts:270` both call `resolveRefundRecipient(order)` |
| Stripe-dashboard-initiated refunds reconciled | Verified | `app/api/webhooks/stripe/route.ts:162-307` charge.refunded handler. Dashboard detection at line 221 (`dashboardInitiated = !order.refundInitiatedAt`). Stamps `paymentStatus='refunded'`, `status='cancelled'`, `cancelReason='stripe_dashboard'`, releases inventory holds, sends email. |
| Admin Refund Order button | Verified | `app/admin/orders/[id]/page.tsx:352-368` (button), 712-783 (modal), 208-225 (POST). Single-step confirm, no 24h cutoff. |
| Money safety — tx-first reserve | Verified | `lib/refunds.ts:78-110` — conditional `updateMany` with `WHERE refundInitiatedAt:null AND refundId:null AND paymentStatus:'succeeded'` BEFORE Stripe call. Atomic single-DB lock closes customer/admin race, double-click, and webhook misclassification. |
| Idempotency key on `refunds.create` | Verified | `lib/stripe/server.ts:170-188` — SHA-256 of `${orderId}:refund_v1` sent as `idempotencyKey` to Stripe. Metadata trimmed to `order_id` only (avoids R3 idempotency-collision bug). |
| Email double-send protection | Verified | `lib/refunds.ts:192-228` and webhook `route.ts:264-293` both reserve `refundEmailSentAt` via conditional `updateMany` before sending; loser no-ops. Failed sends roll back the reservation. |
| `paymentStatus='refunded'` owned by webhook | Verified | `lib/refunds.ts:66-67` comment + Step 3 (line 150-157) does NOT set paymentStatus; webhook does at `webhooks/stripe/route.ts:227`. Single source of truth. |
| Audit trail | Verified | `OrderRefundCreate`, `OrderCancel`, `OrderRefundFail`, `OrderRefundWebhook` all wired (`lib/refunds.ts:160-184, 219-226`; webhook 199-211, 295-306) |
| Admin "Refund processing" badge until webhook lands | Verified | `app/admin/orders/[id]/page.tsx:343-349` shows pulsing badge when `refundInitiatedAt && !refundedAt` |

## Concerns

1. **Client cutoff uses UTC, server uses ET (low severity, UX only).** `page.tsx:143-152` should mirror `easternMidnightMs`. Server will correctly reject if a customer slips through, so this is not a money bug — just inconsistent UX.
2. **`order.user` not included when webhook calls `resolveRefundRecipient`.** Webhook fetches `findFirst({ include: { user: true }})` (`webhooks/stripe/route.ts:173-176`) — good, matches the helper signature. No bug.
3. **`refundedBy: 'admin'` for webhook-path email even when it's actually customer-cancel.** `webhooks/stripe/route.ts:279` hardcodes `'admin'`. In practice the customer-cancel path emails from `refunds.ts` first (reserves the slot), so the webhook only sends when `refunds.ts` failed to. Edge case but worth noting — customer who got a refund from cancelling their own order could see "refunded by admin" copy if email-send failed in `refunds.ts` and only the webhook retry succeeded.
4. **Admin refund modal does not warn about email recipient.** Admin sees "broker will be notified" in the success banner (`page.tsx:219`) but not before confirming. Minor.

## Missing
None against the changelog claim. All eight bullets in the changelog map cleanly to code.

---

## Ryan walkthrough

### Test 1: Customer auto-refund under $250
- [ ] Log in as `test@pinkposts.com` / `PinkPosts2026`
- [ ] Place Order → choose agent Ashley → pick one sign (verify total < $250) → checkout with `4242 4242 4242 4242` / any future expiry / any CVC
- [ ] Wait for confirmation page
- [ ] Sidebar → Order History → open the new order
- [ ] Click "Cancel Order" (red, bottom-right of action row)
- [ ] In the modal, leave reason blank, click "Cancel Order"
- Expected: Modal closes; the page reloads; a Cancelled banner appears; status flips to "cancelled". Email goes to **test@pinkposts.com** (broker = self for this account). Within 30s the badge changes from "Refund processing" to "Refund processed" once the Stripe webhook lands.
- If you see a $250 confirmation modal on a sub-$250 order → bug (check `route.ts:88` threshold).
- If nothing happens after click → DevTools → Network → look at POST `/api/orders/[id]/cancel`. 500 = server error; 409 with `requiresConfirmation` = threshold logic broken.

### Test 2: Customer double-confirm over $250
- [ ] Same login, Place Order → choose Ashley → add enough signs that total >= $250 (e.g. 3+ signs) → checkout with `4242...`
- [ ] Open the new order from Order History → click "Cancel Order"
- [ ] First click: should see "Yes, Refund $XXX.XX" amber confirmation modal
- [ ] Click "Yes, Refund $XXX.XX"
- Expected: refund proceeds same as Test 1. Two-step confirmation required.
- If you see the refund go through on the first click without a second confirmation → bug.
- If you see the amber modal but "Yes, Refund" does nothing → check Network: POST should include `{ confirmed: true }`.

### Test 3: 24h cutoff blocks cancel
- [ ] In Prisma Studio or DB, pick a recent paid order and set `scheduledDate` to today (Eastern). Or place a new order scheduled for tomorrow and wait until you're within 24h.
- [ ] Reload `/dashboard/orders/[id]`
- Expected: "Cancel Order" button is hidden. If the customer tries via API directly (curl POST), server returns 409 "Cancellation window closed".
- If button shows but server rejects → known low-priority UI/server cutoff drift (client uses UTC midnight at `page.tsx:148-150`, server uses ET midnight). Document but don't ship-block.
- For Next-Available orders (`scheduledDate = null`), Cancel should ALWAYS be visible until status changes.

### Test 4: Refund email goes to broker, not agent
- [ ] Log in as `test@pinkposts.com` (broker)
- [ ] Place Order → use the "Place on behalf of Ashley" flow so `placedByUserId = test`, `userId = Ashley`
- [ ] Cancel the order
- Expected: refund-confirmation email lands in **test@pinkposts.com's** inbox (the broker / placer), NOT Ashley's.
- Verify in Resend dashboard (or check `lib/refunds.ts:198` log line).
- If Ashley gets the email instead → check `resolveRefundRecipient` rule 1 — `order.placedByUserId` must be set on the order row.

### Test 5: Admin Refund Order
- [ ] Log in as `admin@pinkposts.com` / `admin123`
- [ ] Navigate to `/admin/orders` → pick any paid, non-cancelled order → open detail page
- [ ] Click "Refund Order" (red, top-right action bar)
- [ ] Add optional internal reason → click "Refund $XXX.XX"
- Expected: Single-step modal (no $250 confirmation). Green banner: "Refund of $X.XX initiated. The broker will be notified once Stripe confirms." Yellow "Refund processing" badge appears immediately; flips to "Refunded" after webhook reconciles (~10-30s).
- Admin path has NO 24h cutoff — should work even on past-scheduled orders.
- If admin sees a 409 "Cancellation window closed" → wrong route was hit (admin should call `/api/admin/orders/[id]/refund`, not `/api/orders/[id]/cancel`).

### Test 6: Stripe-dashboard refund reconciles
- [ ] In Stripe Dashboard (test mode) → find the PaymentIntent for a paid order → Refund → Full → confirm
- [ ] Wait ~10s for the `charge.refunded` webhook to fire
- [ ] Refresh `/admin/orders/[id]` for that order
- Expected: order shows `paymentStatus='refunded'`, `status='cancelled'`, `cancelReason='stripe_dashboard'`. Inventory holds released. Broker gets refund email (one copy only — the webhook reserves `refundEmailSentAt`).
- If status doesn't flip → check `STRIPE_WEBHOOK_SECRET` env and the Stripe CLI listener. Then look for `charge.refunded` event in Stripe Dashboard Events.
- If two emails arrive → the email-reservation conditional update failed; check Prisma migration for `refundEmailSentAt` column.

### Test 7: Idempotency — double-click Cancel
- [ ] Same setup as Test 1, but open DevTools → Network → Throttling → Slow 3G
- [ ] Click "Cancel Order" twice rapidly in the modal
- Expected: First request wins reservation (`refunds.ts:78-91`); second gets 409 `ALREADY_REFUNDED`. Exactly one Stripe refund, one email, one audit `OrderRefundCreate` row.
- If you see two refunds in Stripe Dashboard → catastrophic; the conditional `updateMany` failed.
- Verify in DB: `SELECT refundInitiatedAt, refundId, refundedAt, refundEmailSentAt FROM Order WHERE id = '...'` — exactly one row, all timestamps populated once.

### Test 8: Refund-processing race window (customer cancels, then admin tries to cancel before webhook)
- [ ] As customer, cancel a sub-$250 order
- [ ] Within 2 seconds (before `charge.refunded` webhook lands), as admin in another tab, open the same order and click "Refund Order"
- Expected: Admin path returns 409 "Order has already been refunded" — `app/api/admin/orders/[id]/refund/route.ts:43-48` checks `refundId` AND because `refunds.ts` reserved `refundInitiatedAt`, the `updateMany` would fail anyway. Belt-and-suspenders.
- If admin successfully creates a second Stripe refund → bug (this is the R3 scenario the reserve was built for).

Files for reference:
- `c:\Users\tanne\PPI\app\api\orders\[id]\cancel\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\orders\[id]\refund\route.ts`
- `c:\Users\tanne\PPI\app\api\webhooks\stripe\route.ts`
- `c:\Users\tanne\PPI\lib\refunds.ts`
- `c:\Users\tanne\PPI\lib\stripe\server.ts`
- `c:\Users\tanne\PPI\lib\orders\refund-recipient.ts`
- `c:\Users\tanne\PPI\app\dashboard\orders\[id]\page.tsx`
- `c:\Users\tanne\PPI\app\admin\orders\[id]\page.tsx`