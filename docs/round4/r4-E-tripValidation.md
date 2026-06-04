Clean typecheck.

**File:** `c:\Users\tanne\PPI\components\dashboard\installation-modals\ScheduleTripModal.tsx`

Removed the "select at least one item" validation so customers can submit pickup-only/general service trips; description and notes now switch to a "no items specified" message when both checkboxes are blank, the trip-fee notice copy was broadened, and the "What would you like to add?" section is now explicitly labeled Optional with helper text. Verified both `/api/installations/[id]/service-request` (requires only `type`) and `/api/service-requests` (requires `type`+`description`, both always sent) accept the new payload; `npx tsc --noEmit` passes clean.