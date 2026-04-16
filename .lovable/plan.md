

## Plan: Backend Refactor — Prediction/Decision Split + Snapshot Logging + Quality Flags

### Scope
Backend only. Modify `supabase/functions/nba-api/index.ts`, create 2 new tables, create 1 new edge function. No frontend changes.

### 1. Database Migrations

**Migration A — `prediction_snapshots`**
- Schema as specified, with RLS policy `auth.uid() = user_id`
- Service role bypass policy (for edge function inserts when user_id is null/server-side)
- Indexes: `(sport, market_type)`, `(created_at)`, `(user_id)`, `(verdict)`

**Migration B — `outcomes`**
- Schema as specified with FK to `prediction_snapshots`
- RLS: user-scoped + service role
- Indexes: `(sport)`, `(user_id)`, `(actual_result)`

Note: `auth.users` FK is allowed per spec but user_id will be nullable since edge functions may insert without an authenticated user context (analyzer can run server-side).

### 2. `nba-api/index.ts` Refactor

Add three new types and helpers near the top:
- `PredictionOutput`, `DecisionOutput`, `DataQualityReport` interfaces
- `validateDataQuality(playerData, injuryData, gameData)` → applies penalty to raw confidence
- `buildDecisionOutput(prediction, americanOdds, stake=100)` → computes implied prob (vig-removed via 2-way), EV, EV%, verdict, unit size
- `applyJuicePenalty(confidence, americanOdds)` → display-only adjustment inside decision layer
- `detectMlbPropCategory(propType)` + `MLB_PROP_WEIGHTS` table
- `logSnapshot(supabase, payload)` → fire-and-forget insert into `prediction_snapshots`

**Verdict thresholds** (decision layer):
- `STRONG`: confidence ≥ 70 AND evPercent ≥ 5
- `LEAN`: confidence ≥ 60 AND evPercent ≥ 2
- `SLIGHT`: confidence ≥ 55 AND evPercent > 0
- `PASS`: otherwise

**Unit sizing**:
- 2u: STRONG + evPercent ≥ 8
- 1.5u: STRONG or (LEAN + evPercent ≥ 5)
- 1u: LEAN/SLIGHT
- 0u: PASS

**Variance** derived from factor agreement: stddev of factor scores → low (<10), medium (10-20), high (>20).

**Consensus floor removal**: search `calculateConfidence` and `calculateMlbPropConfidence` for any `Math.max(confidence, 80)` style floors and remove. Keep only natural [0,100] clamp.

**MLB prop-type weights**: in `calculateMlbPropConfidence`, call `detectMlbPropCategory(propType)` and select the matching weight set from `MLB_PROP_WEIGHTS`. Existing factor calculations stay; only the weight multipliers swap.

**Snapshot logging**: at the end of `/analyze` POST handler in nba-api, after building the response, call `logSnapshot(...)` without `await` (fire-and-forget). Same hook added at end of analysis paths in `mlb-model`, `nhl-model`, `ufc-api`, `moneyline-api` — minimal touch, just the logSnapshot call + DataQuality penalty + decision-layer build.

**Reasoning warnings**: prepend quality flags to the reasoning string when present (lineup unconfirmed, small sample, stale injury, no historical data, juice penalty).

### 3. New Edge Function — `log-outcome`

`supabase/functions/log-outcome/index.ts`:
- POST `{ snapshot_id, actual_result, actual_value, profit_loss }`
- Zod validation
- Insert into `outcomes`
- Update `prediction_snapshots` SET `actual_outcome=actual_result`, `outcome_logged_at=now()` WHERE id=snapshot_id
- Compute and return stats:
  - `overall_hit_rate` (HIT / (HIT+MISS), excluding PUSH)
  - `by_sport: { nba, mlb, nhl, ufc }`
  - `by_confidence_bucket: { "50-60", "60-70", "70-80", "80+" }` (joins outcomes → snapshots)
- CORS headers, no JWT verify (matches existing pattern)

### 4. Touch List

| File | Action |
|------|--------|
| `supabase/migrations/<ts>_prediction_snapshots.sql` | Create |
| `supabase/migrations/<ts>_outcomes.sql` | Create |
| `supabase/functions/nba-api/index.ts` | Refactor: add types, validateDataQuality, buildDecisionOutput, applyJuicePenalty, MLB_PROP_WEIGHTS, snapshot logging, remove consensus floors |
| `supabase/functions/mlb-model/index.ts` | Add buildDecisionOutput + snapshot log + remove floors |
| `supabase/functions/nhl-model/index.ts` | Add buildDecisionOutput + snapshot log + remove floors |
| `supabase/functions/ufc-api/index.ts` | Add buildDecisionOutput + snapshot log + remove 22-78% clamp |
| `supabase/functions/moneyline-api/index.ts` | Add buildDecisionOutput + snapshot log + remove floors |
| `supabase/functions/log-outcome/index.ts` | Create new function |

### 5. Backwards Compatibility

The existing response shape from `/analyze` is preserved. New fields `prediction`, `decision`, `dataQuality`, `flags` are **added** alongside existing `confidence`, `verdict`, `reasoning`, `factorBreakdown`. Frontend continues reading current fields; can opt into new fields later. No breaking changes.

### 6. Out of Scope (Per User Constraints)

- Calibration layer (isotonic/Platt) — needs historical data first
- ML training pipeline — defer until snapshots accumulate
- Frontend display of new fields — explicitly excluded
- Closing line tracking — separate cron, not in this scope

