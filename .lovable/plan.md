

## Plan: Improve In-Depth Analysis — Pace/Total Context, Grok AI, Recency Decay

### What's changing

Three improvements to make the analysis engine smarter and the written analysis richer.

---

### 1. Recency Decay on Hit Rates (Backend)

**File: `supabase/functions/nba-api/index.ts`**

The current `hitRate()` function treats all games equally. We'll add a `weightedHitRate()` function that applies exponential decay — recent games matter more.

- Each game gets weight `e^(-λ * daysAgo)` where λ ≈ 0.03 (half-life ~23 days)
- Weighted hit rate = sum of weights for hits / sum of all weights
- Apply this alongside the existing flat hit rate — pass both to the confidence engine
- Update `calculateConfidence()` to blend weighted hit rate (60%) with flat hit rate (40%) for the season factor
- Add weighted averages for L10 and L5 as well (less impactful since they're already recency-biased)
- The game log already has dates, so we can compute `daysAgo` from each game's date

### 2. Game Pace / Total Context (Backend + Frontend)

**File: `supabase/functions/nba-api/index.ts`**
- In `analyzeProp()`, after fetching the next game, fetch the ESPN team stats for both teams to extract pace rating and points per game
- For NBA: use offensive/defensive rating and pace from ESPN team stats (already available via `getTeamStats()` in moneyline-api)
- For MLB: extract runs per game from team stats
- For NHL: extract goals per game from team stats
- Pass `paceContext` object to the confidence engine and include in reasoning strings
- Include pace data in the response payload so it reaches the frontend

**File: `supabase/functions/ai-analysis/index.ts`**
- Accept `paceContext` in the request body
- Inject pace/total context into the prompt: "Game pace context: [team1] ranks #X in pace at Y possessions/game. Projected game total: Z."
- Update sport-specific prompts to reference pace/total when available

**File: `src/components/WrittenAnalysis.tsx`**
- Accept `paceContext` as a new optional prop
- Display pace context in the overall summary when available
- Include in the data sent to the ai-analysis edge function

### 3. Grok AI for Writing Picks (Backend)

**File: `supabase/functions/ai-analysis/index.ts`**
- Add a Supabase secret `XAI_API_KEY` for the user's Grok/xAI API key
- Check if `XAI_API_KEY` is available; if so, use `https://api.x.ai/v1/chat/completions` with model `grok-3` instead of the Lovable AI gateway
- Fall back to Lovable AI gateway if the key is not set
- Same prompt structure, just different endpoint and model
- Handle xAI-specific error codes (429, 402)

We'll need to use the `add_secret` tool to request the xAI API key from you.

---

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/nba-api/index.ts` | Add `weightedHitRate()`, recency decay in confidence, pace context fetch |
| `supabase/functions/ai-analysis/index.ts` | Grok model support, pace context in prompts |
| `src/components/WrittenAnalysis.tsx` | Pass pace context to edge function |

### Execution Order

1. Request xAI API key secret from user
2. Add recency decay to nba-api hit rate calculations
3. Add pace/total context fetching to nba-api
4. Update ai-analysis to use Grok + include pace in prompts
5. Update WrittenAnalysis component to pass new data

