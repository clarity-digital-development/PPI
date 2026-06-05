All my route.ts errors cleared. The remaining errors are in the UI specialist's file (page.tsx) — not my scope. My PATCH route typechecks clean.

`C:\Users\tanne\PPI\app\api\profile\route.ts`

Summary:
- Extended GET to return `emailOrderConfirmations`, `emailServiceRequests`, `emailMarketing`, and `notificationPrefsUpdatedAt`. Added a new PATCH handler that Zod-validates a partial-prefs body, diffs against current values, persists changes with `notificationPrefsUpdatedAt = now()`, and writes a fire-and-forget `UserPreferenceChange` audit row (IP + UA captured, errors logged but never thrown).
- No-op detection short-circuits with `{ ok: true, noop: true, prefs }` so toggling a value back to its current state doesn't bloat the audit log. PUT path for fullName/phone/company is untouched. Typecheck passes for this file; remaining tsc errors are in the UI specialist's `app/dashboard/profile/page.tsx`.

Sample request:
```
PATCH /api/profile
Content-Type: application/json

{ "emailMarketing": false, "emailServiceRequests": false }
```

Sample response (change):
```
200 OK
{
  "ok": true,
  "prefs": {
    "emailOrderConfirmations": true,
    "emailServiceRequests": false,
    "emailMarketing": false,
    "notificationPrefsUpdatedAt": "2026-06-05T18:42:11.083Z"
  }
}
```

Sample response (no-op):
```
200 OK
{ "ok": true, "noop": true, "prefs": { "emailOrderConfirmations": true, "emailServiceRequests": false, "emailMarketing": false } }
```

Sample error responses: `401 {"error":"Unauthorized"}`, `400 {"error":"Validation failed","details":[...]}`, `400 {"error":"Invalid JSON body"}`, `400 {"error":"Validation failed",...}` (empty body — refine rule).