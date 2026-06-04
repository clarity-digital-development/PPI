Ignoring TodoWrite. Typecheck passed cleanly. All changes complete.

## Summary

**Feature**: Renamed "At Property" rider source to "Pickup/At property" and added a custom free-text rider input so agents can name riders not in the standard catalog (e.g. "Love It/Buy It", "Walk/Don't Run", "Name Riders").

**Files modified**:

- `c:\Users\tanne\PPI\components\order-flow\RiderSelector\components\RiderSourceToggle.tsx` — label "At Property" → "Pickup/At property"
- `c:\Users\tanne\PPI\components\order-flow\RiderSelector\hooks\useRiderSelection.ts` — new `addCustomTextRider(name)` action that mints a unique synthetic `custom-text-<timestamp>-<rand>` riderId and stores the typed name in `customValue`
- `c:\Users\tanne\PPI\components\order-flow\RiderSelector\RiderSelector.tsx` — new input-plus-Add-button UI shown only when source === 'at_property', placed directly below the source toggle; supports Enter-to-add
- `c:\Users\tanne\PPI\components\order-flow\RiderSelector\components\SelectedRidersList.tsx` — recognises custom-text riders and shows the typed name as the chip label; source label now reads "Pickup" for at_property (instead of "Own")
- `c:\Users\tanne\PPI\components\order-flow\steps\rider-step.tsx` — `toSelectedRider` round-trips custom-text riders instead of dropping them
- `c:\Users\tanne\PPI\components\order-flow\steps\second-post-step.tsx` — same round-trip fix for the second-post rider sub-selector
- `c:\Users\tanne\PPI\components\order-flow\steps\review-step.tsx` — both order-item builders emit `Rider Install: Custom: <name> (pickup)` for custom-text riders, and `(pickup)` instead of `(at property)` for the at-property suffix in general (review summary AND buildItems for create/edit/cart; second-post variant updated too). This description flows through to admin order detail and confirmation emails which both render `item.description` verbatim
- `c:\Users\tanne\PPI\lib\orders\order-to-formdata.ts` — `parseMainRider` and `parseSecondPostRider` now accept both `(pickup)` (new) and `(at property)` (legacy) suffixes, and parse `Custom: <name>` bodies back into a synthetic custom-text RiderSelection so edits round-trip the agent's typed name

**Schema/data notes**: No schema changes needed — `OrderItem.custom_value` was already there and is what carries the typed name through to the server. `RiderSelection.rider_type` carries the synthetic `custom-text-*` id; the API/Prisma layer never inspects it, only persists the description + custom_value.

**Typecheck**: `npx tsc --noEmit` runs clean (0 errors).