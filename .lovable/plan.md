

## Plan: Fix Daily Picks to Generate More & Higher-Confidence Picks

### Root Cause

The daily-picks function produces too few picks because:

1. **Game-level bets are moneyline-only for NHL/MLB** (line 227: `game.sport === "nba" ? ["moneyline", "spread", "total"] : ["moneyline"]`). This misses spread and total bets for NHL/MLB which could yield higher confidence.

2. **Player prop scanning is entirely AI-dependent** — the lineup scanner asks an LLM to guess which 2-3 players have good props. It often misses obvious plays (like Marchessault under 2.5 shots) because it lacks actual statistical data.

3. **Only 12 props analyzed max** per phase (line 627), and each requires a full round-trip to `nba-api/analyze`. Many return null or sub-threshold.

4. **120-second timeout** cuts off analysis before enough games are scanned.

### Changes

**File: `supabase/functions/daily-picks/index.ts`**

1. **Enable spread and total bets for NHL and MLB** — Change line 227 from `game.sport === "nba" ? [...] : ["moneyline"]` to include all three bet types for all sports. The mlb-model and nhl-model already support these bet types.

2. **Increase prop analysis cap** — Raise the 12-prop limit (lines 627, 721) to 20 per phase so more players get analyzed.

3. **Scan more games for lineups** — Increase from top 8 to top 12 games for prop scanning (line 608), matching the game-level bet count.

4. **Request more AI suggestions per game** — Change the AI prompt from "2-3 players" to "4-5 players" (line 398) to increase the pool of prop candidates.

5. **Extend timeout** — Increase from 120s to 140s (line 555) to allow more analysis time before the edge function's 150s hard limit.

6. **Reduce throttle delays** — Lower inter-game delays from 1500ms to 1000ms and inter-prop delays from 1500ms to 1000ms to fit more analysis within the timeout.

### Technical Details

```text
Current: 
  NHL/MLB → moneyline only → 1 bet type → low chance of hitting 60%
  Prop scan → 8 games → AI picks 2-3 per game → 12 max analyzed

Fixed:
  NHL/MLB → moneyline + spread + total → 3x more chances to hit 60%+
  Prop scan → 12 games → AI picks 4-5 per game → 20 max analyzed
  Faster throttle → more fits in 140s window
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/daily-picks/index.ts` | Enable all bet types for all sports, increase prop/game scan limits, faster throttling, extended timeout |

