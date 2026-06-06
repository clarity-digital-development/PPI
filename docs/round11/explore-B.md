## Explorer B Report — `/admin/customers` list page

### 1. Current list state
File: `C:\Users\tanne\PPI\app\admin\customers\page.tsx` (client component, 182 lines).

- **Search**: free-text input, debounced 300ms, sent as `?search=` URL param to API. Local React state only — no URL sync.
- **Filters**: none. No role filter, no status filter, no team filter.
- **Sort**: none (server hardcodes `orderBy: { createdAt: 'desc' }`).
- **Pagination**: none in UI. API accepts `limit` (default 500) + `offset` but the page never sends them. Header shows `Showing N of total` only when truncated.
- **URL state**: none — pure local `useState`. Refresh wipes search.

### 2. Role distribution in live DB
Query: `prisma.user.groupBy({ by: ['role'], _count: { role: true } })`.

```
customer:    96
team_admin:   2
admin:        1
```

Filter is needed in **principle** (Tanner is scaling to many team admins), but in the current seeded DB only 2 team_admins exist, so the value today is mostly future-proofing + a way to quickly answer "who are my team admins?" without scanning the badge column.

### 3. Existing filter UI patterns
Two patterns live in `/admin`:

- **Pink pill button group** (`app/admin/inventory/page.tsx` lines 170-184). Simple `<button>` array, active = `bg-pink-500 text-white`, inactive = `bg-gray-100 text-gray-600 hover:bg-gray-200`. Map over a const tuple. This is the closest, lightest match.
- **Stat cards as filters** (`app/admin/service-requests/page.tsx` lines 229-285). Cards with counts; active = `ring-2 ring-pink-500`. Heavier — better when each filter shows a count metric.

Recommend **mirroring the inventory pill pattern** — same page genre (list + search), already familiar visually, minimal code.

### 4. Implementation surface

**JSX location**: insert a `<div className="flex gap-2">` pill row in the header block between lines 64 and 65 (right under the title text, above/beside the search input), OR add a second row beneath the existing header flex container (line 76). The second-row approach keeps the search input full-width on mobile.

**Server vs client filter — recommend server-side**:

- API already filters by role (`route.ts` lines 25-28). Adding `?role=team_admin` is a 3-line change to the existing `roleScope` logic: read `searchParams.get('role')`, and when present + user is internal admin, narrow `roleScope.role` to that single value.
- Server-side keeps `total` count honest (header already displays it).
- Aligns with the existing `?search=` pattern — symmetric, debounced effect already re-fetches on dep change.
- Pagination is the looming scaling concern (limit 500). Filtering client-side would silently break once team_admin count exceeds the page slice.

**Three pills**: `All` / `Customers` / `Team Admins`. State: `const [roleFilter, setRoleFilter] = useState<'' | 'customer' | 'team_admin'>('')`. Add to `useEffect` deps + `URLSearchParams`.

**Auth note**: the `roleScope` logic in `route.ts` lines 25-28 already prevents team_admins from seeing other team_admins — the role filter must only apply when `user.role === 'admin'`. Easy: only honor `?role=` inside the internal-admin branch.

**Files to touch**:
- `C:\Users\tanne\PPI\app\admin\customers\page.tsx` — add pill row + state + URLSearchParams entry.
- `C:\Users\tanne\PPI\app\api\admin\customers\route.ts` — read `role` param, narrow `roleScope` in the internal-admin branch only.

No new components needed.