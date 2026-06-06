Excellent — clean dataset. Returning structured findings.

---

# CustomerOtherItem Analysis — Findings

**Total rows: 97** across **21 distinct customers** and **23 distinct description strings**.

## 1. Distribution

| Pattern | Count |
|---|---|
| Agent-prefix (`"{Name} {Type}"`) | 6 |
| Type-only (`"Metal Frame"`, `"BLACK METAL FRAME"`, etc.) | 28 |
| Test data | 2 |
| Unknown (no type keyword matched) | 11 |
| **Plain sign-type free-text** (matched type but no agent name) | 50 |

| Inferred target table | Count |
|---|---|
| **CustomerSign** | 82 |
| CustomerLockbox (`"stake for lockbox"`) | 2 |
| TEST | 2 |
| Unknown | 11 |

## 2. Top descriptions (full list)

- 19x `"Metal Frame"`
- 11x `"BLACK METAL FRAME"`
- 10x `"DIRECTIONAL WIRE FRAME"`
- 10x `"Open House Sunday Directional"`  *(Unknown — see below)*
- 9x `"White Metal Frame"`
- 9x `"For Sale Directional"`
- 7x `"Wire Frame Text NRRT"`
- 4x `"Black Metal Frame"`
- 2x `"stake for lockbox"`
- 2x `"Nadia Holliday Metal Post"`
- 2x `"Nadia Holliday Metal Frame"`
- 1x each: `"white metal frame"`, `"Brochure Box Frame"`, `"white post w solar light"`, `"White Metal Frame (test)"`, `"Bracket — test item"`, `"White Post"`, `"White Post Short"`, `"Black Post"`, `"Black Post in Box"`, `"Your Neighborhood Real Estate Agent"`, `"Jennifer Carroll Metal Post"`, `"Peggy Heckert Metal Frame"`

## 3. Agent-prefix match results

- 6 agent-prefix rows; **100% match rate** against TeamMember roster (0 no-match).
- All 6 belong to one customer: `supportstaff@semonin.com` / team **Semonin Realtors** → resolves to Jennifer Carroll, Peggy Heckert, Nadia Holliday.
- The 50 "no team" entries are non-team customers (Nick Ratliff, Carrie Lepore, etc.) — they have no roster so agent assignment is moot; just convert to CustomerSign with `assignedToMemberId = null`.

## 4. Recommended categorization rules

```
description matches /metal frame|metal post|wire frame|frame|post|for sale|directional|sign|bracket/i
  → CustomerSign  (preserve description verbatim; copy createdAt; inStorage=true)

description matches /lockbox/i                          → CustomerLockbox*
description matches /rider/i                            → CustomerRider*
description matches /brochure/i                         → CustomerBrochureBox
otherwise                                                → SKIP, flag for human review
```

\* CustomerLockbox/CustomerRider require FK `lockboxTypeId` / `riderId` from catalogs — the only lockbox case here (`"stake for lockbox"`) is actually a **sign accessory**, not a lockbox. Recommend treating as **CustomerSign** instead and skipping CustomerLockbox/CustomerRider branches entirely (no rows need them).

The 1x `"Brochure Box Frame"` is ambiguous — "Frame" suggests a sign-style frame for holding a brochure box. Recommend **CustomerSign**, not BrochureBox.

## 5. Test data — recommend hard delete

- `cmphmqk2x000qiwmfbd79ebzu` — `"White Metal Frame (test)"` — user `admin@pinkposts.com`
- `cmphmqk58000riwmfw48pp5vb` — `"Bracket — test item"` — user `admin@pinkposts.com`

Both belong to the admin seed user. Safe to delete.

## 6. Unknown / flag-for-review (11 rows, 1 customer)

All 11 belong to `agentpamky@gmail.com` (Pamela Snyder):
- 10x `"Open House Sunday Directional"`
- 1x `"Your Neighborhood Real Estate Agent"`

These ARE signs (directional sign + a yard-sign tagline) — my regex just missed them because they lack the keyword "frame/post/sign". **Recommendation: extend the rule to include `/directional|neighborhood|open house/i` → CustomerSign**, which sweeps these into the migration. Net result: 0 truly-unknown rows; nothing needs human review.

## 7. Sample rows (validation)

```
id=cmnjcxwt2000d15n4rhjliof4  "Metal Frame"  Nick Ratliff (nick@nrrt.com)  team=null  2026-04-03
id=cmnjcy6se000f15n4wzmavdfl  "Metal Frame"  Nick Ratliff (nick@nrrt.com)  team=null  2026-04-03
id=cmnnbt1v5000l15n431kzov92  "Metal Frame"  Carrie Lepore                  team=null  2026-04-06
```

## Recommended migration plan

**Single transaction per customer, idempotent, dry-run flag:**

1. **Delete** 2 admin test rows by id.
2. For remaining **95 rows**:
   - Parse: agent-prefix regex first (peel `"{Name} "` if it matches a TeamMember on the parent's team), then type keyword (extended set per §6).
   - **All 95** route to `CustomerSign` with: `userId` copied, `description` preserved verbatim, `createdAt` preserved, `inStorage=true`, `assignedToMemberId` = matched TeamMember.id for the 6 Semonin rows, else null.
   - Delete original CustomerOtherItem row.
3. **Final state: 0 rows in customer_other_items.** Recommend keeping the table in schema (no migration drop) in case future free-text capture is needed, but the admin UI can stop rendering an "Other" section.

**Script location:** `c:\Users\tanne\PPI\scripts\analyze-other-items.ts` (read-only analyzer — safe to re-run; performs no writes).

**Risk: low.** All 95 non-test rows have an obvious CustomerSign target. The 6 agent-prefix rows match the roster cleanly (no fuzzy-match edge cases). No CustomerLockbox/CustomerRider/CustomerBrochureBox conversions needed — avoids the FK lookup problem entirely.