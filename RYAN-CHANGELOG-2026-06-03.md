# Pink Posts — Round 2 follow-up (post-Zoom videos)

Hi Ryan, here's what we built from your feedback videos + the lockbox-rental
email. Same test account works (`test@pinkposts.com` / `PinkPosts2026`) plus
your Pink Posts **admin** account for the admin-side items (marked 🛠).

Effective ship date: **6/10/2026** for Semonin full implementation.

---

## 1. Cancel an order yourself + automatic refund

**What changed:** Customers (and team admins) can now cancel a paid order
directly from the order detail page — no more calling in. A refund is
issued to the original card automatically.

**Where:** Order History → open a paid order → **Cancel Order** button.

**How it works:**
- **Auto-refund under $250.** One click, refund processes, email lands.
- **Confirm-twice over $250.** First click pops a confirmation modal
  ("This will refund $XXX.XX — please confirm"). Second click executes.
  Just a friction step — no admin involvement needed.
- **24-hour cutoff before the install date.** Inside 24h, the Cancel
  button is hidden and the API blocks it. Customers can still call you.
- **Email goes to the broker, not the agent.** When you (as team admin)
  place an order on behalf of an agent, the refund-confirmation email
  comes to you — agents don't see it. Matches the locked decision from
  Tuesday.
- **Refunds you do in Stripe Dashboard also work.** The webhook listens
  for `charge.refunded`, flips the order to "Cancelled — refunded," and
  sends the same broker email. So if you'd rather refund manually in
  Stripe, the customer's PP order still ends up in the right state.

**Try it:**
1. As the test account, place a small order ($150 or so), pay with a
   test card, wait for the confirmation.
2. Open it from Order History → click Cancel → confirm → watch the
   page flip to "Cancelled — Refund of $XXX processing."
3. The customer page then shows "Refund of $XXX processed on \[date]"
   once Stripe finishes (usually 5-10 seconds in test mode).

🛠 **Admin side:** open any paid order → **Refund Order** button
(red outline). Single-step confirm, no 24h cutoff, no double-confirm.

---

## 2. Inventory soft-holds (the "two of us claimed the same sign" fix)

**The problem you flagged:** Two team admins building carts at the same
time could each pick the same physical sign / lockbox, race each other
to checkout, and both end up "owning" it.

**What changed:** When you put an item in your cart, it's now **reserved
for 15 minutes**. No one else can pick it until you either check out or
remove it from your cart. A countdown shows on each cart row.

**Where you'll see it:**
- **Inventory list:** items in someone else's cart simply don't appear
  in the picker. (No "this was just claimed" error mid-flow.)
- **Cart screen:** small clock badge under each row showing "Reserved
  for 14:32" with a live countdown. The reservation auto-extends every
  4 minutes while the cart page is open and the tab is focused.
- **If a reservation expires** while you're filling out the order:
  red "Reservation expired — remove & re-pick" badge appears, and the
  Checkout button is blocked until you remove the affected row.

**What this prevents:**
- **Double-allocation** of the same physical item across two orders.
- **Customer being charged for an order that doesn't exist** (the
  checkout flow now creates the orders first, then the Stripe charge —
  if the charge fails for any reason, no money moves and no order is
  half-created).
- **Mid-cart agent reassignment** — if you reassign an item to a
  different agent while it's in someone's cart, the system refuses
  with a clear "in active cart" message instead of silently switching
  which agent will be billed.

**Try it:** In two browser tabs as the test account, try to add the
same sign to two different orders. The second tab will see the item
disappear from the inventory list (because the first tab is holding it),
or get a "this item is already in another cart" error.

---

## 3. Cart stays in your browser (no surprise behavior change)

**We considered** moving the cart to a server-side per-user store so it
would follow you across devices. After looking at how your test account
works (shared `supportstaff@semonin.com` login used by 2-3 staffers),
a per-user shared cart would mean two staffers could step on each
other's cart contents — that's *worse* than today. Per-session would
add complexity without delivering cross-device, which is what you
actually said you wanted.

**The compromise:** the soft-hold work above already prevents the
inventory race that was the real pain (two staffers won't claim the
same item, regardless of where their carts live). We're leaving the
cart storage as-is for now. Once you've used the holds in production
for a week, ping us if you want cross-device cart sync — we'll spec
the right shape with your actual workflow in front of us.

---

## 4. Admin: assign inventory to an agent at add-time

**What changed:** 🛠 When you (Pink Posts admin) add a sign / rider /
lockbox / brochure box to a team admin's account, you can now pick which
of their agents owns it right in the Add modal.

**Where:** Admin → a customer's profile → Add Sign (or Rider / Lockbox /
Brochure) → new **"Assign to agent (optional)"** dropdown below the
quantity field. Defaults to "Unassigned (team pool)." Hidden for
non-team customers.

**Why it matters:** Today you have to add the inventory unassigned and
then make the team admin reassign each item from their Team Inventory
page. This skips that step.

