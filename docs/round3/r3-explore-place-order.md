No Combobox primitive exists. AddressAutocomplete is a different beast (Google Places). Confirmed the agent picker is the team-admin gate at lines 233-278 — already a list of `<Card>`s (not a Select), but with no filter input.

# Place Order Agent Picker — Map

## 1. Where the agent is selected
`app/dashboard/place-order/page.tsx:233-278` — the team-admin gate ("Who is this order for?"). Selection handler `handleSelectMember` at line 156.

## 2. Component used
Already a list of clickable `<Card variant="interactive">` rows (line 253-275), one per `TeamMember`, each rendering name + email + a "Select" button. So **not a `<select>` dropdown** — Ryan's "agent picker is also a dropdown" complaint likely refers to the **on-behalf-of admin flow** (separate, uses `?on_behalf_of=` param via admin customers list — out of scope for this picker) OR to the unfiltered card list growing unmanageably long with a large roster. Treating it as the latter: there's no search/filter input, so a 40-agent team scrolls forever.

## 3. How the agent list is fetched
`fetchData()` line 137: `GET /api/teams` → `teamsData.members` (array of `{ id, name, email, phone, hasLogin, userId }`). Stored in `teamMembers` state (line 74). Already client-side, full roster loaded up front — ideal for client-side filtering.

## 4. Proposed change — searchable input
No `Combobox` primitive in `components/ui` (confirmed: `card, badge, tabs, accordion, table, input, modal, button, select, AddressAutocomplete`). The existing `select.tsx` is a styled native `<select>` — not adaptable.

**Recommendation: inline filter-as-you-type using existing `<Input>` + filtered `<Card>` list.** Pattern:

```tsx
const [agentQuery, setAgentQuery] = useState('')
const filteredMembers = useMemo(() => {
  const q = agentQuery.trim().toLowerCase()
  if (!q) return teamMembers
  return teamMembers.filter(m =>
    m.name.toLowerCase().includes(q) ||
    (m.email?.toLowerCase().includes(q) ?? false)
  )
}, [teamMembers, agentQuery])
```

Render `<Input placeholder="Search agents by name or email…" value={agentQuery} onChange={…} autoFocus />` above the card list (between the H2/subtitle block at line 235-238 and the list at line 252). Show "No agents match '{query}'" empty state when `filteredMembers.length === 0 && agentQuery`.

This matches the Team Inventory fix (item #1) so both pages share the same UX. No new dep, no primitive needed.

## 5. Keyboard/UX
- `autoFocus` on the input so admin can type immediately on landing.
- **Enter-to-select-first-match**: on `onKeyDown`, if `e.key === 'Enter'` and `filteredMembers.length >= 1`, call `handleSelectMember(filteredMembers[0])`. Big quality-of-life win for fast typists ("ash" + Enter → Ashley).
- Arrow-key navigation through cards is **not worth building** here — it'd require focus management + roving tabindex (~1hr) for marginal value over Enter-on-first-match. Skip unless Ryan asks.
- Clear button (small `x` inside Input) optional; native `type="search"` gets one for free in most browsers — set `type="search"` on the Input.
- Show count: "3 of 24 agents" subtle text under input when filtered, for feedback.

## Note on team-inventory consistency
`app/dashboard/team-inventory/page.tsx` (item #1 in this batch) should use the **same** filter pattern + same Input copy ("Search agents by name or email…") so the two pages feel like one component. Worth extracting a tiny `<AgentFilterInput>` helper if both end up identical — but inline is fine for v1.