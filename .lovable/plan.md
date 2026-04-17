
## Plan: Curate Free Picks — quality over quantity

Replace the current "any edge ≥ 2%" firehose with a tiered, market-aware quality filter so Free Picks only surfaces high-conviction, high-value plays.

### Root cause
Current thresholds in `_shared/edge_scoring.ts` + `slate-scanner` are too permissive:
- Free Picks accepts confidence ≥ 0.65 with no edge floor and no market-reliability weighting.
- Game-line generator accepts edge ≥ 0.02 with projected_prob clamp down to 0.05 → surfaces longshot home/away ML picks and under-totals with thin signal.
- All prop markets treated equally — volatile markets (HRs, strikeouts, blocks, steals, threes) compete on the same threshold as stable ones (points, hits, rebounds, assists).
- Final ranking uses `edge × confidence` only — no penalty for low hit rate or low-reliability markets.

### Changes

**1. `_shared/edge_scoring.ts`** — introduce market reliability + composite quality score
- Add `MARKET_RELIABILITY` map (0.4–1.0):
  - High (1.0): NBA points/rebounds/assists, MLB hits, NHL SOG, moneyline (favorites only)
  - Mid (0.75): NBA threes/PRA, MLB total bases, NHL points, spreads, totals
  - Low (0.5): NBA steals/blocks, MLB HRs/strikeouts (under), longshot ML (+150+)
- New `qualityScore = confidence × reliability × (1 + edge) × hitRateFactor`
- Tier thresholds become market-aware:
  - Strong: confidence ≥ 0.72 AND edge ≥ 0.04 AND reliability ≥ 0.75
  - Lean: confidence ≥ 0.66 AND edge ≥ 0.03 AND reliability ≥ 0.6
  - Reject everything else
- Special rule: under-HR, under-K, longshot dog ML require confidence ≥ 0.78 AND edge ≥ 0.06

**2. `slate-scanner/index.ts`** — apply curated filters
- Game lines: raise edge floor to 0.035, drop projected_prob clamp floor to 0.35 (no longshot dogs), require qualityScore ≥ threshold.
- Player props pulled from `free_props` table: re-score with new module, drop anything below new tier gates.
- Cap Free Picks at top 20 by qualityScore (was 30), max 6 per sport, max 2 low-reliability picks total.
- Today's Edge: top 5 globally by qualityScore (was per-sport).

**3. `rankAndDistribute`** — sort by qualityScore (not raw score), enforce per-sport and per-reliability caps.

**4. Verification (after default mode)**
1. Deploy `slate-scanner` + `_shared/edge_scoring.ts`.
2. `curl /slate-scanner?dryRun=true&debug=true&seed=true` — confirm seed plays still pass new gates with their new qualityScore field surfaced.
3. `curl /slate-scanner?dryRun=true&debug=true` — paste counts per sport and top 5 with full math (confidence, edge, reliability, qualityScore).
4. Run live (non-dry) scan, then:
   ```sql
   SELECT sport, prop_type, direction, confidence, edge,
          ROUND((confidence*edge)::numeric, 4) AS legacy_score
   FROM free_props WHERE prop_date = current_date
   ORDER BY confidence DESC LIMIT 20;
   ```
   Confirm: zero `under home_runs` / `under strikeouts` unless conf ≥ 0.78, zero +200 ML dogs, total row count ≤ 20.
5. Visual check at `/dashboard/free-picks`.

### Out of scope
Pulling in new model factors (rest days, lineup splits) — that's a separate model upgrade; this PR is purely curation gates over current model output.
