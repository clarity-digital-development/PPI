I have the full picture. Returning findings.

---

## Mapping: "Agent who sold this property" tag at checkout

### 1. Where the field renders on the Review step

**File: `components/order-flow/steps/review-step.tsx`, lines 1246-1264**

```tsx
{/* Team admin: ask which agent on the team sold this property... */}
{isTeamAdmin && !isEdit && (
  <div className="p-4 bg-pink-50 border border-pink-200 rounded-xl">
    <label className="block text-sm font-semibold text-pink-900 mb-1">
      Agent who sold this property
    </label>
    <input
      type="text"
      value={formData.placed_for_agent_name || ''}
      onChange={(e) => updateFormData({ placed_for_agent_name: e.target.value })}
      placeholder="e.g. Ashley Smith"
      ...
    />
    <p className="text-xs text-pink-700 mt-1">Optional — labels the order...</p>
  </div>
)}

```

Rendered only when `isTeamAdmin && !isEdit` (team_admin or internal admin, not in edit mode).

### 2. Editable input or display tag?
**Editable free-text input** (`<input type="text">`) bound to `formData.placed_for_agent_name`. Pre-populated by the agent picker but the user can still overwrite it.

### 3. Where the value originates earlier in the wizard

**File: `app/dashboard/place-order/page.tsx`, line 228**

When the team admin picks `selectedMember` on the "Who is this order for?" screen, the wizard is mounted with:
```tsx
initialFormData={{ placed_for_agent_name: selectedMember.name }}
```

The default in `components/order-flow/order-wizard.tsx:81` is `placed_for_agent_name: ''`, and `lib/orders/order-to-formdata.ts:306` also defaults it to `''` for edit mode. So in the place-order flow the field is already filled with the selected agent's name by the time the user reaches Review.

### 4. Downstream consumers (must preserve)

The value is read in three submit paths:
- **`handleAddToCart`** — line 496: `let agentName = formData.placed_for_agent_name?.trim() || ''` → written to `newItem.agentName` in cart localStorage.
- **`handleSubmit`** (POST `/api/orders`) — line 916: `placed_for_agent_name: formData.placed_for_agent_name?.trim() || undefined`.
- **Cart checkout** (`app/dashboard/cart/page.tsx:139`) → batch endpoint (`app/api/orders/batch/route.ts:241`) → DB column `placedForAgentName` (`prisma/schema.prisma:410`).
- Surfaced in UI: `components/dashboard/order-history-table.tsx:94,159` ("For: {name}") and `app/admin/orders/[id]/page.tsx:427-430` ("Sold by agent" banner).

The data must continue flowing — the field stays populated via `initialFormData` from the agent picker, so removing the UI alone does not break anything as long as the input element is gone but `formData.placed_for_agent_name` is still passed to the API. No submit-logic change required.

### 5. Proposed minimum diff

**Single deletion** in `components/order-flow/steps/review-step.tsx`, remove lines 1246-1264 (the entire `{isTeamAdmin && !isEdit && (<div className="p-4 bg-pink-50 ...">...</div>)}` block).

Nothing else changes:
- `handleSubmit` / `handleAddToCart` / batch endpoint still read `formData.placed_for_agent_name`.
- That value is already seeded by `place-order/page.tsx` line 228 from the picker.
- For the legacy admin "on behalf of" flow with no preset, `handleAddToCart` already has a fallback (lines 498-509) that hits `/api/admin/customers/${onBehalfOf}` for the full name. No regression there.

Optional follow-up (not required): drop the now-unused `isTeamAdmin` local on line 41 only if no other branch references it — `cartEnabled` on line 42 still uses it, so leave it.

**Risk:** zero — the input was the only writer the user could affect, and the value remains in `formData` from initialization. Field also won't appear in edit mode (it never did: gated by `!isEdit`).