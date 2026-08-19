# Model Validation and Release Runbook

## Evidence contract

Sentinel may label a score as a probability or claim a measurable betting edge
only when all of the following are true:

1. The prediction was persisted before the recorded event commencement time.
2. The result was graded by the automated ESPN grader (`grading_source=espn:*`).
3. The prediction has an immutable `model_version`.
4. Calibration was fit and tested only on raw scores from that exact model
   version, using an untouched chronological holdout.
5. The persisted model-evaluation report clears its full-sample and latest
   chronological-holdout gates.

User-entered outcomes, missing timestamps, legacy rows without model versions,
post-start predictions, and silently reconstructed odds are excluded.

## Nightly order

1. `grade-picks` records verified results, profit, and available closing lines.
2. `calibrate-model` fits per sport, market, and exact model version at 06:30 UTC.
3. `model-evaluation` writes the read-only evidence report at 07:00 UTC.

The evaluation job never changes weights, activates models, or promotes picks.

## Evaluation output

Every run reports:

- hit rate with a Wilson 95% confidence interval;
- profit, ROI, a 95% normal-approximation interval, and maximum drawdown;
- average odds and average break-even probability;
- verified CLV coverage and mean CLV without imputation;
- Brier score, log loss, calibration error, and calibration bins;
- breakdowns by sport, market, tier, confidence tier, odds range, UTC month,
  and model version;
- a latest chronological holdout containing at least 50 resolved bets; and
- explicit exclusions and limitations.

Scheduled runs evaluate the newest 1,000 resolved immutable predictions by
default. If that cap is reached, the persisted report records
`input_truncated=true` and states the limit explicitly. Manual runs may request
up to 20,000 rows with `max_rows`.

Persisted model-evaluation requests return a compact execution summary by
default while retaining the complete evidence report in
`model_evaluation_runs`. Set `include_report=true` only for bounded interactive
diagnostics that need the full response body.

`releaseStatus=validated` is evidence, not a promise of future profitability.
Any other status prohibits an edge/profitability claim.

## Local validation

```powershell
npm test -- --run
npx tsc --noEmit
npm run build
npx esbuild supabase/functions/model-evaluation/index.ts --bundle --platform=neutral --format=esm --external:https://* --outfile=$env:TEMP\model-evaluation.mjs
```

## Production rollout (approval required)

Use a quiet maintenance window. Apply the additive migrations first, then
immediately deploy every function that embeds the changed shared
calibration/evaluation code. Until deployment finishes, existing workers fail
closed because legacy calibrations are deactivated; they must not promote Edge
picks from unversioned evidence.

```powershell
supabase db push
supabase functions deploy model-evaluation --no-verify-jwt
supabase functions deploy calibrate-model --no-verify-jwt
supabase functions deploy log-outcome
supabase functions deploy daily-picks --no-verify-jwt
supabase functions deploy process-analyzer-queue --no-verify-jwt
supabase functions deploy process-nba-analyzer-queue --no-verify-jwt
supabase functions deploy analyzer-worker-nba --no-verify-jwt
supabase functions deploy analyzer-worker-wnba --no-verify-jwt
supabase functions deploy analyzer-worker-mlb --no-verify-jwt
supabase functions deploy analyzer-worker-nhl --no-verify-jwt
supabase functions deploy slate-scanner-nba --no-verify-jwt
supabase functions deploy slate-scanner-wnba --no-verify-jwt
supabase functions deploy slate-scanner-mlb --no-verify-jwt
supabase functions deploy slate-scanner-nhl --no-verify-jwt
supabase functions deploy slate-scanner-ufc --no-verify-jwt
```

Then run dry/read-only checks before allowing scheduled persistence:

```powershell
supabase functions invoke calibrate-model --no-verify-jwt --body '{"days":365}'
supabase functions invoke model-evaluation --no-verify-jwt --body '{"days":365,"persist":false}'
```

Verify function logs and confirm that rebuilt model versions show
`insufficient_evidence` until their own samples accumulate.

## Rollback

1. Unschedule `model-evaluation-nightly` if the report job misbehaves.
2. Redeploy the previous function commit.
3. Keep versionless calibrations inactive; do not reactivate legacy rows.
4. The evaluation table is append-only operational evidence and can remain in
   place during a code rollback.
