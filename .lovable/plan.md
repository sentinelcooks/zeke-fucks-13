

## Diagnosis

The "❌ NO BET RECOMMENDED — 0 vs 0, 0 neutral" verdict on UFC matchups is a frontend bug, not bad data.

`WrittenAnalysis.tsx` — `generateOverallSummary` for `type="moneyline"` runs `computeMoneylineTier(props)`, which counts factors from `props.factorBreakdown` (the team-sport per-factor team1/team2 score array). UFC never passes `factorBreakdown` and never passes a `decision` object, so the loop sees zero factors → `winnerCount=0` → `tier="noBet"` → the canned "Factors split too evenly (0 vs 0, 0 neutral)" message.

Meanwhile the in-depth analysis above it correctly shows 77% confidence and "Strong pick on Yannis at -150" because that section is generated from `verdict`/`confidence` directly via the AI narrative, not from `factorBreakdown`.

The UFC backend (`ufc-api`) already returns everything we need to build a real decision: `ml_pick.pick`, `ml_pick.probability`, `ml_pick.confidence` ("strong" | "lean" | "avoid"), `ml_pick.reasoning`, plus `best_bet.probability`/`best_bet.confidence`. We just need to forward this into `WrittenAnalysis` as a `decision` object so it takes the "single source of truth" path that already exists at lines 170–186.

## Fix — UfcPage.tsx only

In `MatchupResults` (`src/pages/UfcPage.tsx` ~line 504), add a derived `ufcDecision` and pass it via the `decision` prop:

```ts
const ufcDecision = ml_pick ? {
  winning_side: ml_pick.pick === fighter1?.name ? "team1" : "team2",
  winning_team_name: ml_pick.pick,                       // e.g. "John Yannis"
  win_probability: ml_pick.probability ?? confidenceNum, // 77
  edge: typeof ml_pick.probability === "number"
    ? Math.max(0, ml_pick.probability - 50)              // crude edge vs 50/50
    : null,
  conviction_tier:                                       // map to WrittenAnalysis tiers
    ml_pick.confidence === "avoid" ? "noBet" :
    (ml_pick.probability ?? 0) >= 75 ? "veryHigh" :
    ml_pick.confidence === "strong" ? "high" :
    ml_pick.confidence === "lean"   ? "medium" : "low",
  recommended_units:
    ml_pick.confidence === "avoid" ? 0 :
    (ml_pick.probability ?? 0) >= 75 ? 3 :
    ml_pick.confidence === "strong" ? 2 :
    ml_pick.confidence === "lean"   ? 1 : 0.5,
  verdict_text: ml_pick.reasoning ?? "",
} : null;
```

Pass to `<WrittenAnalysis ... decision={ufcDecision} team1Name={fighter1?.name} team2Name={fighter2?.name} />`.

This routes UFC into the existing `decision`-honoring branch (lines 170–186 of `WrittenAnalysis.tsx`), which produces clean output like:
> "Strong play on John Yannis. 77% win probability, 27% edge. Recommended sizing: 1.5–2 units."

When `ml_pick.confidence === "avoid"` (true toss-up from the model), it correctly shows "No bet recommended. Edge does not justify a play on Toss-up." — matching the model's actual signal instead of the false "0 vs 0, 0 neutral" message.

No backend changes. No edge function deploy. No schema changes.

### Verification
- Re-open `/dashboard/ufc` Yannis vs Siraj matchup → confirm Overall Verdict reads "Strong play on John Yannis…" with sizing line, green ✅ Take This Pick badge.
- Pick a known toss-up (`ml_pick.confidence === "avoid"`) and confirm it still says "No bet recommended" but with the *real* reason, not "0 vs 0".

### Files touched
1. `src/pages/UfcPage.tsx` — add `ufcDecision` derivation + pass `decision`/`team1Name`/`team2Name` props.

### Out of scope
- `WrittenAnalysis.tsx` logic (already correct; just needs the right props).
- UFC backend, edge_scoring, NBA/MLB/NHL flows (unchanged — they pass `factorBreakdown` or `decision` already).

