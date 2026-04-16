

## Plan: Make MLB O/U (Total) Order-Independent

### Root cause (exact lines, `supabase/functions/mlb-model/index.ts`)

**Primary asymmetry — `runModel` line 466:**
```ts
advantageScore = 50 + (safe1 - safe2) / 2;
```
This is a directional *advantage* formula. For totals (a single combined event), swapping team1/team2 flips the sign and produces `100 - confidence`. Park/weather/temp are correctly handled as shared (line 463-464), but every team factor is asymmetric.

**Secondary issues that also break symmetry for `total`:**
- Lines 721-738 (`team1Factors`) hardcode `homePitcher`, `splits1.home`, `scoreHomeAway(...true)` — assumes team1 is home.
- Lines 741-757 (`team2Factors`) hardcode `awayPitcher`, `splits2.away`, `scoreHomeAway(...false)` — assumes team2 is away.
- If the user passes (Yankees=team1, RedSox=team2) but Red Sox are actually home, team1 gets the *home* pitcher's stats (Red Sox SP) under the Yankees' slot. Swap inputs → pitcher stats land in opposite slots. Combined with the directional `(safe1-safe2)` formula, output diverges.
- Line 793 `adjustedProjection` is computed but never returned, so there is no `predicted_total` field at all today.

### Fix (scoped strictly to `bet_type === "total"`)

**1. New symmetric scoring path in `runModel`** (`index.ts` ~line 437-494)

Add a branch: when `betType === "total"`, replace the advantage formula with a *combined* score:
```ts
if (betType === "total") {
  advantageScore = sharedFactors[factor] ?? (safe1 + safe2) / 2;
}
```
Park/weather/temp/line_movement/public_pct continue using `sharedFactors` (already symmetric). Every team factor uses the **average** of the two team scores — order-independent by construction. Moneyline and runline keep current `(safe1 - safe2)/2` behavior (out of scope per task).

**2. Determine actual home/away from game data, not input order** (~lines 670-757)

Before building `team1Factors`/`team2Factors`, identify the real home/away team from `eventData.competitions[0].competitors[*].homeAway`. Map `team1_id`/`team2_id` to their true home/away role. Then:
- Assign `homePitcher` / `awayPitcher` to whichever of team1/team2 is actually home/away.
- Use `splits1.home` only if team1 is the actual home team; otherwise `splits1.away` (and same for team2).
- For `scoreHomeAway`, pass the correct `isHome` boolean per team.

This makes pitcher/split assignment order-independent: regardless of input order, the home-team slot always carries the home pitcher.

**3. Symmetric `lr_splits`** (lines 731, 750)

Currently team1 sees `awayPitcher.throwingHand`, team2 sees `homePitcher.throwingHand`. After fix #2, this becomes "each team scored vs the *opposing* pitcher's hand" — already symmetric in structure. Keep, but route via the corrected pitcher assignment.

**4. Add a real `predicted_total` field** (~line 786-795)

Move the `adjustedProjection` calculation out of the `if (game_id && eventData && odds)` nested block (it's currently dead code locked behind the odds branch) up to the totals block, and surface it on the `prediction` response as `predicted_total`. The formula `baseRuns * (avgERA / 4.20) * parkFactor * tempAdj * windAdj` already uses symmetric inputs (avg of both pitchers' ERA, shared park/weather), so it's order-independent.

**5. Verdict for totals based on `predicted_total` vs `line`**

When `bet_type === "total"` and a `line` is supplied: verdict = OVER if `predicted_total > line + 0.3`, UNDER if `< line - 0.3`, else PASS. Confidence = clamp(50 + |predicted_total - line| × 8, 50, 90). Both terms depend only on symmetric inputs.

### Verification (mandatory before completion)

Deploy `mlb-model`, then via `supabase--curl_edge_functions` POST to `/mlb-model/analyze`:

- **Test A**: `{ bet_type: "total", team1_id: <Yankees>, team2_id: <RedSox>, over_under: "over", line: 8.5 }`
- **Test B**: same body with team1/team2 swapped.

Paste both full response bodies in the completion message. Required to pass:
- `confidence` identical
- `verdict` identical
- `predicted_total` identical
- Each factor's `advantageScore` in `factorBreakdown` identical (team1Score/team2Score may swap labels — that's expected and fine, but the symmetric `advantageScore` must match)

If any field differs, identify the still-asymmetric factor, patch, redeploy, retest, then complete.

### Out of scope (untouched)
- Moneyline, runline, player_prop code paths
- Other sports (NBA, NHL, UFC)
- Frontend
- DB schema

