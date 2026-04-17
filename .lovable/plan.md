

## Root cause

Free Picks is empty because of **two compounding issues**:

1. **`free_props` table is empty across all dates** — the `free-props` cron hasn't been writing rows. The previous tightening session also added a `slate-scanner` line that *deletes* `free_props` rows where `bet_type != 'prop'` on every run, but the upstream cron isn't producing prop rows in the first place. Whether the cron is missing, disabled, or silently failing, the result is the same: no source data.

2. **Confidence-scale mismatch in the new quality gates**. `free-props` writes `confidence` as `avgProb * 100` (an implied-probability in the 45–60 range, not a model hit-rate). The new `tierVerdict` in `_shared/edge_scoring.ts` requires `confidence ≥ 0.66` (Lean) or `≥ 0.72` (Strong). Even if the table had rows, virtually nothing would pass — implied probability ≈ 50% is *not* the same as model conviction. The previous "tighten" PR treated them interchangeably.

So even fixing the empty-table problem alone wouldn't help — every row would still fail the gate.

## Fix

**A. `supabase/functions/free-props/index.ts` — derive a real model-side confidence and surface meaningful edge**
- Today: `confidence = avgProb * 100` (consensus implied prob). That's a market number, not a model number.
- Change: compute `confidence` as `avgProb + 0.5 * edgeFraction` clamped to [0, 1], stored as 0–1 scale. This treats *line shopping edge* as proxy conviction (the larger the deviation from consensus, the higher the confidence the favorable side wins).
- Lower the raw inclusion floor: keep books-≥-2 requirement, drop the `edge >= 0.5` (percent-point) cutoff to `>= 1.5` to reduce noise at source.
- Cap output per sport to 40 raw rows (scanner re-curates).

**B. `supabase/functions/_shared/edge_scoring.ts` — recalibrate gates to match real confidence distribution**
- Strong: `confidence ≥ 0.62 AND edge ≥ 0.03 AND reliability ≥ 0.75`
- Lean:   `confidence ≥ 0.56 AND edge ≥ 0.02 AND reliability ≥ 0.6`
- Volatile/longshot gate: `confidence ≥ 0.68 AND edge ≥ 0.05` (was 0.78 / 0.06 — still strict but achievable).
- Keep market-reliability map and per-sport / low-reliability caps unchanged.
- Keep Free Picks cap at 20, but raise per-sport cap to 8 so a hot NBA night isn't artificially capped to 6.

**C. `supabase/functions/slate-scanner/index.ts` — treat `free_props` as input AND ensure props get persisted back**
- Currently: only `bet_type != 'prop'` rows are written by scanner (game lines). Props are read-only from cron output. That's fine *if* the cron runs.
- Change: trigger `free-props/generate` from the scanner if `propsFetched === 0` for any sport, then re-read. This guarantees the scanner is self-sufficient and not gated on a separate cron firing.
- After re-read, re-score all props through the new gates and rewrite the curated subset to `free_props` (delete-then-insert today's rows).
- This makes Free Picks deterministic: every scanner run produces a fresh, curated table.

**D. Add a manual one-shot trigger so we can recover today**
- Call `free-props/generate` then `slate-scanner` immediately after deploy, in default mode.

## Verification (after default mode)

1. `curl -X POST .../free-props` body `{"path":"generate"}` — confirm `count > 0` per sport in response.
2. `curl .../slate-scanner?dryRun=true&debug=true` — confirm `debug.{nba,mlb,nhl}.propsFetched > 0` and `freePicks > 0`.
3. `curl .../slate-scanner` (live write) — confirm `counts.freePicks > 0`.
4. SQL:
   ```sql
   SELECT sport, bet_type, count(*),
          round(avg(confidence)::numeric,3) AS avg_conf,
          round(avg(edge)::numeric,3) AS avg_edge
   FROM free_props WHERE prop_date = current_date GROUP BY 1,2;
   ```
   Confirm: at least 5–20 rows, avg confidence ≥ 0.55, no `direction='under' prop_type='home_runs'` with confidence < 0.68.
5. Visual check at `/dashboard/free-picks`.

Paste raw outputs from all five steps in the final summary.

### Out of scope
Adding rest/lineup factors to the prop model (separate model upgrade), UFC game-line evaluation, schedule cron rewiring.
