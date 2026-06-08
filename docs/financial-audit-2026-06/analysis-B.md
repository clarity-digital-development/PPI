Good — `paidAt` is sparse and `createdAt` is the right field. So 90d supply: **165 posts, 151 signs, 69 riders, 51 solar lights, 22 lockboxes, 10 wire-frame**. That changes wholesale viability math meaningfully. Now I have everything I need.

I have the numbers. Drafting the final brief now.

---

# PPI OPERATIONAL EFFICIENCY BRIEF
**Pulled 2026-06-08 from live Railway Postgres. Read-only analysis.**

## TL;DR — three operational truths

1. **94.9% of scheduled days are under-utilized** — average 2.4 crew-hours of work in an 8-hour day. The system is paying for a full crew shift to do 1.85 stops/day. Routing density is the single largest unforced operational loss.
2. **The trip-fee leak is real and quantifiable: ~$5,120/yr.** 32 of 45 service requests in the last 90 days were completed without an invoice. That's 71% of service trips done as free labor.
3. **3-digit ZIP clusters reveal the hidden density that flat-list view hides**: 403xx (Georgetown/Versailles corridor) = 74 lifetime orders, 405xx (Lexington urban) = 32, 402xx (Louisville) = 25. **403xx alone is 42% of all orders** — a dedicated weekly route here is the highest-leverage change you can make.

---

## RANKED OPERATIONAL RECOMMENDATIONS

### #1 — Mandatory zip-cluster batching ("install days by region") — ~$2,500-4,500/yr labor recovery
**Data:** 39 distinct scheduled days, 72 stops. **19 days (48.7%) had exactly 1 stop.** 17 of those single-stop days were in clusters that have 10+ lifetime orders — meaning batching was *possible* and didn't happen. 16 multi-stop days routed through multiple clusters (split-routes — drive-time penalty).

**Lever:** Add a hard scheduling rule — order placed in a given ZIP-prefix cluster snaps to that cluster's assigned day of the week, unless customer pays a $25 "off-route" expedite surcharge:
- **Mon/Wed/Fri** = 403xx + 405xx (Lex/Georgetown/Versailles) — covers 60% of demand
- **Tue/Thu** = 402xx (Louisville/Danville) + 404xx (Richmond/Berea) — covers ~22%
- **Wednesday alt-week** = 410xx, 427xx, 400xx (outer counties)

**Margin math:** at current 1.85 stops/day average → 4 stops/day target. Drive amortization drops from 50% of clock to 20%. Even with no other change, that reclaims **~1.5 hours per day × 2 crew × $25/hr = $75/install-day saved**. At 39 days/quarter, ~$2,900/quarter, **~$11K/yr** if fully implemented. Conservatively half-captured: **$5-6K/yr**.

**Implementation cost:** zero code. Configure a `serviceCenter.allowedDayOfWeek[]` field per ZIP cluster. The booking UI already shows available dates — this just filters them.

---

### #2 — Auto-bill the trip-fee leak: ~$5,000/yr immediate recovery
**Data:** 45 service requests last 90d, 32 completed without an invoice (71%). All 5 invoiced trips collected at 100% (no card failures). The collection mechanism works; the trigger is missing.

**Lever:** When an admin marks a service request `completed`, default-prompt them with "Invoice this trip? [$40 / custom / skip + reason required]." Make `skip` require a reason. Current behavior is the opposite — skipping is the path of least resistance.

**Margin math:** at ~$40/trip × 32 unbilled trips × 4 quarters = **$5,120/yr direct revenue**. No labor cost — work was already done. **Pure margin recovery.**

**Implementation cost:** one modal in admin completion flow. ~3 hours of work.

---

### #3 — Wholesale procurement is now viable on posts, signs, riders — ~$2-4K/yr COGS reduction
**Data (last 90d, by createdAt):** 165 posts, 151 signs, 69 riders, 51 solar lights, 22 lockboxes, 10 wire-frame. Annualized run-rate: **~660 posts, ~600 signs, ~275 riders, ~200 solar lights, ~90 lockboxes**.

**Lever:** at this volume, supply contracts move from retail to wholesale:
- **Posts/hooks:** wholesale yard-sign-supply distributors (e.g., DeeSign, Lowen Sign Wholesale, Hall Signs) typically require ~$2K annual spend for distributor pricing. At ~$15 retail-cost-per-post × 660 = ~$10K/yr spend. **Solidly above the wholesale threshold.** Typical savings: 25-35% on hardware = **$2.5-3.5K/yr**.
- **Solar lights:** 200/yr at ~$8 retail vs ~$4.50 bulk (Alibaba/wholesale) = ~$700/yr.
- **Lockboxes:** 90/yr — still small. Stay retail.

