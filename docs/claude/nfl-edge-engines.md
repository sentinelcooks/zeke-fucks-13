# NFL Edge Engines

Sentinel's NFL betting analysis is **two independent products**:

| | NFL Game Edge | NFL Player Prop Edge |
|---|---|---|
| Entry point | `calculate_nfl_game_edge()` — `_shared/nfl/game/index.ts` | `calculate_nfl_player_prop_edge()` — `_shared/nfl/prop/index.ts` |
| Markets | Moneyline, spread, game total | QB/RB/WR/TE/K props |
| Edge Function | `nfl-game-edge` | `nfl-player-prop-edge` |
| Model version | `NFL_GAME_MODEL_VERSION` (`game/weights.ts`) | `NFL_PROP_MODEL_VERSION` (`prop/weights.ts`) |
| Fitted params | `game/weights_fitted.ts` (generated) | `prop/weights_fitted.ts` (generated) |
| Confidence | `game_confidence` (`game/confidence.ts`) | `prop_confidence` (`prop/confidence.ts`) |
| Gates | `NFL_GAME_GATES_DEFAULT` + `app_config.nfl_game_edge_gates` | `NFL_PROP_GATES_DEFAULT` + `app_config.nfl_prop_edge_gates` |
| Predictions | `nfl_game_edge_predictions` | `nfl_player_prop_predictions` |
| Backtest | `scripts/nfl/backtest-game.ts` → `nfl_game_backtest_runs` | `scripts/nfl/backtest-prop.ts` → `nfl_player_prop_backtest_runs` |
| Live performance | `nfl_game_edge_performance` view | `nfl_player_prop_performance` view |
| Admin tab | NFL Game Edge | NFL Prop Edge |

## Independence rules (non-negotiable)

1. `_shared/nfl/game/` and `_shared/nfl/prop/` never import each other. They may import only their own modules, `_shared/nfl/data/` (raw data), `_shared/nfl/distributions.ts` (pure math), `_shared/prob_math.ts` and `_shared/thresholds.ts`. Enforced by `src/test/nfl_engine_isolation.test.ts`.
2. The prop engine's game script and expected team scoring come from the **sportsbook** spread/total, never from the game engine's projections. `nfl-player-prop-edge` never reads `nfl_game_edge_predictions`.
3. Never create a combined `calculate_nfl_edge()`. Never merge edge scores, average the two confidences, or mix game and prop bets in one metric, table or report.
4. Every change to fitted weights bumps that engine's model version. Calibration and evidence belong only to the exact version that produced them.

## Data layer (shared raw data)

