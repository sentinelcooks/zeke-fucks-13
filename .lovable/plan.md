

## Plan: Fix Daily Picks Generation — Lower Thresholds, Add Fallbacks, Improve Logging

### Root Cause

The daily-picks function ran successfully but produced **0 picks** because:

1. **Game-level models (MLB/NHL)** returned confidences of 48-54% — all below both the 70% primary and 65% expansion thresholds
2. **NBA is out of season** — no NBA games, so no NBA game-level or prop picks
3. **Player props** — most prop analyses either returned null (API errors) or had confidence below 65%. The few that passed confidence were then blocked by `fetchRealOdds` returning null (no live odds available)
4. **No fallback** — when all picks fail every filter, nothing gets inserted, leaving the carousel permanently empty

### Changes

**File: `supabase/functions/daily-picks/index.ts`**

1. **Lower confidence thresholds** — Drop primary threshold from 70% to 60%, expansion threshold from 65% to 55%. The MLB/NHL models consistently output 48-54%, so the current thresholds guarantee zero picks during non-NBA months.

2. **Add "best available" fallback** — If after all phases there are still 0 picks, take the top 10 picks from `allPicks` regardless of confidence (as long as confidence > 45%). This ensures the carousel always has something to show. Mark these as lower confidence visually but still useful.

3. **Relax real-odds requirement** — When `fetchRealOdds` returns null, instead of skipping the pick entirely, allow it through with `odds: "N/A"`. Real odds are nice-to-have but shouldn't block pick generation.

4. **Add prop analysis logging** — Log each prop analysis result (confidence, player name) so we can debug why props fail. Currently there's zero visibility into what `analyzePlayerProp` returns.

5. **Collect all analyzed picks before filtering** — Currently, picks below threshold are silently discarded. Instead, collect ALL analyzed picks into a separate array, then filter. If the filtered set is empty, use the best from the unfiltered set.

### Technical Details

```text
Current flow:
  Model returns 51% → discarded (threshold 70%) → 0 picks → empty carousel

New flow:
  Model returns 51% → collected in allAnalyzed[]
  After all phases → filter allAnalyzed >= 60% → if empty, take top 10 by confidence
  Real odds missing → allow pick with odds "N/A"
  → Always generate some picks
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/daily-picks/index.ts` | Lower thresholds, best-available fallback, relax odds requirement, add logging |

