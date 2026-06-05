TypeScript compiles clean with zero errors. The rewrite is complete.

C:\Users\tanne\PPI\app\dashboard\profile\page.tsx

Rewrote the Notification Preferences card with controlled checkboxes hydrated from `GET /api/profile`, save-on-toggle via `PATCH /api/profile` with optimistic update + rollback on failure, per-row in-flight guard (ignores double-clicks), inline auto-dismissing success/error banner (codebase uses no toast lib), and a disabled "Coming soon" SMS row. Profile-info card untouched; `npx tsc --noEmit` passes clean.