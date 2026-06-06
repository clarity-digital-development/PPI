Pre-existing error, unrelated to my work. My changes compile cleanly.

Note: there are also modified files (`app/admin/customers/[id]/page.tsx`) from other specialists' parallel work in the working tree — not mine.

---

**Summary**

Files touched:
- `C:\Users\tanne\PPI\app\api\admin\customers\route.ts:17-37` — accept `?role=customer|team_admin` query param. Honored only when caller is internal admin (team_admin scope still locked to their team + `role: 'customer'`). Invalid/missing values fall back to current `in: ['customer','team_admin']` behavior. No DB-shape change.
- `C:\Users\tanne\PPI\app\admin\customers\page.tsx:1-15` — added `useRouter` / `useSearchParams` imports, `RoleFilter` type, and `ROLE_PILLS` constant array `[All, Brokers (team_admin), Customers (customer)]` per spec.
- `C:\Users\tanne\PPI\app\admin\customers\page.tsx:31-72` — hydrate `roleFilter` state from `?role=` on mount, added `selectRole()` helper that uses `router.replace(..., { scroll: false })` to push state to URL, and added `roleFilter` to the fetch effect's deps + query params.
- `C:\Users\tanne\PPI\app\admin\customers\page.tsx:99-114` — pill row inserted between header block and table. Mirrors `app/admin/inventory/page.tsx:170-184` styling exactly (`bg-pink-500 text-white` active / `bg-gray-100 text-gray-600` idle, `rounded-lg`, `px-3 py-2`).

TypeScript: `npx tsc --noEmit` clean for these files (the one error in `scripts/_adjust-service-centers.ts` is pre-existing and unrelated).

Sample URL states:
- `/admin/customers` — All (no param)
- `/admin/customers?role=team_admin` — Brokers
- `/admin/customers?role=customer` — Customers
- `/admin/customers?search=acme&role=team_admin` — Brokers matching "acme"

Behavior:
- Pill click → `router.replace` (no scroll, no history spam) + state update → effect refetches with `?role=` appended.
- Reload / share link → `initialRole` reads `searchParams.get('role')`, validates against the union, hydrates state.
- API guards: if a `team_admin` user crafts `?role=team_admin`, the param is ignored (`isInternalAdmin` gate at route.ts:25). Their scope stays `role: 'customer', teamId: ...`. No leak.
- Search param coexists; `search` + `role` combine into the same `URLSearchParams` and stay in sync.

Per design: agents pill skipped (agents are `TeamMember` rows, not `User` rows), admin pill skipped (count too tiny to warrant a tab).