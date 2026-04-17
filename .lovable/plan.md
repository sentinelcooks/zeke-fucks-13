
## Plan: Remove NFL from the Lines Tab Sport Selector

### Scope
The user wants NFL removed from the sport selector in the Lines (Moneyline) tab. This is a frontend-only change — no backend, edge function, or DB modifications needed.

### Change

**File:** `src/components/MoneyLineSection.tsx`

1. **Remove NFL from the sport selector array** (line 1351) — delete the NFL entry so the selector shows only NBA, MLB, NHL, NCAAB.
2. **Remove NFL from the `SportType` union** (line 59) — drop `"nfl"` so TypeScript prevents future selection.
3. **Remove the unused NFL logo import** (line 52) and the NFL-specific placeholder/example branches (lines 1443, 1447, 1572) since they become dead code.

### Verification
Frontend-only — no edge function or DB to curl. Verification is a UI check:
- Open Analyze → Moneyline → Lines tab.
- Confirm the sport selector shows NBA, MLB, NHL, NCAAB only (no NFL).
- Confirm switching between remaining sports still works and placeholders render correctly (MLB `8.5`, NHL `5.5`, NCAAB `140.5`, NBA `215.5`).

### Out of scope
- Other tabs (Games, Picks, Free Props) — NFL stays wherever else it appears unless the user asks.
- Backend `moneyline-api` — still supports NFL if called directly; no removal needed since the UI no longer offers it.
