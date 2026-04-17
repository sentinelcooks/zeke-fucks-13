
## Goal
Replace the AI-shortlist pipeline with a deterministic full-slate scan. Today's Edge + Picks tab will only show high-probability, model-backed plays.

## Root cause
- `daily-picks` ranks games with AI, then asks Gemini to pick 4–5 candidate players per game → strong props get missed before grading.
- Player props are graded with `confidence ≥ 60%` (too low) and there's a fallback that accepts `45%` confidence to "fill volume" → junk picks survive.
- `free-props` separately publishes pure odds-edge picks (no model), with no confidence/reliability/longshot gates → low-hit-rate longshots leak in.
- Gates in `_shared/edge_scoring.ts` allow `Strong` at confidence ≥ 0.62 — below the user's required 0.65.

## Fix (3 files, no schema changes)

### 1. `supabase/functions/_shared/edge_scoring.ts` — tighten gates
- Bump `tierVerdict` minimums:
  - Strong: `confidence ≥ 0.65 AND edge ≥ 0.03 AND reliability ≥ 0.70`
  - Lean: `confidence ≥ 0.60 AND edge ≥ 0.025 AND reliability ≥ 0.65`
- Longshots (`odds ≥ +250`) → require `confidence ≥ 0.72 AND edge ≥ 0.06`
- Volatile-market `under` → require `confidence ≥ 0.70 AND edge ≥ 0.06`
- `rankAndDistribute`: cut `MAX_LOW_RELIABILITY_TOTAL` from 2 → 1, hard-drop anything with `confidence < 0.65 OR reliability < 0.70 OR edge ≤ 0`.
- Today's Edge stays top-5 Strong by `quality_score`.

### 2. `supabase/functions/daily-picks/index.ts` — full-slate deterministic scan
Rewrite the orchestrator (keep helpers `getGamesForSport`, `getGameLineup`, `analyzeGameBets`, `analyzePlayerProp`, `fetchRealOdds`, `fetchGameOdds`):
- **Remove** `rankGamesByAnticipation` and `getLineupPropSuggestions` from the selection path (AI no longer chooses what gets graded).
- **Phase A — All games, all markets:** loop every NBA/MLB/NHL game today, grade `moneyline`, `spread`, `total` via the existing sport models. Throttled with `delay()`; respect existing 140s timeout guard.
- **Phase B — All active players, both directions:** for each game, pull `getGameLineup` (already returns active roster from box score / roster fallback). For every player, grade every supported prop type per sport for **both `over` and `under`**:
  - NBA: points, rebounds, assists, threes, steals, blocks, turnovers
  - MLB: strikeouts, hits, home_runs, total_bases, rbi, runs
  - NHL: goals, assists, points, shots_on_goal
  - Use the player's market line returned by `analyzePlayerProp` (it already pulls real lines); skip if no market line found.
  - Limit to ~12 players per game (top scorers from box score / roster order) to stay within timeout — this is a perf cap, not an AI shortlist.
- **Phase C — Score & gate:** convert every graded result into a `ScoredPlay` via shared `score()` and run through `rankAndDistribute()`. Drop fallbacks/expansion/45% rescues entirely.
- **Phase D — Persist:**
  - `daily_picks`: top of `dailyPicks` with `tier="edge"` for the 5 in `todaysEdge`, `tier="daily"` for the rest.
  - `free_props`: replace today's rows with the curated `freePicks` from the same scan (single source of truth).

### 3. `supabase/functions/free-props/index.ts` — stop being a parallel writer
- Keep the `today` and `correlated` GET handlers untouched (frontend reads them).
- Replace `generate` so it just proxies to `daily-picks` (no separate odds-only scan, no separate writer). This kills the source of low-confidence longshot leaks.

## What stays the same
- Scoring math, EV/edge formula, reliability map (just stricter thresholds).
- All frontend code: `daily_picks` and `free_props` schemas unchanged. Today's Edge carousel still filters by `tier === "edge"`.
- AI still used for explanations elsewhere (prop-explainer) — only removed from selection.

## Files touched
1. `supabase/functions/_shared/edge_scoring.ts` — stricter `tierVerdict` + `rankAndDistribute` caps.
2. `supabase/functions/daily-picks/index.ts` — replace orchestrator with full-slate deterministic scan; write both `daily_picks` (with `tier`) and `free_props`.
3. `supabase/functions/free-props/index.ts` — `generate` becomes a proxy to `daily-picks`.

## Success criteria mapping
- Full slate scanned → Phase A+B loop every game/player.
- No more longshot junk → tightened `tierVerdict` + `rankAndDistribute` hard drops.
- Today's Edge = best 5 of full slate → `rankAndDistribute.todaysEdge` ranks all plays globally by `quality_score`.
- Picks tab = remaining approved plays → `dailyPicks` minus the 5 edge picks.
- AI removed from selection → ranker + lineup shortlister deleted from the pipeline.
