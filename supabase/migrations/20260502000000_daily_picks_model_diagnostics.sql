-- Phase 1 — NBA playoff-aware diagnostics
-- Adds a nullable jsonb column on daily_picks for structured model diagnostics
-- (playoffMode, seriesSampleSize, seriesHitRate, seriesAverage, seriesFloor,
-- seriesCeiling, seriesMinutesAverage, seriesMinutesRange, playoffRecentAverage,
-- playoffRecentHitRate, lineCushion, rotationContextApplied, rotationRole,
-- rotationBoost, rotationCollision, minutesVolatility, dataQuality,
-- oddsLine, oddsAmerican, bestBook, bookCount, consensusLine,
-- impliedProbability, juicePenalty, marketDepth, marketDataQuality).
--
-- Idempotent. Nullable. No default. No backfill. No grading impact.
-- Old rows remain readable; existing INSERTs continue to work without supplying
-- the column.

ALTER TABLE public.daily_picks
  ADD COLUMN IF NOT EXISTS model_diagnostics jsonb;

COMMENT ON COLUMN public.daily_picks.model_diagnostics IS
  'Structured per-pick model/debug fields (playoff series, line cushion, '
  'rotation context, market depth, data quality). Never user-facing prose. '
  'Nullable for old rows and minimal inserts.';
