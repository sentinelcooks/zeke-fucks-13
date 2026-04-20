

## Goal

Make the Lines analyzer **completely position-agnostic** for NBA, MLB, and NHL: putting Lakers in slot 1 vs slot 2 must produce identical confidence, identical verdict, and identical winning team. Today, three real bugs leak the slot order into the model output.

## Root cause (verified per sport)

### 1. NBA generic model — `supabase/functions/moneyline-api/index.ts`
- **Factor 6 (line 709–714) "Home/Away Splits"** always reads `extras.splits1.home` and `extras.splits2.away` — i.e. it assumes **team1 is home, team2 is away**, regardless of the real venue. Swapping slots flips this from "Lakers home vs Warriors road" to "Warriors home vs Lakers road" and changes the score.
- **Factor 20 (line 816–821) "Home PPG vs Away PPG"** has the identical bias — `splits1.home.ppg` vs `splits2.away.ppg`.
- The function already has `team1HomeAway`/`team2HomeAway` resolved in the request handler (line 1227–1228) but never passes it down.

### 2. NHL model — `supabase/functions/nhl-model/index.ts`
This model never resolves real home/away at all. Multiple hardcoded biases:
- **Line 732–733**: `homeGoalie = goalies.home`, `awayGoalie = goalies.away` — then assigns `homeGoalie` stats to the team1 factor block and `awayGoalie` stats to the team2 factor block (lines 774–778, 801–805). If team1 is actually the road team, team1 gets credit for the home goalie's numbers — total scrambling of starter assignments.
- **Line 790**: `home_away: scoreHomeAway(splits1.home, true)` — hardcodes team1 as home.
- **Line 817**: `home_away: scoreHomeAway(splits2.away, false)` — hardcodes team2 as away.
- **Line 720 + 728**: `arenaFactor` is computed from the venue but baked into a single shared score, while the home-ice advantage in `scoreHomeAway(_, true/false)` is locked to slot 1.
- **Line 858–859**: passes `homeGoalie?.name` to `nhlInjuryAdjustments` for **team1** and `awayGoalie?.name` for **team2** — same swap bug.
- **moneyline-api line 1335–1344** never sends `game_id` to nhl-model, so even if nhl-model tried `eventData.competitors.homeAway`, it has nothing to read. Need to pass the venue resolution forward.

### 3. MLB model — `supabase/functions/mlb-model/index.ts`
The model **already has** correct logic (line 676–696: `team1IsHome` flag, swaps pitcher/split assignments). But because **moneyline-api never sends `game_id`** (line 1267–1276), `eventData` is `null`, the `if (eventData)` block at line 678 is skipped, and `team1IsHome` defaults to `true` (line 677). So for any Lines-tab MLB analysis, MLB silently behaves like NHL: team1 is always home.

## Fix

Single principle: **resolve real home/away once in the orchestrator (already done by `resolveMatchupVenue`), pass it into every model, and use it everywhere a home/away role is referenced.** Never index by slot.

### A. `supabase/functions/moneyline-api/index.ts`
1. Pass the venue downstream when delegating:
   - In the MLB delegation body (~line 1270), include `team1_is_home: venue ? venue.team1IsHome : null` and `game_date: venue?.gameDate ?? null`.
   - Same in the NHL delegation body (~line 1338).
2. Pass `team1HomeAway`/`team2HomeAway` into the generic NBA analyzer:
   - Extend `analyzeMoneyline(...)` signature with an `extras.team1IsHome: boolean | null`.
   - **Factor 6 (line 709–714)**: pick `team1Split = team1IsHome ? splits1.home : splits1.away` and `team2Split = team1IsHome ? splits2.away : splits2.home`. When `team1IsHome` is `null` (no scheduled game found), fall back to a **role-neutral** comparison: `splits1.overall.winPct` vs `splits2.overall.winPct` (compute `overall` in `computeHomeAwaySplits` if not already present, or derive from existing home+away counts inline). Update the descriptor copy to read from the chosen split.
   - **Factor 20 (line 816–821)**: identical role-aware swap; when no venue, use combined `(home.ppg + away.ppg)/2` for each side so the comparison is symmetric.

