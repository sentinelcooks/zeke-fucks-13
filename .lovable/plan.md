

## Plan — Split slate-scanner into per-sport functions + orchestrator

### Architecture

```text
slate-scanner (orchestrator)
  ├─ wipe today's daily_picks + free_props (ONCE)
  ├─ invoke slate-scanner-nba  ──┐
  ├─ invoke slate-scanner-mlb   ├─ each runs analyzer on its own sport,
  ├─ invoke slate-scanner-nhl   │  appends raw candidates to a staging row
  ├─ invoke slate-scanner-ufc  ──┘  set in daily_picks with tier='_pending'
  └─ finalize: read all _pending rows, run rankAndDistribute → 
       update tiers (edge / daily / value), write free_props top 20
```

### 1. New per-sport functions
Create 4 thin wrappers that each import the existing scanner internals:
- `supabase/functions/slate-scanner-nba/index.ts`
- `supabase/functions/slate-scanner-mlb/index.ts`
- `supabase/functions/slate-scanner-nhl/index.ts`
- `supabase/functions/slate-scanner-ufc/index.ts`

Each:
- Fetches that sport's events + props (existing logic, scoped to one sport)
- Runs prefilter → analyzer validation (existing `validateWithAnalyzer`)
- Inserts surviving candidates into `daily_picks` with `tier='_pending'` (staging marker)
- Returns `{ sport, scanned, validated, inserted }`

### 2. Refactor `slate-scanner/index.ts` into orchestrator
- DELETE today's `daily_picks` + `free_props` rows once at start
- `Promise.allSettled` invoke the 4 per-sport functions via `supabase.functions.invoke()` (they run as separate edge invocations, each with its own wall-time budget)
- After all complete: SELECT all `tier='_pending'` rows for today, run existing `rankAndDistribute` from `_shared/edge_scoring.ts`, then UPDATE tiers to `edge` / `daily` / `value` and INSERT top 20 into `free_props`
- Return aggregated stats: `{ perSport: {...}, totals: {...}, tiers: {edge, daily, value} }`

### 3. Shared helpers
Move the per-sport scan body (event fetch, prop fetch, validate, insert) into `_shared/sport_scan.ts` so each per-sport function is ~30 lines and the orchestrator stays focused on coordination.

### 4. Cron
Cron already targets `slate-scanner` — no schedule change. The orchestrator handles everything.

### 5. Verification
- Deploy: `slate-scanner`, `slate-scanner-nba`, `slate-scanner-mlb`, `slate-scanner-nhl`, `slate-scanner-ufc`
- `curl POST /slate-scanner?debug=true` → paste per-sport stats + final tier counts
- SQL:
  ```sql
  SELECT sport, tier, COUNT(*) FROM daily_picks
  WHERE pick_date = CURRENT_DATE
  GROUP BY sport, tier ORDER BY sport, tier;
  ```
- Reload `/dashboard/home` → confirm 5 edge cards render

### Out of scope
Analyzer logic, edge_scoring rules, schema, frontend, onboarding, paywall.

### Files touched
1. `supabase/functions/_shared/sport_scan.ts` (new)
2. `supabase/functions/slate-scanner-nba/index.ts` (new)
3. `supabase/functions/slate-scanner-mlb/index.ts` (new)
4. `supabase/functions/slate-scanner-nhl/index.ts` (new)
5. `supabase/functions/slate-scanner-ufc/index.ts` (new)
6. `supabase/functions/slate-scanner/index.ts` (rewrite as orchestrator)

