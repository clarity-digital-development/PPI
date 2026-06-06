Excellent. The pattern `/api/admin/promo-codes` + `/api/admin/promo-codes/[id]` confirms the API convention for collection + single-resource CRUD. Returning the analysis now.

---

# Explorer C — Admin Dashboard Pattern Map

## 1. Auth gate — CLIENT redirect (no server component)

Every admin page is a `'use client'` page. The gate lives **once** in `app/admin/layout.tsx:31-73`:

- Wraps all `/admin/*` routes
- On mount, calls `GET /api/profile`, checks `data.user?.role === 'admin'`, otherwise `router.push('/dashboard')` (`app/admin/layout.tsx:41-62`)
- Shows a spinner while role is null (`app/admin/layout.tsx:67-73`)
- **Important:** team_admin is NOT allowed into `/admin` — only Pink Posts internal admins. Comment at `app/admin/layout.tsx:44-45` makes this explicit.

Server-side, every API route re-gates with `getCurrentUser()` then `user.role !== 'admin'` → 403 (e.g. `app/api/admin/customers/[id]/route.ts:248-255, 345-353`). The helper `requireAdmin()` exists in `lib/auth-utils.ts:29-41` but admin routes generally inline the check to return JSON 403 instead of throwing.

## 2. Layout shell

`app/admin/layout.tsx:75-163` provides: dark sidebar (`bg-gray-900`, 256px, mobile-collapsible), nav array at `:22-29`, mobile header `:149-157`, page content `<main>` at `:160`. Page bodies use `<div className="p-6">` (see `app/admin/customers/[id]/page.tsx:450`).

**Add a nav entry for Service Areas:** insert at `app/admin/layout.tsx:28` between Inventory and Settings, e.g. `{ href: '/admin/service-areas', label: 'Service Areas', icon: MapPin }`.

## 3. Modal pattern

Single shared component: `Modal` from `@/components/ui` (`components/ui/modal.tsx`, exported via `components/ui/index.ts`). Used three ways on the customer page:
- Add form: `app/admin/customers/[id]/page.tsx:1125-1247`
- Edit form: `:1027-1086` (props `isOpen`, `onClose`, `title`)
- Delete confirm: **native `confirm()`** — `:185, :257, :1479`. No dedicated delete-confirm modal exists.

Form fields use `<Input label=... />` from `@/components/ui` (`:1034-1053`). Selects are raw `<select>` with Tailwind classes (`:1057-1065`). Buttons: `<Button>`, `<Button variant="outline">` (`:1077-1083`).

## 4. Audit constants

`lib/audit.ts:43-63` — `audit({actor, action, targetType, targetId, metadata, request})`, never throws (try/catch logs to stderr, `:55-62`). Constants at `lib/audit.ts:69-91`: `UserRoleChange`, `OrderCancel`, `OrderRefundCreate/Fail/Webhook`, `InventoryAssign`, `InventoryReassignBulk`, `CartCheckoutBegin/Succeed/Fail`, `InventoryHoldCreated/Released/Expired/Conflict/Consumed/Overridden`.

**No service-area actions exist yet.** Add to `lib/audit.ts:69-91` (format `<domain>.<verb>`, per comment `:66-68`):
```
ServiceCenterCreate / .Update / .Delete
ServiceAreaExemptToggle
ServiceAreaOutOfArea          (logged when blocked)
ServiceAreaSurcharge          (logged when $50 applied)
```

Example call site shape: `app/api/admin/customers/[id]/route.ts:312-321`.

## 5. Customer Edit modal — exact insertion point for `isServiceAreaExempt`

Field list lives at **`app/admin/customers/[id]/page.tsx:1033-1076`** inside `<Modal title="Edit Customer Info">`. The state shape is at `:80-92` (add `isServiceAreaExempt: boolean`), initial hydrate at `:113-119`, PUT body at `:134-140`. Insert the checkbox **between line 1076 (closing `</div>` after Role) and line 1077** (buttons row). Server side: extend the allowlist in `app/api/admin/customers/[id]/route.ts:258-264` (`if (body.is_service_area_exempt !== undefined) updateData.isServiceAreaExempt = body.is_service_area_exempt`) and emit `AuditAction.ServiceAreaExemptToggle` next to the existing role-change audit at `:312-321`.

## 6. Proposed paths for Service Areas

Matches existing `promo-codes` / `customers` collection+detail convention (`app/api/admin/promo-codes/route.ts` + `[id]/route.ts`):

- **UI list page:** `c:\Users\tanne\PPI\app\admin\service-areas\page.tsx` (list + Add modal)
- **UI detail (optional, only if per-center edit needs its own page; otherwise inline edit modal on list):** `c:\Users\tanne\PPI\app\admin\service-areas\[id]\page.tsx`
- **API collection:** `c:\Users\tanne\PPI\app\api\admin\service-areas\route.ts` — `GET` list, `POST` create
- **API resource:** `c:\Users\tanne\PPI\app\api\admin\service-areas\[id]\route.ts` — `GET`/`PUT`/`DELETE`
- **Public gate endpoint (used by order wizard server-side):** `c:\Users\tanne\PPI\app\api\service-areas\check\route.ts` — `POST {zip, userId?}` → `{tier, surcharge, phone}`. Mirrors the public-ish style of `app/api/profile`.
- **Nav entry:** add to `fullNavItems` at `app/admin/layout.tsx:22-29`.

Recommend inline Add/Edit modals on the list page (mirrors customer Edit modal pattern at `:1027-1086`) rather than a `[id]` detail page — 5 centers don't warrant a per-row page.