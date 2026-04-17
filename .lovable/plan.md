
## Plan: Automated Daily Edge Engine

Build a unified scanner that evaluates the full daily slate (games + players, all markets) across NBA/MLB/NHL/UFC, ranks plays by edge × confidence, and distributes them into Today's Edge, Daily Picks, and Free Picks — with built-in validation tooling.

### Current state (from exploration)
- `daily-picks` edge function exists but is per-sport and prop-only.
- `free-props` edge function exists, prop-only, runs on cron.
- `nba-odds`, `mlb-model`, `nhl-model`, `ufc-api` already produce confidence/edge for individual queries.
- `daily_picks` table supports `bet_type` (`prop` | `moneyline` | `spread` | `total`) — schema is ready.
- `free_props` table is prop-only.

### Architecture

```text
                  ┌─────────────────────────────┐
                  │  edge fn: slate-scanner     │  ← cron 6 AM ET daily
                  │  (new orchestrator)         │
                  └──────────────┬──────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                         ▼
   games-schedule         odds (nba-odds)           rosters (ESPN)
   (all 4 sports)         game lines + props        active players
        │                        │                         │
        └────────────┬───────────┴─────────────┬───────────┘
                     ▼                         ▼
           ┌──────────────────┐       ┌──────────────────┐
           │ Game-line eval   │       │ Player-prop eval │
           │ ML / Spread / OU │       │ all prop markets │
           │ uses sport model │       │ uses sport model │
           └────────┬─────────┘       └────────┬─────────┘
                    └────────────┬─────────────┘
                                 ▼
                  ┌────────────────────────────┐
                  │ Unified scoring + ranking  │
                  │ score = edge × confidence  │
                  └──────────────┬─────────────┘
                                 ▼
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        Today's Edge        Daily Picks       Free Picks
        (top 5, ≥75%)       (≥70%, top 20)    (≥65%, top 30)
```

### Build steps

1. **DB migration** — extend `free_props` with `bet_type`, `home_team`, `away_team`, `spread_line`, `total_line`, `reasoning` so it can hold game-line plays too. Add index on `(prop_date, sport, confidence desc)` to both `daily_picks` and `free_props`.

2. **New edge function `slate-scanner`** (orchestrator):
   - Pulls full slate from `games-schedule` for NBA, MLB, NHL, UFC.
   - For each game: fetches ML/spread/total odds via `nba-odds`, runs sport model to get projected probability, computes implied probability + edge + EV.
   - For each active player: fetches all prop markets, runs prop model, computes edge + confidence.
   - Generates a one-sentence reasoning string per pick.
   - Writes to `daily_picks` (≥70%) and `free_props` (≥65%); top 5 highest score per sport tagged for Today's Edge.

3. **Shared scoring module** `supabase/functions/_shared/edge_scoring.ts` — single source of truth for `score = edge_pct × confidence`, verdict tiering (Strong ≥75 / Lean ≥65 / Pass), and reasoning template.

4. **Cron** — pg_cron schedule at 6 AM ET hitting `slate-scanner`.

5. **Frontend wiring**:
   - Today's Edge carousel: read top-scored rows where `bet_type` includes game-lines, not just props.
   - Free Picks page: add tabs/filter chips for "All / Game Lines / Props" and show reasoning.
   - Daily Picks: surface game-line picks alongside prop picks with bet-type badge.

6. **Validation tooling** — new admin-only edge function `slate-validate` that:
   - Runs scanner in dry-run mode against a sample date (no DB writes).
   - Returns counts per sport / market, top 10 plays with full math (proj prob, implied prob, edge, EV, score), and sanity checks (e.g. no duplicate plays, no edge > 50%, all confidences ∈ [0,1], rosters non-empty).
   - Surfaced in the existing Admin page as a "Validate Slate Engine" panel with date picker + JSON output.

### Verification (after switching to default mode)
1. Run migration, then `SELECT column_name FROM information_schema.columns WHERE table_name='free_props'` to confirm new columns.
2. Deploy `slate-scanner` + `slate-validate`, then `curl` `/slate-validate?date=today` and paste the JSON summary (counts, top plays, sanity flags) into the final summary.
3. `SELECT bet_type, count(*) FROM daily_picks WHERE pick_date = current_date GROUP BY bet_type` to confirm game-lines are present alongside props.
4. Visual check at `/free-picks`, `/picks`, and the home Today's Edge carousel that game-line cards render with reasoning.

### Out of scope
Live in-game updates, parlay auto-construction, push notifications, model weight changes (uses existing per-sport models as-is).
