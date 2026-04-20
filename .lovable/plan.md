

## Goal

Fix three issues so Today's Edge and the Picks tab show a multi-sport variety again:

1. **MLB & NHL produce zero picks** because the analyzer (`nba-api/analyze`, Lovable AI Gateway) is being **rate-limited** when all 4 sports fan out in parallel. Logs show ~30+ consecutive `RateLimitError: Retry after 34803ms` for NHL alone.
2. **Today's Edge is empty** because the orchestrator re-scores from rounded `hit_rate` + applies a strict reliability floor (≥0.70). All 6 NBA picks today fail it → `edge:0 daily:0 free:0`.
3. **UFC** is missing from `SPORT_KEYS`, so its scanner can't read the games schedule.

## Root cause evidence

- `slate-scanner` log: `Per-sport results: nba=6 inserted, mlb=0, nhl=0, ufc=0` then `Distribution → edge:0 daily:0 free:0`.
- `slate-scanner-nhl` log: 30+ stack traces of `RateLimitError ... nba-api/analyze ... Retry after 34803ms`.
- DB confirms today empty: `SELECT sport, tier, COUNT(*) FROM daily_picks WHERE pick_date = CURRENT_DATE` → no rows.
- `_shared/edge_scoring.ts` `rankAndDistribute` floor: `confidence ≥ 0.65 AND reliability ≥ 0.70 AND edge > 0` — strict enough that mid-reliability NBA props (threes/steals/blocks at 0.55–0.75) get dropped before they ever reach a tier.

## Fix — three files

### 1. `supabase/functions/slate-scanner/index.ts` — serialize sports + insurance retry

- **Sequential dispatch instead of parallel** so the analyzer rate limit only sees one sport at a time. Replace `Promise.allSettled(sports.map(...))` with a `for` loop that awaits each `invokeSport` in turn. This eliminates the 18-in-flight pile-up and lets MLB/NHL actually validate.
- Order: `nba → mlb → nhl → ufc` (largest slate first benefits from a warm gateway).

### 2. `supabase/functions/_shared/sport_scan.ts` — gentler analyzer fan-out + UFC key + retry on 429

- `ANALYZER_CHUNK = 6` → `3` (6 parallel analyzer calls is what's tripping the per-trace rate limit).
- `ANALYZER_CAP = 75` → `45` (still a full slate, but cuts wall-time and 429 surface area).
- Add `SPORT_KEYS.ufc = "mma_mixed_martial_arts"` so UFC's `games-schedule` lookup succeeds.
- In `validateWithAnalyzer`, on `r.status === 429` (or text contains "Rate limit"), wait `min(retryAfterMs, 4000)` and retry once. Currently a 429 silently returns `null` → the candidate is permanently lost.

### 3. `supabase/functions/_shared/edge_scoring.ts` — slightly loosen the orchestrator floor

The analyzer already enforces `confidence ≥ 0.65 AND edge > 0.025` per-pick. The redundant orchestrator floor is what's silently zeroing the slate when reliability is mid-tier. Change `rankAndDistribute`:

- Floor: `confidence ≥ 0.62 AND reliability ≥ 0.55 AND edge > 0` (was `0.65 / 0.70 / 0`).
- Keep verdict tiering and the 5-pick `TODAYS_EDGE_CAP` per sport-diversity rule unchanged — `Strong` and `Lean` survive, only true `Pass` is dropped.

This restores the previous behavior where validated picks reach the Picks tab and the top 5 surface to Today's Edge with sport diversity (max 2/sport).

## Files changed

- `supabase/functions/slate-scanner/index.ts` — parallel → sequential dispatch.
- `supabase/functions/_shared/sport_scan.ts` — `ANALYZER_CHUNK 6→3`, `ANALYZER_CAP 75→45`, add UFC SPORT_KEY, 429 retry-once in `validateWithAnalyzer`.
- `supabase/functions/_shared/edge_scoring.ts` — relax `rankAndDistribute` floor to `0.62 / 0.55 / 0`.

## Non-goals

- No changes to the Picks tab UI, Today's Edge carousel UI, the analyzer (`nba-api/analyze`), the `daily_picks` schema, or the Games tab.
- No DB migration.
- Not changing the verdict tiering thresholds (`Strong`/`Lean`/`Pass`) — only the redundant orchestrator floor that was double-gating analyzer output.

## Verification (after deploy)

1. Deploy `slate-scanner`, `slate-scanner-nba`, `slate-scanner-mlb`, `slate-scanner-nhl`, `slate-scanner-ufc`.
2. `curl` `slate-scanner` → confirm `perSport.{mlb,nhl}.validated > 0` AND `tiers.edge > 0` (was 0/0/0 before).
3. `psql` 
   ```sql
   SELECT sport, tier, COUNT(*) 
   FROM daily_picks 
   WHERE pick_date = CURRENT_DATE 
   GROUP BY sport, tier ORDER BY sport, tier;
   ```
   → expect rows for **nba, mlb, nhl** across `edge` / `daily` / `value` tiers.
4. `psql SELECT sport, COUNT(*) FROM free_props WHERE prop_date = CURRENT_DATE GROUP BY sport;` → expect multi-sport rows.
5. Paste all three outputs (scanner JSON `perSport` + `tiers`, daily_picks SQL, free_props SQL) verbatim in the summary before marking complete.