**Bulk reassign** (admin picks N items + a new agent and moves them in
one shot) — the backend endpoint is shipped and ready; the UI for it
will follow once you've used the assign-at-add flow and given feedback
on the page layout you'd want.

---

## 5. Schedule a Trip — empty dropdown fixed + clearer guidance

**Bug you reported:** Schedule a Trip's "Existing installation" dropdown
was always empty. Customers had to switch to "Other Address" and lose
the connection to their account.

**Root cause:** The page was fetching from the wrong API endpoint. Now
fixed. Active installations and removal-scheduled installations show in
the dropdown (with "(removal scheduled)" suffix where applicable).

**Bonus copy fix:** When a customer has no completed installs but does
have a pending order, the modal now shows a yellow guidance box:

> *"If you have an order being installed in the next few days, switch
> to Other Address and reference the order in the notes — our crew will
> combine it with the install visit. To cancel or change a pending
> order, use Order History — removal service isn't applicable before
> install."*

Closes the "removal on a pending order" confusion from your video.

**Try it:** As the test account on the Service Requests page → click
Schedule a Trip. You should now see an installation in the dropdown.

---

## 6. The locked-in admin: `supportstaff@semonin.com`

We promoted `supportstaff@semonin.com` to Pink Posts admin role. They
now have full admin access (all customers, orders, billing). An audit
log row was written for the change so we have a record.

🛠 **Admin: change anyone's role from the UI.** On the admin customer
detail page → **Edit Info** → there's now a Role dropdown
(Customer / Team Admin / Admin). Promote/demote warnings show inline.
Safety: you can't demote the last remaining admin and you can't change
your own role from here.

---

## 7. The terms-page disclaimer for the $18 rental

We added an "**Effective June 10, 2026**" note next to the
$18-per-3-months extended-rental clause on the terms page. Orders
placed before that date aren't subject to the fee until then. This
closes the "we advertise it but don't charge it" gap you flagged in
the email — at least on paper. The actual extended-rental charge
mechanism still needs to be built; we'll spec that separately once
6/10 ships.

---

## What we deliberately deferred

Per the v2 plan's "first to cut if time is tight" guidance:

- **Cross-device shared cart** — see §3 above.
- **Per-agent collapsible inventory sections in admin** — would be a
  nice rearrangement of the admin inventory display, but Team Inventory
  on the customer side already gives you that view.
- **Bulk reassign UI** — endpoint is shipped; the checkbox + floating
  action UI is a follow-up.
- **Partial-refund support** — v1 is full-refund only. A partial refund
  through Stripe Dashboard is still recorded in our audit log, just
  doesn't flip the order's state.
- **Cross-device cart sync** — see §3.

Each of these is in the punchlist; happy to prioritize after you've
used the rest for a week.

---

## What to test before 6/10

Run through this checklist as the **test account** and as the **admin
account**:

