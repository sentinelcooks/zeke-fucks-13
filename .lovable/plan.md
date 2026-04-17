
## Plan: Diagnose & harden slate-scanner so it actually returns plays

The pipeline deployed and the schema is correct, but a live dry-run returned 0 plays across all 4 sports with 0 sanity issues — meaning either (a) every downstream fetch is silently failing, or (b) it's a genuinely empty slate. Right now we can't tell which because `fnFetch` swallows everything. Fix that, then verify with real numbers.

### Steps

1. **Add diagnostics to `slate-scanner`** (`supabase/functions/slate-scanner/index.ts`):
   - Make `fnFetch` return `{ ok, status, data, url }` instead of just data, and log every downstream call's status + payload size.
   - Add a `debug=true` query param that returns a per-sport breakdown: `{ sport, gamesFetched, oddsFetched, propsFetched, gamesWithOdds, playsGenerated }` so we can pinpoint which step is empty.
   - Log the actual game count vs the count after the `STATUS_FINAL`/`IN_PROGRESS` filter.

2. **Fix likely root cause — wrong call signatures.** Audit the 3 internal calls:
   - `games-schedule?sport=basketball_nba` → confirm this function accepts `sport` as the Odds-API key vs short code (`nba`). Likely mismatch.
   - `nba-odds/events?sport=nba&markets=h2h,spreads,totals` → confirm this path exists; the existing function may only expose a different route.
   - `free-props/scan?sport=nba` → confirm this scan subroute exists; the cron-driven function may only have a default POST handler.
   Read each function's `index.ts` and align the orchestrator's URLs + params exactly.

3. **Re-run dry-run with `debug=true`** via `supabase--curl_edge_functions` and paste the per-sport breakdown. Expected: at least NBA or NHL returns >0 games and >0 plays on a normal day; if it's a true off-day for all 4 leagues, the breakdown will show `gamesFetched: 0` everywhere, which is a legit empty slate.

4. **If 0 plays is genuine** (off-season alignment), seed a single synthetic game through the dry-run path so the validation tooling has something to score, proving end-to-end math works. This synthetic mode lives behind `?seed=true` and never writes to DB.

5. **Re-verify live**:
   - `SELECT bet_type, count(*) FROM daily_picks WHERE pick_date = current_date GROUP BY bet_type;`
   - `SELECT bet_type, count(*) FROM free_props WHERE prop_date = current_date GROUP BY bet_type;`
   - `curl /slate-scanner?dryRun=true&debug=true` and paste the breakdown + top 3 plays.

### Out of scope
Paywall contrast fixes from the uploaded markdown (separate task — happy to tackle next), model weight changes, new sports.
