
The user reports 1% hit-rate plays are still leaking into Today's Edge. I need to audit the live path end-to-end, find the leak, and fix it. Let me explore first.
<lov-tool-use id="toolu_vrtx_01CY9GmvvrgGPF9gSSgRmvqd" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/daily-picks/index.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_019CXb6GpLo886gEBwR85z8E" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/free-props/index.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01LHzJo5XGDwe78qCdeh1a4y" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/home/ModernHomeLayout.tsx\", \"lines\": \"1-200\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01HqCLT3f4qL1CdYtQJsEBof" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/daily-picks/index.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01LswYkvVS7uvcJySbFPdMnQ" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/free-props/index.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_013K3pJST7KJtRr4KeipD242" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT player_name, sport, prop_type, line, hit_rate, odds, tier, bet_type FROM daily_picks WHERE pick_date = CURRENT_DATE ORDER BY tier DESC, hit_rate DESC LIMIT 30;\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01FKV8XTvc5xSWvuabDGpMKY" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT player_name, sport, prop_type, line, confidence, edge, odds, created_at FROM free_props WHERE prop_date = CURRENT_DATE ORDER BY confidence DESC LIMIT 30;\"}">
</lov-tool-use>
Key findings: The DB picks are actually clean (all confidence ≥ 0.616, no 1% hit-rate junk). But the **5 "edge" picks are all +4000 to +7500 longshots on hits 0.5** — these should be caught by the longshot gate (odds ≥ +250 needs confidence ≥ 0.72 AND edge ≥ 0.06). Confidence is 0.76+ so they pass, but the user's complaint is they look like junk longshots.

Let me view the rest of daily-picks (the orchestrator + persist) and check the longshot gate in edge_scoring.
<lov-tool-use id="toolu_vrtx_01H4QWYNivBtpVo6UfU3V8V7" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/daily-picks/index.ts\", \"lines\": \"439-786\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01KsJyJ4VWA1qPitJSCZ6gm2" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/home/ModernHomeLayout.tsx\", \"lines\": \"1-120\"}">
</lov-tool-use>
Now let me check the home query (where edge picks come from) and the edge_scoring's longshot gate:
<lov-tool-use id="toolu_vrtx_01XnrWhhByJ8k72y5yKkNrTE" name="code--search_files" integration-id="code" data="{\"query\": \"tier.*edge|daily_picks.*select|from\\\\(\\\"daily_picks\\\"\\\\)\", \"search_dir\": \"src/components/home\"}">
</lov-tool-use>
I now have the full picture. Let me present the plan.

<lov-plan>

## Diagnosis

Live DB inspection shows: **no 1% picks exist**. All 16 rows for today have `hit_rate ∈ [0.62, 0.80]`. The actual problem is different from the user's framing — but the *experience* matches: **Today's Edge is dominated by garbage longshots** (hits 0.5 at +4000 to +7500). Five of the five edge picks are MLB hits-0.5 longshots:

```
Jung Hoo Lee  hits 0.5  +4000  conf 0.799
Ryan O'Hearn  hits 0.5  +7500  conf 0.775
Maikel Garcia hits 0.5  +6000  conf 0.772
Bryan Reynolds hits 0.5 +6000  conf 0.767
Ozzie Albies  hits 0.5  +5000  conf 0.764
Adolis Garcia hits 0.5 +10000  conf 0.756  (daily, but same junk)
```

These slip through because confidence is ≥0.72 and edge is huge (~+0.48). They're ALSO mathematical artifacts: when implied prob is ~2% (+5000) and projected prob is 76%, edge = 0.74. The model is computing nonsense `confidence` for hits-0.5 (it's near-certain *any* MLB hitter records ≥1 hit, so the model returns ~80%, but the market knows this isn't at 0.5 hits — it's a different prop than what the model graded).

Three real bugs:

1. **Line/odds mismatch**: `analyzePlayerProp` returns `result.line` from the model (e.g. true line 1.5), but `fetchRealOdds` returns the best odds for that direction *across all available lines* — when it picks +5000 odds, that's an alt-line of 0.5, not the model's line. So we're stapling alt-line longshot odds to a model that graded a different line.
2. **Front-end fallback override**: `setTodayPicks(sortByPref(edgeTier.length > 0 ? edgeTier : allToday.slice(0, 5)))` — if `tier="edge"` is empty, it falls back to top-5 by hit_rate regardless of gating. This is a stale-pick rescue path.
3. **Sanity caps**: nothing caps maximum odds in `tierVerdict` — confidence 0.72 + edge 0.06 still lets +10000 through.

## Fix (3 files, no schema changes)

### 1. `supabase/functions/daily-picks/index.ts`
- **Bind odds to the graded line**: in Phase B, after `analyzePlayerProp` returns `result.line`, call `fetchRealOdds` *for that exact line* (pass `line` to nba-odds and only accept the price for the matching `point`). If no book offers that exact line, **drop the candidate** — do not fall back to alt-line odds.
- **Add a hard sanity cap**: drop any candidate where `Math.abs(impliedProb - projectedProb) > 0.40` (mathematically-impossible gap — a sign of line/market mismatch).
- **Per-prop-type dedupe**: keep only the best direction (over OR under) per `(player, prop_type)` so we don't have both sides surviving.

### 2. `supabase/functions/_shared/edge_scoring.ts`
- **Cap longshot odds**: in `tierVerdict`, hard-reject `odds >= 500` regardless of confidence (anything +500 or longer = "Pass"). This kills the +4000–+10000 hits-0.5 tier entirely. The user explicitly said "no absurd longshots."
- **Tighten `isLongshot` band**: keep the +250 elite gate (conf ≥ 0.72, edge ≥ 0.06) for +250 to +499 only.
- **Drop low-reliability cap to 0** in `rankAndDistribute` (no low-reliability picks at all in Free Picks).

### 3. `src/components/home/ModernHomeLayout.tsx`
- **Remove the silent fallback** at lines 292-293. Replace:
  ```
  edgeTier.length > 0 ? edgeTier : allToday.slice(0, 5)
  edgeTier.length > 0 ? dailyTier : allToday.slice(5)
  ```
  with:
  ```
  edgeTier
  dailyTier
  ```
  If no `tier="edge"` rows exist today, show empty state — never auto-promote ungraded picks into Today's Edge.

### 4. nba-odds (read-only sanity check, no edit)
Confirm `/player-odds` returns prices keyed by `point`. If it currently returns just the best price across all points, accept that limitation by filtering server-side in daily-picks (have `analyzePlayerProp` re-grade with the actual line returned by odds).

## Verification (after deploy)

1. Trigger `daily-picks` (POST), confirm response shows `todays_edge: ≤5`.
2. Run:
   ```
   SELECT player_name, sport, prop_type, line, hit_rate, odds, tier
   FROM daily_picks WHERE pick_date = CURRENT_DATE
   ORDER BY tier DESC, hit_rate DESC;
   ```
   Expected: zero rows where `parseInt(odds) >= 500`. Top tier=edge are real-line plays (e.g. points 22.5, threes 1.5).
3. Run same on `free_props`. Expected: same set, no separate junk.
4. Paste both SELECT outputs in summary.

## Files touched
1. `supabase/functions/daily-picks/index.ts` — bind odds to graded line + sanity cap + dedupe
2. `supabase/functions/_shared/edge_scoring.ts` — cap odds ≥ +500, drop low-reliability allowance
3. `src/components/home/ModernHomeLayout.tsx` — remove silent fallback that smuggles ungraded picks into Today's Edge

