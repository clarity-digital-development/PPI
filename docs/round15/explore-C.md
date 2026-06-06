Script ran successfully. Findings below.

---

# Explorer C — Order Base Quantification

**Date:** 2026-06-06 | **DB:** Railway production (live) | **Script:** `c:\Users\tanne\PPI\scripts\_explore-rental-base.ts`

## 1. Active order count

- **All orders in DB:** 176
- **Orders w/ status `completed|scheduled|in_progress|confirmed`:** 170
- **Cancelled OR refunded:** 3
- **Installations with `status='active'` (post in ground):** **139** ← canonical "active" figure
- **Installations removed / removal_scheduled:** 31

Canonical signal = `Installation` rows where `status='active'`. The `Installation` row is created when PPI installs the post and flipped to `removed`/`removal_scheduled` at pickup. That's exactly the trigger boundary the policy needs ("stops when pickup is scheduled"). Recommend cron joins on `Installation.status='active'` rather than `Order.status` — Order can be `completed` long after pickup. Order-status check is a noisy proxy.

## 2. Distribution by install date age (active installs only)

| Bucket | Count | Owes anything? |
|---|---|---|
| 0–30 days | **85** | No |
| 30–90 days | **51** | No |
| 90–180 days | **3** | No |
| 180–270 days | **0** | Would owe 1× $18 |
| 270–365 days | **0** | Would owe 2× $18 = $36 |
| 365+ days | **0** | Would owe $36 + $6/mo |

**Total: 139 active installs, all under 180 days old.**

Oldest active installation is in the 90–180 bucket — i.e. installed sometime between Dec 2025 and Mar 2026. This matches the business age: PPI launched recently enough that no installation has crossed the first 6-month anniversary yet.

## 3. Sample orders from "would owe" buckets

**Zero samples available** — all three "would owe" buckets are empty. No active installation has hit its 6-month anniversary yet.

This is a significant finding for the design: **the cron will not have any "first hit" customers when it ships.** It will spend weeks dormant, then the 90–180 bucket (3 orders) will be the first wave to cross 180 days starting ~30–90 days from now. Plenty of runway to test before money moves.

## 4. Exempt orders among active installs

- **`team_admin` (brokers/Semonin):** 5
- **`admin` (PPI staff/test):** 0
- **`isServiceAreaExempt`:** 0
- **Any exemption (deduped):** **5**
- **Non-exempt active installs:** **134**

96.4% of the active base is non-exempt. Exemption logic is low-volume but real — 5 Semonin/broker installs must be skipped.

## 5. Worst-case retroactive bill if flipped ON today

**$0.00. Zero customers, zero charges.**

Even if `POST_RENTAL_BILLING_START_AT` were set to epoch zero today, the cron would fire no charges because no non-exempt active installation has reached the 180-day threshold. The "going-forward only" default is structurally redundant *right now*, but remains the correct architecture for when an install crosses 180 days while the rollout date is still future-dated.

## Design implications for the cron

1. **Status source of truth = `Installation.status='active'`**, not `Order.status`. Pickup lifecycle lives on Installation; using Order status will keep billing customers whose posts have been pulled.
2. **Install date = `Installation.installedAt`**, not `Order.scheduledDate` or `Order.paidAt`. `installedAt` defaults to row creation, which happens at actual install time per the schema.
3. **Order has no `installDate` column** — the workflow context references `installDate`, but the schema stores this on `Installation`. The cron should join through `Installation`.
4. **No retroactive risk window exists today** — but the dormant-default architecture is still correct: the 3 orders in the 90–180 bucket will cross 180 days over the next 30–90 days, so the rollout date guard prevents accidental hits if `POST_RENTAL_BILLING_START_AT` isn't intentionally set first.
5. **First real billing event is months out.** The team has time to ship, observe Stripe receipts on a synthetic order, and tune the failure-notification email before any customer is charged.
6. **Exemption volume is tiny (5/139)** — no need for bulk admin tooling; the existing per-user `role` + `isServiceAreaExempt` checks are sufficient.

## Full script output

Reproduced verbatim above in the script-run block; script is at `c:\Users\tanne\PPI\scripts\_explore-rental-base.ts` and is safely re-runnable (read-only, no mutations).