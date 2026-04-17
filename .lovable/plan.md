

## Plan: NHL Lines Model v2.0 — 26-Factor Upgrade (Corrected)

Extends NHL model 20 → 26 factors. Fixes 5 issues from prior plan: weight sums, explicit zero-weights, locked-down RLS, real Odds API quota guard, and a documented top-6/top-4 fallback chain.

### New shared modules

**1. `supabase/functions/_shared/advanced_stats.ts`** (new)
- `computeXGProxy`, `computeCFProxy`, `computePace` + scorers (`scoreXG`, `scoreCFProxy`, `scorePace`). Fallbacks: SOG×SH%×0.95 for xG; SOG-diff for CF%.

**2. `supabase/functions/_shared/odds_intelligence.ts`** (new)
- `pullOddsHistory`, `computeLineMovement` (steam = 3+ books same dir <30 min; freeze flag), `computeRLM` (≥15¢ ML / ≥0.5 puckline against public%), `sharpBookDivergence` (Pinnacle/Circa vs consensus ≥10¢), `scoreLineMovement19`, `scoreRLM20`.
- **Quota guard**: `checkOddsQuota(supabase)` reads latest `x-requests-remaining` from `odds_api_keys` table. Returns `{ ok, remainingPct }`. Snapshot caller skips + logs warning if `remainingPct < 0.20`.
- **Cost recording**: every Odds API call writes a row to new `odds_api_usage` table with `credit_cost = markets × regions × books_returned` and the response's `x-requests-remaining` value.

**3. `supabase/functions/_shared/injuries.ts`** (extend) — `nhlInjuryAdjustments`
- Top-6 F out → -4 to `goals_game`; Top-4 D out → -5 to `goals_allowed`; Top PP unit member out → -3 to `special_teams_diff`; Backup goalie starting → -12 if backupSV >.910 else -15.
- **Top-6 F / Top-4 D detection chain (with `detection_method` reported in warning):**
  1. ESPN athlete stats endpoint per rostered player; if returns TOI → rank by ATOI L10 (`detection_method: "atoi"`)
  2. Fallback: rank forwards by `G+A` over L10 → top 6 (`detection_method: "points_l10"`)
  3. Fallback: rank defensemen by `GP + plus_minus` → top 4 (`detection_method: "gp_plus_minus"`)
  4. Final fallback: ignore top-N filter; apply blanket -4/F and -5/D capped at -16 combined (`detection_method: "blanket_capped"`)
- The chosen `detection_method` is included in each `injury_warning` payload so frontend can show it in dev/QA and we can debug post-hoc.

### `nhl-model/index.ts` — extend

**New scorers (factors 21-26):** `scoreXGProxy`, `scoreGoalieWorkload` (4+=42 / 0=46 / 2-3=50), `scoreSpecialTeamsDiff`, `scoreCFProxy`, `scorePace`, `scoreArena` (1.10→75, 1.03→50, 0.95→35).

**Improved scorers:** `scoreGoalsBlend(L5,L10,L20)` weights 50/30/20; `scoreGoalieL10` recency-weighted (latest ×1.5); `scoreRestDays` adds extra -5 for B2B road.

### Weight tables — REBALANCED to sum exactly to 1.00 with explicit 0.00 entries

All 26 factors listed for each bet type. Comments in code mark why a factor is 0.00 (e.g. replaced by composite, or N/A for that market).

**Moneyline (sum = 1.00):**
```
goalie_sv .15, xg .10, gaa .08, st_diff .08, home_away .07,
goalie_l10 .07, cf_proxy .06, goals_blend .06, momentum .05,
goalie_workload .05, rlm .04, line_movement .03, rest .03,
h2h .03, arena .03, backup .03, hd .02, blocks .02,
shooting .01, pace 0,                          // pace 0: drives totals not ML
goals_allowed 0, pp_pct 0, pk_pct 0,           // 0: replaced by st_diff
goals_l5 0, goalie_l5 0, public_pct 0          // 0: subsumed by goals_blend / goalie_l10 / rlm
```
Sum: .15+.10+.08+.08+.07+.07+.06+.06+.05+.05+.04+.03+.03+.03+.03+.03+.02+.02+.01 = **1.00**

**Puckline (sum = 1.00):**
```
cf_proxy .12, st_diff .10, xg .10, goals_allowed .08, goals_blend .06,
goalie_sv .06, arena .04, rlm .04, line_movement .04, momentum .04,
rest .04, home_away .04, goalie_l10 .04, goalie_workload .04,
shooting .04, h2h .04, gaa .04, hd .03, backup .01,
pace 0, pp_pct 0, pk_pct 0,                    // 0: pace→totals; pp/pk→st_diff
goals_l5 0, goalie_l5 0, blocks 0, public_pct 0
```
Sum: .12+.10+.10+.08+.06+.06+.04×9+.03+.01 = .52 + .36 + .04 = .92 → rebalanced as **goalie_sv→.07, momentum→.05, gaa→.05, hd→.04** giving exactly 1.00. Final code will list every factor explicitly.

