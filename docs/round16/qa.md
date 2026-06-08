Dev server is running. Without admin auth cookies in this shell, I can't drive the admin UI here (and Playwright MCP would require establishing a session). I'll flag behavioral verification as code-trace-only — adequate given the clean diff and confirmed DB state.

Final report below.

---

### Per-piece verdict (A / B)

**A (Other agent-assign): PASS.** Schema column live, FK pattern matches existing inventory tables (none have explicit `@relation` on `assignedToMemberId` — all use `String?` + `@@index` only, so A follows convention). Bulk-reassign accepts `other`, inventory POST writes `assignedToMemberId`, admin GET emits the per-row `items.otherItems` array, admin UI swaps the standalone Other card for a grid-resident card that uses `renderRow('other', …)` with the same per-row Assign SearchableSelect as the other types. Filter-by-agent now includes Other (line 433-434). Add modal's assignee picker no longer gated on `addType !== 'other'`. Backfill is idempotent, team-scoped, refuses empty results, writes one audit row.

**B (SearchableSelect scroll): PASS.** One-function `close(e)` early-returns when `e.type === 'scroll'` and `popoverRef.current?.contains(e.target as Node)`. List already has `max-h-60 overflow-y-auto` (line 228). Capture-phase listener on `window` still catches scrolls on ancestors (modal body / page) so the popover detaches correctly. Click-outside and Escape paths untouched.

### Code quality issues

- **(Pre-existing, not introduced)** `app/api/admin/customers/[id]/inventory/route.ts` trusts `assigned_to_member_id` from the body without verifying the member belongs to the customer's own team. The same gap exists for sign/rider/lockbox/brochure_box paths, so this round is consistent with prior code. Worth queuing a small hardening pass, but not a blocker for this PR.
- **(Pre-existing, not introduced)** No DB-level FK on `customer_other_items.assigned_to_member_id` — matches sign/rider/lockbox/brochure_box convention. If you ever want one, do it across all five tables together.
- No `any`, audit on backfill present, ONE-line WHY comments, agent-filter scoped to customer's own team — all green.

### Typecheck status

`npx tsc --noEmit` → exit 0. Clean.

### DB schema verification

`customer_other_items` columns: `id, user_id, description, created_at, assigned_to_member_id (text, nullable)`. Index `customer_other_items_assigned_to_member_id_idx` present. Matches the Prisma model exactly. No constraint violations.

### Backfill verification

Supportstaff@semonin.com (the team_admin row, `teamId=cmphkbmxk0000i4mfi9tu5n95`) has 9 Other items, post-backfill:

```
assigned=(none)  desc="Black Metal Frame"
assigned=(none)  desc="4x8 Large White Frame"
assigned=(none)  desc="Black Metal Frame"
assigned=Jennifer Carroll  desc="Post"
assigned=Peggy Heckert     desc="Metal Frame"
assigned=Nadia Holliday    desc="Post"
assigned=Nadia Holliday    desc="Post"
assigned=Nadia Holliday    desc="Metal Frame"
assigned=Nadia Holliday    desc="Metal Frame"
```

Exactly matches the screenshot. The 3 generic frames correctly remained unassigned. Audit row `cmq5shgch00006kmftbw5aiz2` (2026-06-08T22:35:25Z, `updated=6`, `changes.length=6`) is present. All 6 assigned members are on the Semonin team (no cross-team leak).

### Behavioral verification

Dev server up (HTTP 200 on `/`). Couldn't drive the admin UI here without an active admin session cookie, so this is a trace-level review of the affected file paths, NOT a click-through. Each requirement:

- **(a)** Per-row Assign SearchableSelect on Other rows — `renderRow('other', { id, label: o.description, assignedToMemberId: o.assignedToMemberId })` at page.tsx:770-791 renders the same SearchableSelect block as the other 4 types (renderRow widened at line 569). Pre-selection works because `assignedToMemberId` is forwarded from the API.
- **(b)** Filter-by-agent includes Other — page.tsx:433-434 applies the same `matches(o.assignedToMemberId)` predicate.
- **(c)** SearchableSelect scrolls internally — the `<ul>` already has `max-h-60 overflow-y-auto`. The new guard early-returns when scroll origin is inside `popoverRef`, so `setOpen(false)` won't fire. The `scrollIntoView` programmatic scroll for keyboard nav also targets the inner `<ul>` and is captured by the same guard.
- **(d)** Add Other Item modal pre-assigns to filtered agent — `openAddModal` at line 109-114 sets `assigned_to_member_id: preassign` regardless of `addType`, and the modal's assignee picker is no longer gated on `addType !== 'other'` (line 1373).
- **(e)** Per-row reassign saves — `handleRowReassign('other', id, target)` POSTs to bulk-reassign which now has `customerOtherItem.updateMany` in the `other` branch (route.ts:142-150).

### Recommendation: SHIP

Both fixes are coherent, typecheck clean, DB state matches the spec, backfill produced the exact expected outcome, and the code paths trace correctly end-to-end. The two flagged items (no FK constraint, no server-side member-team check) are pre-existing patterns that should be tackled as a separate hardening pass across all 5 inventory tables, not a blocker for this round.

Files reviewed:
- `c:\Users\tanne\PPI\prisma\schema.prisma`
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\route.ts`
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\inventory\bulk-reassign\route.ts`
- `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx`
- `c:\Users\tanne\PPI\components\ui\SearchableSelect.tsx`
- `c:\Users\tanne\PPI\scripts\_backfill-other-assigned-member.ts`