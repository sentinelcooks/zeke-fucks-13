
The user is asking about the "Today's Edge" model — how picks get into that section. This is a research/explanation request, not an implementation task.

From prior context + the network requests + `_shared/edge_scoring.ts`:

- Home screen queries `daily_picks` for today, ordered by `hit_rate desc` (limit 40).
- The `tier` column ('edge' vs 'daily') is already set by the `daily-picks` edge function.
- From the live data: 5 picks have `tier: "edge"` (top 5 by hit_rate, all ≥ 0.764), rest are `tier: "daily"`.
- Frontend filter: `hrOk` = hit_rate ≥ 0.5 (decimal) or ≥ 50 (percent), then displays the top 5 with `tier === "edge"` in the Today's Edge carousel.

Pipeline (Today's Edge specifically):
1. **Shortlister** — `google/gemini-3-flash-preview` ranks games + picks 4–5 candidate players per game from active ESPN rosters.
2. **Grader** — In-house deterministic models (`nba-api`, `mlb-model`, `nhl-model`) compute `hit_rate` (confidence) using a 20-factor weighted engine: L5/L10/season vs opponent, rest, travel, pace, defense vs position, injuries.
3. **Odds attach** — The Odds API → American odds + line.
4. **Scoring** — `_shared/edge_scoring.ts` computes `quality_score = confidence × reliability × (1 + edge) × hitRateFactor` and tags verdict (Strong / Lean / Pass).
5. **Tiering** — Top 5 by `quality_score` with `verdict === "Strong"` get `tier = "edge"`. Threshold today: hit_rate ≥ ~0.76 + Strong verdict.
6. **Display** — Home carousel shows `tier === "edge"`, color-coded by 4-tier confidence (≥75% green, etc per `todays-edge-carousel` memory).

This is just an explanation — no plan/implementation needed. I'll answer directly without a plan tag.
