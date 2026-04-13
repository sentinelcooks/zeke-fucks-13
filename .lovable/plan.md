

## Fix: Overall Moneyline Analysis, Model & Functionality

### Problems Found

1. **Analysis Breakdown shows raw model weights for ALL sports** — The generic NBA/NCAAB/NFL path uses raw `factors` strings like `"Twins=46 Red Sox=46 (17% weight)"`. The `factorToInsight` transformation was only applied to MLB/NHL delegated models, not the generic `analyzeMoneyline`/`analyzeSpread`/`analyzeTotal` output.

2. **Frontend reads `results.factors` (raw strings) instead of transforming `factorBreakdown`** — The structured `factorBreakdown` array is returned but ignored by the Analysis Breakdown UI for non-delegated sports.

3. **In-Depth Analysis text has formatting issues** — AI writeup has all-caps text and stray numbering ("2.", "3.") due to the prompt not constraining format for moneyline analysis.

4. **H2H data empty for some matchups** — When teams haven't played this season, "No head-to-head data" is shown. We should also search previous season H2H data as fallback.

---

### Changes

**1. `supabase/functions/moneyline-api/index.ts` — Transform generic NBA/NCAAB/NFL factors through `factorToInsight`**

- In the generic response block (lines 1004-1036), after running `analyzeMoneyline`/`analyzeSpread`/`analyzeTotal`, transform the `factors` array:
  - Use `analysis.factorBreakdown` (the structured array) and map through `factorToInsight` to produce clean natural-language strings
  - Replace `analysis.factors` with these clean insight strings
  - Keep writeup lines (🤖) and injury lines (🚨) as-is

**2. `supabase/functions/moneyline-api/index.ts` — Fix `analyzeMoneyline` factor format**

- Currently each `addFactor` call adds a raw stat string to `factors[]`. These are never displayed to users anymore since we use `factorToInsight`.
- The `factors` array in the response should be built from `factorBreakdown.map(f => factorToInsight(f, team1.shortName, team2.shortName))` at the end of each analyze function, instead of building raw strings.

**3. `supabase/functions/moneyline-api/index.ts` — H2H fallback to previous season**

- In `getHeadToHead`, if current season returns 0 results, try fetching the previous season's schedule (`?season=2024` or year-1) and merge results.

**4. `supabase/functions/ai-analysis/index.ts` — Fix moneyline prompt formatting**

- Add formatting constraints to the moneyline prompt: "Write in normal sentence case. Do not use ALL CAPS. Do not number sections."

**5. `src/components/MoneyLineSection.tsx` — Ensure Analysis Breakdown always uses clean insights**

- The current UI already filters for 🤖 writeup and renders the rest as insight bullets — this is correct, but verify the data coming in is clean (handled by backend changes above).

---

### Technical Details

**Generic model response transformation (lines ~1004-1036):**
```typescript
// After running analysis:
const cleanFactors = (analysis.factorBreakdown || []).map((f: any) =>
  factorToInsight(f, team1.shortName, team2.shortName)
);
// Preserve injury/writeup lines from original factors
const specialLines = (analysis.factors || []).filter((f: string) =>
  f.startsWith("🤖") || f.startsWith("🚨") || f.startsWith("😴") || f.startsWith("💀") || f.startsWith("📐") || f.startsWith("⚡")
);
analysis.factors = [...cleanFactors, ...specialLines];
```

**Files Modified:**
- `supabase/functions/moneyline-api/index.ts` — Transform all factor output, add H2H fallback
- `supabase/functions/ai-analysis/index.ts` — Fix moneyline prompt formatting
- `src/components/MoneyLineSection.tsx` — Minor: ensure clean display for edge cases

