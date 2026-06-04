No admin UI page exists for /admin/holds — it's API-only. Worth noting in the walkthrough so Ryan hits the JSON endpoint directly. I have enough; writing the audit.

---

## Admin features

**Audit verdict: ships as claimed, with two caveats** — (1) no admin UI page exists at `/admin/holds` (JSON endpoint only, surface this to Ryan); (2) the customer-detail Edit Info dialog also lets you change role from a customer detail page where the customer is on the supportstaff's own team — wired correctly because the route's `PUT` re-gates to `user.role === 'admin'` so a team_admin gets a 403.

### Code-confirmation notes (what matches the changelog)

- **Role-change PUT** — `app/api/admin/customers/[id]/route.ts:266-305` accepts `body.role`, validates against `ALLOWED_ROLES = ['customer','admin','team_admin']`, blocks self-change (`id === user.id`), blocks last-admin demotion via `prisma.user.count({where:{role:'admin', id:{not:id}}})`, and writes `AuditAction.UserRoleChange` with `{from, to}` metadata only when role actually changes.
- **Role-change UI** — `app/admin/customers/[id]/page.tsx:1006-1027` Edit Info modal Role `<select>` with three options + amber promotion/demotion warning copy. `handleSaveCustomer` (L126) PUTs with `body.role` and surfaces server `err.error` via `alert()` on non-2xx.
- **Sidebar gating** — `components/dashboard/sidebar.tsx:108` keys on `role === 'team_admin'` (not `teamId`). "Team Inventory" relabel at L113, "My Team" appended to account nav at L122.
- **Per-agent grouped view** — `app/admin/customers/[id]/page.tsx:352-388` `grouped` memo buckets per-row in-storage items by `assignedToMemberId` (null → `unassigned`). Pre-seeds an empty bucket for each team member so accordions render even when empty. `useGroupedView` enables when `data.team.members.length > 0` (i.e., any team member, but the team is only loaded for users where `customer.teamId` is set — see route L159).
- **Add-inventory assign dropdown** — `app/admin/customers/[id]/page.tsx:1169-1190` renders the "Assign to agent" `<select>` only when `addType !== 'other' && data.team && data.team.members.length > 0`. Forwarded as `assigned_to_member_id` on POST (L222-224). API at `app/api/admin/customers/[id]/inventory/route.ts:30-35` coerces empty string to `null` and writes `assignedToMemberId` on sign / rider / lockbox / brochure_box rows. `'other'` table has no `assignedToMemberId` column — UI correctly hides the dropdown.
- **Quantity for `other`** — `page.tsx:1160-1168` renders the Quantity input for every `addType`, including `'other'`. API at `inventory/route.ts:157-170` uses `createMany` when `quantity > 1` — verified loops over `Array.from({length: quantity})`.
- **Sticky bulk action bar** — `page.tsx:831-858` `fixed bottom-4 left-1/2 -translate-x-1/2 z-40` bar renders when `useGroupedView && selectedItems.size > 0 && data.team`. Reassign target `<select>` includes "Unassigned (team pool)" + every member. POSTs to `/api/admin/customers/[id]/inventory/bulk-reassign`.
- **Bulk reassign live-hold refusal** — `bulk-reassign/route.ts:88-116` pre-checks `heldByHoldId != null AND heldUntil > now` for sign/rider/lockbox buckets, returns 409 `{error, code:'items_held', held:[...]}`. UI at `page.tsx:318-322` catches 409+items_held and shows the "Release the hold first via Admin → Inventory Holds, then try again" alert. Successful reassign writes `AuditAction.InventoryReassignBulk` with per-type counts.
- **Bulk reassign cross-team guard** — `bulk-reassign/route.ts:53-74` confirms `targetMemberId` belongs to `customer.teamId` and isn't a removed member — refuses with 400 otherwise. Scopes every `updateMany` to `userId === customerId` so a malformed payload can't touch another customer's inventory.
- **/api/admin/holds GET** — `route.ts:5-109` admin-only, returns active (non-consumed, non-released) holds with owner email/name, actor email, onBehalfOf email, item description (resolved per sign/rider/lockbox), cart linkage, expires_at, age, and assignedToMemberId snapshot. Sorted by `expiresAt asc`.
- **/api/admin/holds/[id] DELETE** — `route.ts:1-48` admin-only, delegates to `overrideHold()` helper for audit + release with optional `body.reason`. Returns `{released:true}` or 404 `{released:false}`.

### Mismatches / heads-ups

1. **No admin UI page at `/admin/holds`** — only the JSON endpoint exists. The bulk-reassign error message tells the admin to "release via Admin → Inventory Holds" but there's no page to click to. Ryan will need to use `curl` or hit the URL in the browser and see JSON. (Or we ship a page — separate work.)
2. The role-select Edit modal allows a team_admin who somehow reaches `/admin/customers/[id]` to *attempt* a role change, but the route correctly returns 403. The UI doesn't pre-hide the Role field for team_admin viewers; not a security issue but slight UX wart. Out of scope for this audit.
3. The bulk-reassign 409 error UI uses `alert()` not a toast — functional, but unpolished. Pre-existing pattern across this page.

---

### Ryan walkthrough — Admin features

Log in as `admin@pinkposts.com` / `admin123`.

**1. Confirm admin nav shell**
- After login, sidebar should show: Dashboard, Customers, Orders, Installations, Inventory, Promos, etc. — the full admin nav.
- *If you see customer-only nav (Dashboard / Schedule a Trip / My Inventory / Cart)*: you are NOT logged in as platform admin. Log out and re-log with `admin@pinkposts.com`.

