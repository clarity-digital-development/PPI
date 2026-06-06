Specialist 1 has already landed the schema, audit constants, and the Prisma client is up to date — `tsc --noEmit` returns 0. All deliverables are complete and type-check clean.

---

## Files created / modified

**Created:**
- `c:\Users\tanne\PPI\app\api\admin\service-centers\route.ts` — admin-only `GET` list (active+inactive, sorted active-first then name) and `POST` create. Zod-validated, surfaces a 409 on the `name @unique` clash, rejects `surchargeMinutes <= standardMinutes`, audits `ServiceCenterCreate`.
- `c:\Users\tanne\PPI\app\api\admin\service-centers\[id]\route.ts` — admin-only `GET`/`PATCH`/`DELETE`. PATCH is partial, re-validates the band ordering against current values when only one band is sent, handles rename collisions, and audits `ServiceCenterUpdate` with a per-field `{from,to}` diff (skips when nothing actually changed; normalizes Prisma `Decimal` via `String()` for stable comparison). DELETE is a soft-delete (`isActive=false`), idempotent if already inactive, and audits `ServiceCenterDelete`.
- `c:\Users\tanne\PPI\app\admin\service-areas\page.tsx` — client page, mirrors the existing customer-page Modal/Input patterns. Table with Name / Location / Standard ≤ / Surcharge ≤ / Fee / Phone / Status / actions. "Add Service Center" opens an empty modal; Edit pre-fills from the row. Form has client-side validation (5-digit ZIP, lat/lng bounds, integer minutes, surcharge > standard), collects the fee in dollars and converts to cents on submit, and includes a helper note telling admin to right-click in Google Maps to copy coordinates. Deactivate uses `confirm()`; inactive rows get a "Reactivate" button that `PATCH`es `isActive:true`. Empty-state copy warns about fail-open behavior with zero centers.

**Modified:**
- `c:\Users\tanne\PPI\app\admin\layout.tsx` — imports `MapPin`, inserts `{ href: '/admin/service-areas', label: 'Service Areas', icon: MapPin }` between Inventory and Settings (per spec).
- `c:\Users\tanne\PPI\app\api\admin\customers\[id]\route.ts` — GET now returns `is_service_area_exempt` so the modal pre-fills. PUT accepts `body.is_service_area_exempt`, compares against current to avoid no-op audit rows, and emits `AuditAction.UserExemptToggle` with `{from,to}` when it actually flips.
- `c:\Users\tanne\PPI\app\admin\customers\[id]\page.tsx` — extends `CustomerData.customer` and the `editData` state with `is_service_area_exempt`, hydrates from the GET payload, includes it in the PUT body, and renders a labeled checkbox in the Edit modal between the role block and the Cancel/Save row, with helper copy noting that `team_admin` accounts are auto-exempt.

**Verification:** `npx tsc --noEmit` → exit 0.