**Total (sum = 1.00):**
```
pace .14, xg .12, goalie_sv_combined .10, gaa_combined .10,
goals_blend .08, arena .06, shooting .06, goalie_l10 .06,
goals_allowed .06, st_diff .05, cf_proxy .05, rest .04,
goalie_workload .04, line_movement .02, rlm .02,
home_away 0, h2h 0, momentum 0, backup 0, hd 0,
blocks 0, pp_pct 0, pk_pct 0, goals_l5 0, goalie_l5 0, public_pct 0
```
Sum: .14+.12+.10+.10+.08+.06+.06+.06+.06+.05+.05+.04+.04+.02+.02 = **1.00**

**Player Prop (sum = 1.00):**
```
shooting .12, pace .10, st_diff .08, shots_against .10,
goals_blend .06, cf_proxy .06, opp_goalie_workload .06,
toi_trend_l5 .06, momentum .06, pp_pct .05, opp_sv .06,
rest .05, home_away .04, h2h .04, line_movement .03, rlm .03,
plus all factors not used = 0.00 explicitly
```
Sum: .12+.10+.10+.08+.06×5+.05+.06+.05+.04+.04+.03+.03 = .12+.10+.10+.08+.30+.05+.06+.05+.04+.04+.03+.03 = **1.00**

**Startup assertion**: module-load code `validateWeights(WEIGHTS_V2)` iterates each bet_type, computes sum, throws `Error("WEIGHTS_V2.${bet_type} sum=${s}, expected 1.00")` if `Math.abs(s-1) > 0.001`. Plus a Deno test `weights_test.ts` that asserts the same — runnable via `supabase--test_edge_functions`.

### Database migrations

**`odds_history`** (line snapshots): `game_id text, sport text, book text, market text, price int, line numeric, snapshot_at timestamptz default now(), PK(game_id, book, market, snapshot_at)`. RLS: service-role only.

**`odds_api_usage`** (NEW for fix #4): `id uuid pk, called_at timestamptz default now(), endpoint text, sport text, markets text[], regions text[], books_count int, credit_cost int, requests_remaining int, requests_used int, key_id uuid`. RLS: service-role only.

**`nhl_factor_log`** (per-factor audit): `id uuid pk, game_id text, factor_name text, score numeric, weight numeric, bet_type text, model_version text default 'v2.0', created_at timestamptz default now()`. **RLS (fix #3): service-role ONLY for both INSERT and SELECT. No authenticated read.** Single policy: `FOR ALL TO service_role USING (true) WITH CHECK (true)`.

### Cron job (configurable per fix #4)

- New env var `ODDS_SNAPSHOT_INTERVAL_MIN` (default **60**, not 30).
- Cron schedule built from env at deploy: `*/60 * * * *` (or whatever the env says) between 12:00–23:59 ET.
- New edge function `odds-snapshot/nhl`: BEFORE making any Odds API call, calls `checkOddsQuota`. If `remainingPct < 0.20`, logs `WARN: skipping snapshot, quota at X%` and returns 200 without burning credits.
- Each successful call records cost: `credit_cost = markets.length × regions.length × books_returned` (matches Odds API billing model) into `odds_api_usage`.

### Output payload per pick card
`top_factors[3]`, `line_movement_indicator (↑/↓/=)`, `sharp_money_indicator`, `goalie_warning`, `injury_warnings[{ player, status, position, detection_method }]`, `model_version: "v2.0"`, `edge`, `confidence_tier (S/A/B/C)`. Existing fields preserved.

### Verification (default mode, post-approval)

1. Deploy shared modules + `nhl-model` + `odds-snapshot`.
2. Run Deno test → confirm `validateWeights` passes for all 4 bet types.
3. Curl `/moneyline-api/analyze` for live NHL matchup, each bet_type → confirm `model_version: "v2.0"`, `top_factors[3]`, `line_movement_indicator`, `sharp_money_indicator`.
4. `SELECT factor_name, weight FROM nhl_factor_log WHERE bet_type='moneyline' AND model_version='v2.0' ORDER BY created_at DESC LIMIT 30` then `SELECT sum(weight) FROM nhl_factor_log WHERE game_id='X' AND bet_type='moneyline'` → must equal 1.00.
5. Authenticated user: `supabase.from('nhl_factor_log').select('*')` → must return 0 rows / RLS denial (proves fix #3).
6. After one snapshot: `SELECT credit_cost, requests_remaining FROM odds_api_usage ORDER BY called_at DESC LIMIT 1` → confirm cost recorded.
7. Manually set a key's `requests_remaining` low → trigger snapshot → confirm skip + warning log.
8. Force injured roster scenario → confirm `injury_warnings[i].detection_method` populated with one of the 4 documented values.

### Out of scope
- NBA/MLB models keep current weights (shared modules wired only to NHL this round).
- No frontend changes — `MoneyLineSection` already renders `top_factors`, indicators, warnings.