**2. Verify supportstaff@semonin.com is Team Admin on Peggy Heckert Team**
- Go to `/admin/customers`, search "supportstaff", click the row.
- Header should show **`Support Staff` · Team Admin badge (blue)** and below: `supportstaff@semonin.com`.
- "Team Members" card should show `Peggy Heckert Team (Semonin Realtors)` and list Peggy + any other members.
- Click "Edit Info" → Role dropdown should be set to `Team Admin (brokerage)`.
- *If badge says "Admin" (purple) or role is "Customer"*: the demotion didn't take. Re-run the role-change.

**3. Verify pheckert@semonin.com is Customer with no team / no inventory**
- Go to `/admin/customers`, search "pheckert", click the row.
- No role badge in header (plain customer). No "Team Members" card. Inventory cards all empty.
- *If team shows "Peggy Heckert Team" or any inventory rows exist*: demotion left orphan data.

**4. Add a sign for the test team admin pre-assigned to Ashley**
- `/admin/customers` → search "test@pinkposts.com" → click row.
- You should land in the **grouped view** (per-agent collapsible sections, not the 2-column inventory grid). At the top: an Unassigned section + a section for each team member (Ashley / Marcus / Diana).
- Click the "Add inventory: Sign" button row near the top.
- In modal: type description "Ryan audit test sign", set Quantity 1, **"Assign to agent" dropdown → Ashley**. Click Add.
- The Ashley accordion's badge count should go up by 1. Expand it → see "Ryan audit test sign" under Signs.
- *If the new sign lands under Unassigned instead*: `assigned_to_member_id` is not being forwarded (suspect form state).
- *If you see no "Assign to agent" dropdown*: the team didn't load. Refresh.

**5. Per-agent collapsible sections render correctly**
- Same page as step 4. Each agent (Ashley, Marcus, Diana) has its own card with:
  - Title (member name) + Sublabel (email, if any) + total-count Badge.
  - Summary text like "3 signs · 2 riders".
  - Click to expand → see Signs / Riders / Lockboxes / Brochure Boxes sub-lists with checkboxes.
- "Unassigned (team pool — not yet assigned to any agent)" defaults to open.
- "Other" is rendered as a separate, non-grouped card above (other items have no agent assignment).
- *If you see two side-by-side "Signs in Storage" / "Riders in Storage" cards instead of the grouped accordions*: `useGroupedView` evaluated false — the customer has no team members.

**6. Sticky bulk-reassign across multiple agents**
- Expand Ashley → check 1 sign. Expand Marcus → check 1 rider. Expand Unassigned → check 1 lockbox.
- A **sticky pink-bordered bar** should appear pinned to the bottom center: "3 items selected · Reassign to: [dropdown] · Apply · Clear".
- Dropdown set to "Marcus" → Apply.
- Bar disappears. Page refreshes. All 3 items should now be inside Marcus's accordion (expand to confirm).
- *If you see "Failed to reassign items"*: check the network tab — likely a 400 ("Target agent not found on this team") which would mean Marcus's member id was stale.

**7. Bulk-reassign refuses items in a live cart**
- Open a second tab as the team_admin customer (`test@pinkposts.com` / `PinkPosts2026`). Start a Schedule a Trip flow, get to Step 2 (sign selection), add 1 sign to the order/cart — that creates a hold on that sign.
- Back in the admin tab on the customer detail page, find that specific sign (it'll be under whichever agent owns it), check its checkbox, choose any reassign target, click Apply.
- Expect an alert: **"One or more selected items are in an active cart. Release the hold first via Admin → Inventory Holds, then try again."** (Network response should be 409 with `code: "items_held"`.)
- *If the reassign succeeds anyway*: the live-hold pre-check is broken — that'd be a regression.
- To clear the hold: visit `GET /api/admin/holds` directly in the browser (you'll see raw JSON), grab the `id` of the matching hold, then `DELETE /api/admin/holds/<id>` (use a REST client or `curl`). There is **no admin UI page** at `/admin/holds` yet — JSON endpoint only. Reassign should now succeed.

**8. Add "Other" inventory with quantity 5**
- Same customer detail page. In the "Other" card, click "+ Add".
- Modal title: "Add Other Item". Description: "Yard flag stake", Quantity: 5.
- Notice there is **no "Assign to agent" dropdown** for Other — correct (no agent column on that table).
- Click Add. The Other card should now show "Yard flag stake ×5" on a single grouped row (the GET groups duplicate descriptions).
- Hover the trash icon → tooltip "Removes one of these items". Click → count drops to ×4.
- *If only one item appears or you see ×1*: `createMany` loop is broken.

**9. View live holds via API**
- Have the test team_admin still hold a cart item from step 7 (or add a fresh one).
- Visit `https://<host>/api/admin/holds` directly in the browser while logged in as admin.
- Response JSON: `{holds: [{id, itemType, itemId, itemDescription, ownerEmail: "test@pinkposts.com", actorEmail, cartSessionId, cartItemId, expiresAt, ageSeconds, ...}]}`.
- *If 401/403*: you're not logged in as platform admin.
- *If empty `holds: []` when a cart item exists*: the hold wasn't written (cart-add path bug — not an admin-feature regression).

**10. Role-change safety rails**
- Open the admin's own customer detail (`/admin/customers/<your-own-id>`) → Edit Info → try to change Role to anything else → Save. Expect alert "Cannot change your own role" (400 from server).
- Open another admin user (if one exists) → Edit Info → try to demote → if they are the *last other* admin, expect "Cannot demote the last remaining admin. Promote another user to admin first."
- Any successful role change writes to `audit_log` with action `user.role_change` and `{from, to, email}` metadata — check via DB or `/api/admin/audit-log` if exposed.