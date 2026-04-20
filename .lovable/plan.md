

## Goal

Fix the contradiction in the **VS** (Head-to-Head) section of the Analyze tab where the rate cards say e.g. **"100% (3 games)"** but every row in the games table below shows **✗ (never hit)**. Affects **all non-NBA props** (MLB, NHL, plus NBA combo props like `pts+reb+ast`).

## Root cause (verified)

Two separate hit calculations look at the same games but use **different stat sources**:

1. **Rate cards** (`This Season / Last Season / Combined`) come from the backend's `head_to_head.rate`, which is computed via `getStatValue(g, propType)` server-side and correctly knows that `propType: "hits"` → `game.hits`, `propType: "goals"` → `game.goals`, etc. (`supabase/functions/nba-api/index.ts` lines 3115–3123, 1748–1768).

2. **Games table rows** are re-derived **client-side** by `GamesTable.getStatVal` (`src/pages/NbaPropsPage.tsx` lines 280–294). Its lookup map only contains NBA keys (`PTS, REB, AST, FG3M, STL, BLK, TOV, FTM, FGM, FGA, FTA, MIN`). For any MLB prop (`hits`, `runs`, `rbi`, `home_runs`, `total_bases`, `walks`, `strikeouts`, `hits_allowed`, `earned_runs`, `walks_allowed`, `h+r+rbi`, `hits+runs`, `fantasy_score`) or NHL prop (`goals`, `nhl_assists`, `nhl_points`, `sog`, `pim`, `ppg`, `toi`, `g+a`), the lookup returns `undefined`, so `g[undefined] || 0` = **0** for every game → every row reads 0 vs the line → all ✗.

The backend already attaches the correctly-computed per-game value to the **main** game log as `g.stat_value` (line 3028), and `GamesTable` already reads `g.stat_value` for 1Q props (line 287). The H2H/prev-H2H game logs simply **don't include `stat_value`** in the row payload.

## Fix — 2 files, focused

### 1. `supabase/functions/nba-api/index.ts`

Attach `stat_value` to every per-game row in the H2H, "other games", and prev-season H2H lists so the client never has to re-derive it:

- **Lines ~3117–3122** (H2H gameLog): include `stat_value: h2hVals[i]` on each row, and add raw MLB/NHL columns (`HITS, RUNS, RBI, HR, TB, BB, SO, GOALS, ASSISTS_NHL, SOG, PIM, TOI, FPTS`) the same way the main game log does (around line 3024).
- **Lines ~3128–3133** (`otherGames` gameLog): same treatment.
- **Lines ~3176–3181** (`prevSeasonH2H`): build a real `games` array with `stat_value` and the same enriched columns (currently `prevSeasonH2H.games` is never populated, so the "Last Season" rows in the combined H2H table silently disappear).

This guarantees the client receives one canonical `stat_value` per game, computed by the same `getStatValue(game, propType)` that drives the rate cards. Single source of truth.

### 2. `src/pages/NbaPropsPage.tsx`

Make `GamesTable` (lines 277–344) prefer the server-provided `stat_value` and broaden the headers:

- In `getStatVal`, **always return `g.stat_value` when it is a finite number** (not just for 1Q). Fall back to the existing NBA map only when `stat_value` is missing (legacy safety).
- Make the headers sport-aware so MLB/NHL show meaningful columns instead of empty `PTS/REB/AST` cells:
  - **MLB hitting** (`hits, runs, rbi, home_runs, total_bases, walks, h+r+rbi, hits+runs`): `Date · OPP · W/L · AB · H · R · RBI · Prop · ✓/✗`
  - **MLB pitching** (`strikeouts, hits_allowed, earned_runs, walks_allowed`): `Date · OPP · W/L · IP · K · ER · BB · Prop · ✓/✗`
  - **NHL** (`goals, nhl_assists, nhl_points, sog, g+a, pim, toi, ppg`): `Date · OPP · W/L · TOI · G · A · SOG · Prop · ✓/✗`
  - **NBA / 1Q** (default): unchanged.
- Read those columns from the enriched per-game payload (HITS / RUNS / RBI / GOALS / ASSISTS_NHL / SOG / TOI etc.), with `—` fallback if missing.

Computing `isHit` already uses `sv` (now reliably `stat_value`), so the ✓/✗ column will perfectly match the H2H rate card percentages.

## Files changed

- `supabase/functions/nba-api/index.ts` — H2H gameLog, otherGames gameLog, and prevSeasonH2H now include `stat_value` plus MLB/NHL raw stat columns; prevSeasonH2H now actually builds a `games` array.
- `src/pages/NbaPropsPage.tsx` — `GamesTable.getStatVal` prefers `g.stat_value` for all sports; sport-aware headers/rows for MLB hitting, MLB pitching, and NHL.

## Non-goals

- No changes to the rate calculation (`hitRate()` in the backend) — already correct, that's the source of truth we're aligning to.
- No changes to NBA single-stat props (PTS/REB/AST/etc.) — they continue to work, now via `stat_value` instead of the per-stat map (functionally identical, since `stat_value === g.pts` for `propType="points"`, etc.).
- No DB migration. No changes to UFC (no game-log table). No changes to the Picks/Slip/Trends tabs.

## Verification

1. Analyze **MLB** Vladimir Guerrero Jr. **Over 0.5 Hits** vs the upcoming opponent → confirm:
   - "This Season" h2h rate card and the per-game ✓/✗ column **agree** (e.g. 3/3 cards == three ✓ rows).
   - The `Prop` column shows actual hit counts (1, 2, 0, …) instead of all zeros.
2. Analyze an **NHL** prop (e.g. Auston Matthews **Over 2.5 SOG**) → table shows TOI/G/A/SOG columns and ✓/✗ matches the rate card.
3. Analyze an **NBA** prop (e.g. Jokic **Over 25.5 Points**) → table is unchanged from today, ✓/✗ still correct.
4. Analyze an **NBA combo** prop (e.g. SGA **Over 39.5 PRA**) → ✓/✗ now matches the H2H rate card (this combo path was also broken since `pts+reb+ast` was the only combo handled inline; via `stat_value` all combos now line up).

