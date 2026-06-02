# Pink Posts — Follow-up to our Zoom call

Hi Ryan, here's a rundown of everything we built from your notes,
where to find each item, and how to try it yourself. Nothing here is final until
you've kicked the tires, so please test away.

---

## 🔑 Your test account (already loaded with data)

We created a **test "team" account** so you can try the new team features without
touching real customer data. It comes pre-loaded with a team, agents, inventory,
orders, and a service request.

> **Login:** `test@pinkposts.com`
> **Password:** `PinkPosts2026`

What's already in it:
- **Team:** "Ryan's Test Team"
- **3 agents:** Ashley Carter, Marcus Bell, Diana Reyes
- **Inventory:** 4 signs (3 already assigned to agents, 1 unassigned), riders, a lockbox, a brochure box
- **3 orders:** attributed to agents (2 you can still edit, 1 completed)
- **1 service request** (pending)

For the **admin-side** items (marked 🛠 below), log in with your Pink Posts
**admin** account instead.

---

## 1. Edit an order — now the full order form

**What changed:** When you edit an order it now walks through the **same
page-by-page screens you use to place an order** (property → post → sign →
riders → second post → lockbox → brochure → scheduling → review), instead of the
old stripped-down edit page. You can correct *anything*.

**Try it:** Order History → open one of the editable orders (the *pending* or
*confirmed* one) → **Edit**. Step through the pages, change the post or sign or
date, and **Save Changes** on the last page. It jumps you back to the order with
your changes applied.

**Good to know:** Editing updates the order and its total but does **not** auto
re-charge the card — your team reconciles any difference, and a note on the
screen says so.

---

## 2. Quick fixes you reported

- **Brochure box** now correctly says **"includes $3 install fee"** everywhere
  (it used to say $2).
- **"Sentrilock" is now "Sentrilock/Supra"** everywhere you pick a lockbox.
- **Renting a mechanical lockbox** now has a **lockbox-code field** (like the
  other lockbox options).
- **Same-day / expedited:** the **Continue button is no longer grayed out**, and
  the note now reads *"Please contact 859-395-8188 to notify of the rush
  installation. We'll confirm if same-day service is possible. If it's not
  possible, the expedite fee will be refunded."*
  **Try it:** Place Order → Scheduling step → pick "Same day."
- **Dashboard cards are clickable** — "Active Posts" / "Pending Orders" go to
  Order History, "Scheduled Removals" to Service Requests, "This Month" to
  Billing.
- 🛠 **Admin → Orders** now **paginates** (25 per page) instead of cutting off.
- 🛠 **Admin → a customer's profile:** the **Riders** list scrolls once it has 5+,
  and the **recent order numbers are clickable** links to that order.

---

## 3. Cart improvements (team / multi-order checkout)

**What changed:** When you're building a batch of orders in the cart:
- Each order has a **Remove** button to delete just that one.
- A **"Next order" / "Add another order"** button to keep adding to the batch.
- The **card is entered only on the cart screen** now (we removed the duplicate
  payment step from inside the order form), and it's a **single combined charge**.

**Try it:** As the test account, place an order for an agent and choose **"Add to
Cart"** on the review screen, then go to **Cart** (top bar) — you'll see Remove,
Next order, and the one-time payment.

---

## 4. Service requests

- 🛠 **Admin → Service Requests → open one → "Send invoice":** enter any amount and
  it charges the customer's saved card on file (since service trips aren't always
  $40). It records the charge and marks it paid.
- 🛠 **Admin** can now also set a request's **status directly** from a dropdown.
- **Customers can edit or cancel their own active requests.**
  **Try it (as the test account):** Service Requests → on the pending request use
  **Edit** (change date/notes) or **Cancel request**.

---

## 5. Teams — the big one 🆕

Team accounts (like a brokerage that places orders for its agents) can now manage
their roster, inventory, and orders by agent. All of this is on the **test
account**.

### a) "My Team" page
Left sidebar → **My Team**. Create/rename your team and **add, edit, or remove
agents**. (Your test team already has Ashley, Marcus, and Diana.)

### b) "Team Inventory" (renamed from "My Inventory")
Left sidebar → **Team Inventory**. You'll see a **"Filter by agent"** dropdown and,
on each item, a small selector to **assign that sign/rider/lockbox to a specific
agent**. Assigned items move into that agent's pile.
**Try it:** Filter by "Ashley Carter" to see only her items, or assign the
"Generic Open House Sign" to an agent.

### c) Placing an order — pick the agent first
**Place Order** now starts by asking **"Who is this order for?"** Pick an agent
and the order form loads **that agent's assigned inventory** and tags the order
with their name. ("Change agent" lets you switch.)
**Try it:** Place Order → choose **Ashley Carter** → on the Sign step you'll only
see *her* assigned signs.

### d) Filter your lists by agent
**Order History** and **Service Requests** now have a **"Filter by agent"**
dropdown for team accounts, and each row shows **which agent** it's for.
**Try it:** Order History → filter by "Ashley Carter" → you'll see her 2 orders.

### e) 🛠 Admin view of teams
In the **admin** area, team accounts now show a **"Team Admin" badge** in the
customers list, and opening their profile shows their **team roster** with an
**"Add Member"** button (members you add show up on their My Team page too).

---

## A couple of notes

- **Payments:** Editing an order or "sending an invoice" uses the card already on
  file — we didn't change how cards are stored. The test account has no saved
  card, so an invoice attempt will say "no card on file" (that's expected; it
  confirms the safeguard works).
- **Agents** currently start as **name-only** records (no separate login). They
  can be upgraded to full logins later if you want — just say the word.
- Everything was tested end-to-end before handoff, and the existing customer
  ordering flow is unchanged.

Let me know what feels right and what you'd like adjusted!
