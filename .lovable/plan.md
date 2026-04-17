
## Plan

### 1. `supabase/functions/slate-scanner/index.ts` — active per-player analysis
- Loop SPORTS = ['nba','mlb','nhl','ufc']
- Per sport: fetch today's games (games-schedule), then for each game pull live `(player, market, line, odds)` tuples from `nba-odds/events`
- Call sport analyzer (`nba-api`/`mlb-model`/`nhl-model`/`ufc-api`) per player×prop with chunked concurrency (5 at a time, small delay) to avoid Lovable AI 429s
- Score each result via `_shared/edge_scoring.ts`, keep non-Pass
- Keep existing game-line evaluation
- Per-sport logging: `[sport] N games, M players, K props, X candidates`
- Wipe + insert today's `daily_picks` and `free_props`
- Return `{ stats: { nba:{games,players,props,candidates}, ... }, todays_edge, daily, free }`

### 2. `supabase/functions/_shared/edge_scoring.ts` — sport-diverse Today's Edge
- In `rankAndDistribute`: enforce **max 2 per sport** in Today's Edge top 5, fall back to fill remaining slots if cap leaves <5

### 3. Verification (after deploy)
- Deploy `slate-scanner` and `_shared/edge_scoring.ts`
- `curl` `slate-scanner?debug=true`, paste full JSON response
- Pull `slate-scanner` logs, paste per-sport headers
- Run SQL `SELECT sport, tier, COUNT(*) FROM daily_picks WHERE pick_date=CURRENT_DATE GROUP BY sport, tier ORDER BY sport, tier` and paste
- Confirm Today's Edge / Picks no longer empty

### Out of scope
Analyzer model logic, UI styling, onboarding/paywall, auth/routing, free-props cron.

### Files touched
1. `supabase/functions/slate-scanner/index.ts`
2. `supabase/functions/_shared/edge_scoring.ts`