1. **Place an order**, pay, see the confirmation email, then **Cancel**
   it from Order History. Refund email arrives at the test account
   (since you're the team admin for the test team).
2. **Place a $300+ order** and cancel — confirm the double-confirm
   modal fires.
3. **Try to cancel an order whose install date is tomorrow** — should
   show the 24h-cutoff message instead of a Cancel button.
4. **Place two orders in two tabs**, both trying to use the same
   stored sign — second tab should not be able to pick it.
5. **As Pink Posts admin**, add a sign to the test customer with
   "Assign to agent: Ashley Carter" — verify it shows up under Ashley
   in Team Inventory.
6. **As Pink Posts admin**, open a paid order → Refund Order → confirm.
7. **Refund an order via Stripe Dashboard directly** — verify the
   order in PP flips to "Cancelled — Refunded" and an email goes out.
8. **Schedule a Trip** — verify the dropdown shows the test team's
   active installations.

If anything's off, screenshot + send. We can react fast before 6/10.

---

A note on what's under the hood: we built a write-only audit log table
that records every refund, role change, admin cancel, inventory
reassignment, and inventory hold lifecycle event. If you ever need to
answer "what happened to this order / why is this sign unavailable,"
support can query it directly. No customer-facing surface yet but it's
there.

---

# Round 2 of follow-ups (your 6/3 notes)

Knocked out 6 of the 7 items you flagged in the meeting. The rural-area
surcharge is the one we held — see §15 for what we'd build there.

## 9. Search-as-you-type for the agent picker

You called out two places where the agent dropdown gets unwieldy on
large rosters. Both fixed:

- **Team Inventory page → Filter by agent.** Was a native dropdown,
  now a search input — type "ash" and the list narrows live. Keyboard:
  arrows + Enter to pick, Esc to close. Same component (`SearchableSelect`)
  also replaced the per-row "assign to" dropdown for consistency.
- **Place Order → "Who is this order for?"** Was a scrollable card
  list. Now there's a search box above with autofocus on the input —
  start typing immediately on landing. Enter picks the first match
  (so "ash" + Enter goes straight into Ashley's order flow). A small
  "3 of 24 agents" counter shows when the list is filtered.

## 10. Agent name no longer wraps in Team Inventory

The agent name on each inventory row was getting stacked on two lines
because the badge and the assign control were fighting for space in
the half-viewport grid. Dropped the redundant badge — the assign
control already shows the agent name, so removing the badge ditches
the duplication AND gives the row enough horizontal room. One-line on
all screen widths now.

## 11. Removed the duplicate "agent who sold this property" field

At checkout you were seeing the agent name input AGAIN even though
you'd already picked the agent at the start of the flow. Removed —
the value still travels through to the order; only the redundant
confirmation row is gone.

## 12. Edit button on each cart row

You can now click **Edit** on any cart row to re-enter the wizard
with that row's address, items, scheduling, etc. pre-filled. Make
changes, hit "Update cart item" on the review step, and you're back
on the cart with the row updated in place — not a duplicate.

The trickier bit under the hood: when you change which inventory you
picked (e.g. swap one sign for another), the system releases the old
hold and acquires the new one so nobody else's cart accidentally
grabs your stuff while you're editing. If the new pick is already in
someone else's cart, you get a clear conflict message and your
ORIGINAL picks stay reserved.

## 13. Quantity field for "Other" inventory

🛠 The Add Inventory modal's "Other" type now has a Quantity field
just like the other types. Adding 5 generic frame signs no longer
means five separate clicks.

## 14. Admin: per-agent inventory sections on a team_admin customer

🛠 This is the big one this round. The admin customer detail page
for a team_admin customer (like Semonin) now organizes inventory
into **collapsible sections per agent**:

```
[Other Items card — unchanged]

▼ Unassigned (3 signs · 1 rider · 0 lockboxes · 0 brochure boxes)
   Signs:
     ☐ "For Sale Sign"               [In storage] [🗑]
     ☐ "Coming Soon"                  [In storage] [🗑]
     ...
   Riders / Lockboxes / Brochure boxes lists

▶ Ashley Carter (4 signs · 2 riders · 1 lockbox)
▶ Marcus Bell (1 sign · 0 riders · 1 lockbox)
▶ Diana Reyes (0 signs · 1 rider · 0 lockboxes)
```

Each row has a checkbox. Select any number of items across any
sections → a sticky **"N items selected · Reassign to: \[Ashley ▾]
\[Apply] \[Clear]"** action bar appears at the bottom. Apply moves
them in one shot via the bulk-reassign endpoint.

Held items (in someone's active cart) refuse to reassign with a
clear "Release the hold first via Admin → Inventory Holds" message —
you can't accidentally steal inventory out of a team admin's
in-progress cart.

Non-team customers still see the old flat card grid; the new view
only activates when there's actually a team roster to group by.

## 15. Rural-area surcharge — research only

You said *"need to figure out a way to map a rural area coverage,
extra \$20 charge in extreme rural areas — not pushing this yet."*

We didn't build it; we figured out HOW to build it. The recommended
approach (~8h of work in a follow-up PR):

1. **Data source:** the USDA's free RUCA (Rural-Urban Commuting Area)
   ZIP-code classification. ~41k US ZIP codes labeled 1-10 by how
   rural they are; codes 8-10 = "Small Town Rural" or smaller. Import
   once into a small lookup table, no API calls at checkout time.
2. **Compute at address-entry**, not at final review. The fee shows
   up as a discrete line item ("Rural delivery fee — \$20") between
   subtotal and tax, with a tooltip explaining the drive-time
   rationale.
3. **Admin override on every order.** A "Waive rural fee" button on
   the admin order detail with a reason note — handles edge cases
   where the ZIP-level classification is wrong (e.g. a new
   subdivision that USDA's data hasn't caught up to yet).
4. **Ship behind a feature flag.** \`rural_surcharge_enabled=false\`
   by default. Dry-run against your last 90 days of orders first,
   spot-check ~20 KY ZIPs against Google drive time, then flip the
   flag.

Schema is one new table (`rural_zip(zip, ruca_code, is_surcharge)`)
plus three nullable columns on `orders` (amount, waived flag, reason).
Full design doc is at `docs/round3/r3-research.md` in the repo. Let
me know if you want me to schedule this — it's ready to start
whenever.

---

## Status going into 6/10

- ✅ Round 1 (everything from the Zoom): all 7 shipped, #4 cart
  storage deferred with rationale.
- ✅ Round 2 (your 6/3 notes): 6 of 7 shipped, #3 rural surcharge
  research-only with a clear path forward.
- All money-touching paths (refunds, checkout, holds) adversarially
  reviewed and the race bugs found are fixed.
- Typecheck is clean on the branch.

Ready to push to production after you walk through the test
checklist in §"What to test before 6/10" above.