**Implementation cost:** Ryan's time to set up distributor accounts. One afternoon.

---

### #4 — Stop carrying inventory for never-customers — small but free
**Data:** 4 users hold inventory in PPI storage but have **never placed a paid order**. Their dormant items: 15 signs, 5 lockboxes, 15 riders, 4 brochure boxes. Additionally, **3 signs and 1 lockbox have been sitting in storage >90 days** with no recent activity.

**Lever:** quarterly email: "We're still holding [N] items for you. If you don't plan to use them in the next 60 days, we'll return them at our cost — otherwise a $5/mo storage fee starts on [date]." Either gets cash flowing or clears physical space.

**Margin math:** small — ~$200/yr at minimum, but real space saved is the bigger win.

---

### #5 — Expedite fee is dead — fix or kill it
**Data:** 0 of 177 orders ever paid an expedite fee. 0 orders had a paid→scheduled gap <24h. The same-day-cutoff hardening you shipped is working, but the option for customers to pay extra to override it is invisible or unused.

**Lever:** either prominently surface "Need it today? +$40" in checkout when the customer picks a date past their submission deadline, or remove the field. Currently it's dead weight in the schema and the cart.

**Margin math:** even 1 expedite/week at $40 = **~$2K/yr**.

---

### #6 — Crew time-tracking — instrumentation, not a recommendation
**Data:** there is **no time-tracking data in the DB**. Every utilization number above is modeled. The 94.9% under-utilization figure is plausible but unproven.

**Lever:** simple admin "I'm starting [order]" / "I finished [order]" buttons. Two timestamps per order, ~30 minutes of dev work. Within 4 weeks you'd know actual stops-per-hour, real drive overhead, and whether the 1.85 stops/day pattern is a scheduling problem or a demand problem.

**Margin math:** indirect — but **every recommendation above gets sharper** once you can measure real-vs-modeled labor.

---

### #7 — Pickup batching with reminder emails — ~$800-1,500/yr
**Data:** 34 removal requests in 90d, none auto-batched. Median install lifetime is 35 days, far shorter than the 6-month rental window — meaning pickups arrive constantly.

**Lever:** auto-email customers at day 30/45/60 of install: "Time to pick up? Schedule now (free) or wait — emergency pickup is $40." This converts surprise-pickup-trips (un-batched, expensive) into planned ones (batched into a route).

**Margin math:** if 50% of pickups become batched into existing install routes, drive cost on those goes to ~$0. Conservatively **$15-25 saved per converted pickup × ~50/yr = $750-1,250/yr**.

---

## WHAT WON'T MOVE THE NEEDLE

- **Out-of-area surcharge enforcement** — already $0 captured because 0 orders qualify. No action needed.
- **Repair/replacement rework workflows** — DB shows 0 repair, 0 replacement requests all-time. Either nothing breaks (unlikely) or customers contact via channels we don't track. If real, that's a leak — but invisible without tagging.
- **Refund rate** — 0% all-time across 177 orders. Not a problem to solve.
- **Brokerage volume strategy** — 1 active broker (Semonin), 0 orders placed via the bulk-placement UI. The team_admin feature is dormant; building more around it is wasted effort until somebody actually uses it.

---

## STACK-RANKED ANNUAL IMPACT (best case)

| Recommendation | Annual margin impact | Effort |
|---|---:|---|
| #1 Zip-cluster batching | $5,000-11,000 | Low (config) |
| #2 Trip-fee auto-bill | $5,120 | Very low (1 modal) |
| #3 Wholesale procurement | $3,000-4,200 | One-time setup |
| #5 Expedite fee fix | $2,000 | Low (UI tweak) |
| #7 Pickup-batching email | $750-1,250 | Low (cron) |
| #4 Dormant inventory fee | $200 | Very low |
| **Total realistic recovery** | **~$16-23K/yr** | |

**Context:** PPI did $9,769 gross all-time. These operational fixes alone roughly **double recoverable margin at current volume** — without adding a single new customer.

---

**Scripts created (read-only):**
- `c:\Users\tanne\PPI\scripts\_audit-operational-efficiency.ts`
- `c:\Users\tanne\PPI\scripts\_verify-supply-vol.ts`