### B. `supabase/functions/nhl-model/index.ts`
1. Accept `team1_is_home: boolean | null` in the request body (line 685).
2. Use it everywhere goalie/home/away role is referenced:
   - **Line 732–733**: `const team1Goalie = team1IsHome ? goalies.home : goalies.away;` `const team2Goalie = team1IsHome ? goalies.away : goalies.home;`. When `team1_is_home` is `null` (no game found), fall back to a symmetric league-average baseline for both: `{ savePct: 0.908, gaa: 2.90 }` for both — better to be neutral than to mis-assign.
   - Update lines 774–778 to use `team1Goalie.*` and lines 801–805 to use `team2Goalie.*`.
   - **Line 790**: `home_away: scoreHomeAway(team1IsHome ? splits1.home : splits1.away, !!team1IsHome)`.
   - **Line 817**: `home_away: scoreHomeAway(team1IsHome ? splits2.away : splits2.home, !team1IsHome)`. When venue unknown, both sides get `scoreHomeAway` with a neutral baseline (e.g. pass `{wins:0, losses:0}` and `false` so the function returns 50/50 via its existing "no data" branch).
   - **Line 858–859**: pass `team1Goalie?.name` and `team2Goalie?.name` in injury adjustments.
3. Keep `arenaFactor` (line 720, 728) — it's a shared environmental factor and applies equally to both sides; no change needed.

### C. `supabase/functions/mlb-model/index.ts`
1. Accept `team1_is_home: boolean | null` in the request body (line 624) so the orchestrator can supply venue when `game_id` isn't present.
2. In the `team1IsHome` resolution block (line 676–686), prefer the explicit `team1_is_home` argument when provided; fall back to the existing `eventData` check; only default to `true` if **both** are missing (last-resort, user did pick teams that aren't on the schedule).
3. No factor-block changes needed — the per-factor pitcher/split swap (line 693–696, 753, 772) already honors `team1IsHome`.

## Files changed

- `supabase/functions/moneyline-api/index.ts` — pass `team1_is_home`/`game_date` into MLB and NHL delegations; thread `team1IsHome` into `analyzeMoneyline` and use it in Factor 6 and Factor 20.
- `supabase/functions/nhl-model/index.ts` — accept `team1_is_home`, derive `team1Goalie`/`team2Goalie` from real role, fix `home_away` factor for both teams, fix injury-adjustment goalie name passing.
- `supabase/functions/mlb-model/index.ts` — accept `team1_is_home` and prefer it over the `game_id` lookup default.

## Non-goals

- No frontend changes (the UI already shows the verdict's `winning_team_name` from `buildDecision`, which is already symmetric).
- No DB migration. No changes to props analysis, Trends, GamesPage, or UFC.
- No change to NBA's symmetric factors (1–5, 7–19) — they already are order-independent.

## Verification

1. NBA: analyze **Lakers (slot 1) vs Warriors (slot 2)** moneyline, then swap to **Warriors (slot 1) vs Lakers (slot 2)**. Confirm:
   - `decision.win_probability` is identical (within rounding).
   - `decision.winning_team_name` names the same franchise.
   - Factor 6 "Home/Away Splits" reads "{actual home team} at home" in both runs.
2. NHL: same swap test on **Maple Leafs vs Sabres** (a real upcoming game). Confirm verdict + win % match across slot orders, and Factor "Home/Away Record" applies the home-ice bonus to whichever team is actually home per ESPN.
3. MLB: same swap test on a real upcoming MLB matchup. Confirm starting-pitcher stats in `factorBreakdown` are tied to the **correct team** in both orders (verifies `team1_is_home` reaches mlb-model even without `game_id`).
4. Edge case: pick two teams **not playing each other today** (no venue resolvable). Confirm both slot orders still produce identical output (neutral fallback path).