- **Source:** nflverse public releases (play-by-play with EPA, weekly player stats, snap counts, injuries, schedules with closing lines).
- **Ingest:** `node scripts/nfl/ingest.ts [--seasons 2017-2026] [--no-upload]`, scheduled daily at 10:00 UTC by `.github/workflows/nfl-ingest.yml`. It needs the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` repo secrets.
  - It runs in Node, not an Edge Function. Play-by-play is about 200 MB per season, and Edge Functions have a ~2 s CPU budget.
- **Tables:** `nfl_games`, `nfl_team_week_features`, `nfl_player_week`, `nfl_injuries`, plus the view `nfl_position_allowed`. All have RLS on, service role only.
- **Markets:** `odds-snapshot` writes to `market_odds_snapshots`.
  - Game markets: `{sport:"nfl"}`, hourly.
  - Player props: `{sport:"nfl", props:true}`, 2–3× daily. This is about 13 markets × up to 16 events of Odds API credits per run.
  - Opening, current, best-available and closing prices are all derived from these snapshots.
- **Weather:** Open-Meteo forecast at the home stadium (`data/teams.ts`). Indoor games skip it.
- **Known limits:**
  - Route participation lags in nflverse; where it's missing, a flagged proxy is used (snap share × position route rate).
  - There are no coverage grades; opponent dropback EPA allowed to each position is used instead.
  - Pressure uses sacks + QB hits as a proxy.
  - Proxy factors are marked `proxy: true` and lower data quality.

## Game engine (25 factors)

Features are built point-in-time in `game/features.ts`: only rows strictly before the game's (season, week) are used.

- **Team ratings:** `game/ratings.ts` builds opponent-adjusted EPA and success-rate ratings, with recency-weighted, shrunk rates and an SRS rating.
- **Three separately fit models** (`game/models.ts`):
  - **Moneyline:** logistic ridge regression on home-minus-away features, giving P(home win).
  - **Spread:** ridge regression for the margin, then a key-number-weighted discrete margin distribution, giving P(cover) and P(push).
  - **Total:** ridge regression for the total minus league scoring, then a key-number-weighted discrete total distribution. A drives × points-per-drive estimate serves only as an agreement check.
- **Market movement (factor 25):** a small, capped prior (`MARKET_MOVEMENT_PRIOR`). nflverse history has closing lines only, so this factor can't be fit.
- **Output per market side:** `model_probability` (push-excluded), `push_probability`, `market_probability`, `no_vig_probability`, `fair_price`, `market_price` (best available), `edge_percentage`, `expected_value` (with push refunds), `confidence`, `projected_score`, `projected_margin`, `projected_total`, `status`, `no_play_reasons`.

## Prop engine (33 factors)

- **Opportunity × efficiency** (`prop/projection.ts`):
  1. Expected team plays (team pace × opponent pace × market-implied team total).
  2. Team pass rate, adjusted for market game script and weather.
  3. The player's snap share, routes, and target or rush share. Shares are blended over L3/L5/season/prior-season windows with shrinkage, and injured teammates' vacated shares are redistributed.
  4. Per-opportunity efficiency, shrunk to position priors and adjusted for the opponent's position-specific production allowed, opponent unit EPA, the QB, the OL and weather.
- **Distributions per stat** (`prop/stat_models.ts`, using `nfl/distributions.ts`):
  - Negative binomial for targets, carries and attempts; attempts use an early-exit mixture.
  - Binomial thinning for receptions and completions.
  - Zero-inflated gamma, matched to compound-sum moments, for yards.
  - Poisson for TDs and INTs.
  - Exact 3·FG ⊕ XP convolution for kicking points.
- **Every prop returns** mean, median, SD, p10 and p90, plus P(over), P(under) and P(push).
- **Train-fitted level calibration** (`params.scale`) removes systematic bias. Dispersion is fit by likelihood on train seasons only.

## Gating (both engines, separately)

Every result is persisted as PLAY or NO PLAY; picks are never forced.

**Game gates:**
- edge ≥ min
- edge ≤ `max_edge` (implausible-edge guard)
- EV > 0
- confidence ≥ min
- data quality ≥ min
- no unresolved QB / 2+ starter Questionable
- **proven profitable:** a walk-forward backtest evidence gate (`weights_fitted.ts` → `evidence_gates`) OR a forward test meeting `NFL_PROMOTION_RULE`. Failing only this gate makes the prediction a graded shadow pick.

**Prop gates:**
- the side has a sportsbook price
- player not Out/Doubtful (and not Questionable unless allowed)
- edge within [min, `max_edge`]
- EV > 0
- confidence ≥ min
- sample ≥ min games
- role stable (snap-share CV)
- price cap
- **proven profitable:** the prop type's forward test meets `NFL_PROMOTION_RULE` (≥ 150 graded picks, ROI > 0, average CLV > 0). Failing only this gate makes the prediction a graded shadow pick.

## Backtesting

| | Game (`backtest-game.ts`) | Prop (`backtest-prop.ts`) |
|---|---|---|
| Protocol | Walk-forward: test season S is fit on seasons < S; calibration is fit on out-of-sample predictions from earlier seasons | Dispersion and scale fit on 2021–22; evaluated on 2023–25 |
| Market | nflverse closing lines (so CLV is 0 by construction) | None: there are no free historical prop prices |
| Metrics | ML accuracy, Brier, log loss vs the market's; ATS; totals O/U; gated ROI; calibration; edge and confidence buckets; evidence gates | MAE, RMSE, bias, randomized-PIT ECE and over-probability calibration per prop type; proxy-line results, labelled as not market evidence |
| Live metrics | Graded PLAYs in `nfl_game_edge_predictions` | Graded PLAYs in `nfl_player_prop_predictions` (hit rate, ROI, CLV by prop type, position, edge bucket, confidence bucket) |

Regenerate the weights with `--write-weights` (bump the model version first), then `--upload` the run so the admin panel and the confidence calibration input can see it.

### v1 results

**Game, `nfl-game-edge-v1`** (2021–2025 walk-forward vs closing lines):
- **Moneyline:** 64.4% accuracy. Brier 0.2255 vs the market's 0.2115.
- **Spread:** 50.0% ATS across all games. Margin MAE 10.1.
- **Totals:** 51.1% O/U across all games. Total MAE 10.5.
- **Gated picks:** lose money in every market, so all three `evidence_gates` are null. **v1 publishes no game PLAYs.**
- **Calibration:** out-of-sample Platt calibration flattens spread and total probabilities toward 50%, because they carry almost no information beyond the closing line.

**Props, `nfl-prop-edge-v1`** (2023–25 out of sample):
- Bias is about 0 for every prop type.
- PIT ECE is ≤ 0.08 for all types except passing yards (0.11).

## App surfaces (same UI as the other sports)

- **Analyze → Game Lines → NFL:** identical flow to MLB/WNBA — scan screen, full-game report, per-market Analyze. NFL routes through `src/lib/nflGameEdgeAdapter.ts`, which converts `nfl-game-edge` output into the shared `GameAnalysisResponse` contract.
  - `nfl-game-edge` answers all three markets in one call, so `GameLinesBrowser` caches the response per event (`NFL_RESPONSE_TTL_MS`) and adapts it per market/side instead of calling the model six times.
  - Unproven markets adapt as `score_kind: "heuristic_score"`, `conviction_tier: "noBet"`, `recommended_units: 0`, so the report shows a directional lean and never a staking recommendation. A `status: "PLAY"` market adapts as `calibrated_probability` with units, i.e. a real recommendation.
  - The team directory for NFL is built client-side from `listNflTeams()`; `moneyline-api/teams` has no NFL.
- **Analyze → Player Props → NFL:** the standard analyzer (search, stat-type tabs, direction, line, opponent) calling `nfl-player-prop-edge`; results render in `src/components/nfl/NflPropAnalysisCard.tsx`. Opponent is auto-detected from the schedule.
- **Games tab:** NFL is a normal sport filter; "Analyze Matchup" deep-links into Game Lines.
- **`/dashboard/nfl`:** published (proven) NFL picks only.

## Publishing policy: proven-profitable only (owner directive 2026-09-22)

This replaces the earlier "live but unvalidated" exception.

- **What users see:** only proven PLAYs. `nfl-game-edge` and `nfl-player-prop-edge` return nothing else to users. `src/pages/NflEdgePage.tsx` shows "forward testing" until a market is proven.
- **What counts as proven:** a market or prop type is proven when EITHER of these holds:
  - The walk-forward backtest finds a profitable edge threshold (`evidence_gates` in `game/weights_fitted.ts`; game markets only).
  - Its forward test meets `NFL_PROMOTION_RULE` (`_shared/thresholds.ts`): **at least 150 graded picks, ROI > 0 and average CLV > 0**, counted once per game/market or player/prop (first qualifying scan).
- **What happens before that:** a prediction that passes every gate except the proof gate is stored as `status = 'NO PLAY', shadow_play = true`.
  - Shadow picks are graded at the real price taken, with closing line and CLV.
  - The views `nfl_game_edge_forward_test` and `nfl_player_prop_forward_test` feed the proof gate automatically.
- **Where to watch:** the forward test is visible only to admins, on the NFL Game Edge and NFL Prop Edge tabs.
- **Why the forward test matters:** the historical backtest can only use closing lines, the hardest benchmark. Live picks are taken earlier in the week, so the forward test is the honest measure of whether real edge exists.

### Pre-registered variant experiment (`scripts/nfl/experiment-game.ts`, 2026-09-22)

- **Protocol** (fixed before results were seen):
  - Development seasons 2021–23 choose one variant per market.
  - The 2024–25 holdout is tested once.
  - Ship only if development ROI > 0, holdout ROI > 0 and ≥ 100 holdout bets.
- **Variants:**
  - V0: raw v1 model.
  - V1: market-residual logistic layer.
  - V2: V1 with an edge ≥ 5% threshold.
  - V3: V1 with a model-vs-market disagreement filter.

| Market | Chosen on dev | Dev ROI (95% CI) | Holdout ROI | Shipped |
|---|---|---|---|---|
| Moneyline | V3 | +6.2% (−8.8, +21.1) | −10.8% (128 bets, 57.0% hit) | No |
| Spread | V3 | +4.6% (−8.0, +17.1) | −5.3% (110 bets, 49.1% hit) | No |
| Total | V1 | +2.7% (−4.6, +10.0) | −13.7% (303 bets, 44.9% hit) | No |

**Conclusion:** none of the models beats nflverse closing lines. Development "profits" were noise (every CI included 0) and reversed on the holdout.

The holdout has now been used. Any future variant needs **new** out-of-sample data before it can ship: the 2026+ forward test, or historical pre-close odds.

Player props have no historical prices, so their profitability can only be established by the forward test (or by purchased historical prop odds).

## Operations

```bash
node scripts/nfl/ingest.ts --seasons 2017-2026     # local backfill (cache in .cache/nfl)
node scripts/nfl/backtest-game.ts --write-weights  # refit game models
node scripts/nfl/backtest-prop.ts --write-weights  # refit prop distributions
node scripts/nfl/smoke.ts 2026 3                   # both engines on a real week, locally
npx tsc -p tsconfig.nfl.json                       # strict typecheck of engines + scripts
```

Deploy (after `supabase db push`):

```bash
supabase functions deploy nfl-game-edge
supabase functions deploy nfl-player-prop-edge
supabase functions deploy nfl-grade --no-verify-jwt
supabase functions deploy nfl-admin-analytics
supabase functions deploy odds-snapshot --no-verify-jwt
supabase functions deploy nba-odds
```
