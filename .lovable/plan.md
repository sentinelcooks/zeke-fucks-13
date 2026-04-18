

## Diagnosis

Two real bugs producing the screenshots — not just NHL/MLB; even the NBA "97% under 1.5 threes" cards on Draymond/McDaniels/Goodwin are fake.

### Bug A — Scanner uses wrong `prop_type` keys, analyzer silently scores everything as 0
`sport_scan.ts` strips Odds-API market keys with regex:
```
player_threes  →  threes
player_points  →  points        // OK for NBA, WRONG for NHL (NHL "points" = goals+assists)
batter_hits    →  hits
nhl_assists    →  assists       // analyzer expects "nhl_assists"
```
But `nba-api/analyze`'s `getStatValue()` switch uses canonical keys: `"3-pointers"`, `"nhl_points"`, `"nhl_assists"`, `"goals"`. There is **no case for `"threes"` or `"assists"` (NHL)** — the switch falls through to `default: 0`.

Result: every game scores 0 → "Season avg 0 / hit rate 100% under 1.5" → projects 95% confidence → passes the floor → stored as edge. That's why every "Under 1.5 threes" card says 97% with identical bogus reasoning ("Season avg (0)…73/73 games"). The live analyzer (image #15) sends `"3-pointers"` and gets the real 76% / season avg 1.4.

`free-props/index.ts` already has the correct `MARKET_TO_PROP` map — the scanner just needs to use the same one.

### Bug B — Stale stored reasoning shown on Picks tab
Even when the keys are right, the stored `reasoning` string can drift from a fresh analyzer call, so the user sees one number on the carousel/Picks card and a different one when they tap "See Why". Already partially solved by passing player+line via state to live `/dashboard/analyze`, but the displayed `hit_rate` on the card itself must equal the analyzer's `confidence`.

## Fix

### 1. `supabase/functions/_shared/sport_scan.ts`
Replace the regex-based marketKey normalization with an explicit map that matches what the analyzer expects:

```ts
const MARKET_TO_PROP: Record<string, string> = {
  // NBA
  player_points: "points", player_rebounds: "rebounds", player_assists: "assists",
  player_threes: "3-pointers", player_blocks: "blocks", player_steals: "steals",
  player_turnovers: "turnovers",
  player_points_rebounds_assists: "pts+reb+ast",
  player_points_rebounds: "pts+reb",
  player_points_assists: "pts+ast",
  player_rebounds_assists: "reb+ast",
  // MLB
  batter_hits: "hits", batter_runs_scored: "runs", batter_rbis: "rbi",
  batter_home_runs: "home_runs", batter_total_bases: "total_bases",
  batter_walks: "walks", batter_stolen_bases: "stolen_bases",
  pitcher_strikeouts: "strikeouts",
  // NHL
  player_goals: "goals", player_shots_on_goal: "sog",
  player_total_saves: "saves",
  player_points_q: "nhl_points",   // NHL points
  player_assists_q: "nhl_assists", // NHL assists
};
```

Use sport-aware mapping: in NHL the Odds-API key for skater points is `player_points` and for assists is `player_assists` — but those collide with NBA. Solution: branch on `sport` so `player_points` → `nhl_points` for NHL, `points` for NBA; same for `player_assists`.

If a market isn't in the map, **skip it** (don't guess). This guarantees nothing reaches the analyzer with a key it doesn't understand.

### 2. Confidence-fidelity check
After `validateWithAnalyzer` returns, store `hit_rate = Math.round(analyzed.confidence)` (already doing this) AND store the analyzer's exact reasoning. Add a sanity reject: if the analyzer's reported `propAvg` (or equivalent in the stat block) is `0` AND the prop is one where `0` is implausible for a starter (points/threes/rebounds for NBA starters who play >15min), drop the pick — it's a sign the prop_type still didn't resolve.

### 3. Verification
- `supabase--deploy_edge_functions ["slate-scanner-nba","slate-scanner-mlb","slate-scanner-nhl","slate-scanner-ufc","slate-scanner"]`
- `curl POST /slate-scanner?debug=true` — paste perSport stats
- ```sql
  SELECT player_name, sport, prop_type, line, direction, hit_rate
  FROM daily_picks WHERE pick_date = CURRENT_DATE
  ORDER BY sport, hit_rate DESC;
  ```
- For top 3 picks: `POST /nba-api/analyze` with the **stored** prop_type/line/direction → confirm returned `confidence` equals stored `hit_rate` (within 1%). Paste the comparison.
- Confirm zero rows where `prop_type` is `threes`, `assists` (NHL), or any unmapped raw market key.

### Out of scope
Analyzer model internals, edge_scoring, frontend, onboarding, paywall.

### Files touched
1. `supabase/functions/_shared/sport_scan.ts` only.

