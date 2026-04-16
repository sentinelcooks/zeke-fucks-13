

## Plan: Reset O/U Total Line (and Spread inputs) on Sport Switch

### Root cause (`src/components/MoneyLineSection.tsx`, lines 1258-1262)

The sport-change effect only clears teams/results:
```ts
useEffect(() => {
  setTeamsLoading(true);
  setTeams([]); setTeam1(""); setTeam2(""); setResults(null); setError("");
  callMoneylineApi("teams", { sport }).then(setTeams)...
}, [sport]);
```

It does **not** clear `totalLine`, `spreadLine`, or `spreadTeam`. So a user who enters `215.5` for an NBA total, then switches to MLB, sees the input still holding `215.5` (only the placeholder changes from "215.5" to "8.5"). When they hit Analyze, the stale NBA-scale number gets POSTed to `moneyline-api` as the MLB total line — producing a wrong/invalid analysis.

The same stale-state bug applies to `spreadLine` (NBA spreads ~7.5 vs MLB run lines ~1.5 vs NHL puck lines ~1.5) and `spreadTeam` (which references an abbreviation that no longer exists in the new sport's team list).

### Fix (single, scoped frontend change)

In `src/components/MoneyLineSection.tsx`, extend the existing `useEffect` on `[sport]` (line 1258) to also reset the line inputs:

```ts
useEffect(() => {
  setTeamsLoading(true);
  setTeams([]); setTeam1(""); setTeam2(""); setResults(null); setError("");
  setTotalLine(""); setSpreadLine(""); setSpreadTeam("");
  setOverUnder("over");
  callMoneylineApi("teams", { sport }).then(setTeams).catch(() => {}).finally(() => setTeamsLoading(false));
}, [sport]);
```

This guarantees that switching NBA → MLB → NHL → NFL → NCAAB starts each sport with empty line fields, so the placeholder (already sport-aware: `8.5` for MLB, `5.5` for NHL, `44.5` for NFL, `140.5` for NCAAB, `215.5` default NBA) is what the user sees and types over fresh.

`betType` is intentionally preserved — if a user was on the Total tab in NBA and switches to MLB, they should stay on the Total tab; only the *value* needs to clear, not the tab choice.

### Verification

This is a frontend-only state fix — no backend, DB schema, or edge function changes. Verification is a UI smoke test:

1. Open `/dashboard/analyze` → Moneyline → Lines.
2. Sport = NBA, BetType = Total, type `215.5` in the total line field.
3. Switch sport to MLB → confirm the total line field is **empty** and shows placeholder `8.5`.
4. Switch to NHL → confirm field empty, placeholder `5.5`.
5. Repeat for Spread tab: enter `7.5` on NBA, switch to MLB → spread field empty, placeholder reflects MLB run line.

### Out of scope
- Backend `moneyline-api` (no changes — already accepts sport-correct values).
- Other tabs (Props, Slip, Games).
- Other sports' models.

