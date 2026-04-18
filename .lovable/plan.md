
## Diagnosis

The UFC page has two different sources of truth:

- The center "Top Pick" card is driven by `best_bet`
- The "Overall Verdict" inside `WrittenAnalysis` is still being driven by a moneyline-style `decision` from `ml_pick`

So when the actual top pick is something like `Over 1.5 Rounds 77%`, the overall verdict still behaves like a moneyline summary, which is why it can show the wrong result.

## Plan

1. Read `best_bet` as the canonical UFC overall pick
   - Treat `best_bet` as the single source of truth for the UFC overall verdict
   - Only fall back to `ml_pick` when the top pick itself is actually moneyline

2. Build a UFC top-pick adapter in `src/pages/UfcPage.tsx`
   - Parse `best_bet.bet` into a normalized shape:
     - Moneyline: `ML Fighter Name`
     - Round totals: `Over/Under 1.5 Rounds`
     - Totals like sig strikes / takedowns
     - Binary props like `Fight goes to Decision` / `Fight ends by KO/TKO` / `Yes — Goes the Distance`
   - Map that parsed result into the correct `WrittenAnalysis` props

3. Render `WrittenAnalysis` from the top pick, not always from moneyline
   - If top pick is moneyline: keep `type="moneyline"` and pass a proper `decision`
   - If top pick is not moneyline: switch to `type="prop"` and pass parsed `playerOrTeam`, `propDisplay`, `overUnder`, `line`, `confidence`, and `reasoning`
   - This makes the Overall Verdict always describe the same pick shown in the Top Pick card

4. Add a safe fallback
   - If a UFC market can’t be parsed cleanly, still show the overall verdict from `best_bet.bet` text instead of dropping into the wrong moneyline/no-bet path

## Files likely touched

- `src/pages/UfcPage.tsx`
- Possibly `src/components/WrittenAnalysis.tsx` only if a tiny fallback label improvement is needed for non-numeric UFC props

## Verification after implementation

I will not mark it complete until I verify it live in the preview and paste the observed output.

Checks:
1. Re-test the same UFC matchup from your screenshot
   - Confirm the Top Pick card still shows `Over 1.5 Rounds 77%`
   - Confirm the Overall Verdict now references that same top pick, not moneyline and not `0 vs 0`

2. Test one matchup where moneyline is the top pick
   - Confirm the Overall Verdict still correctly summarizes the moneyline side

3. Paste the exact live verdict text seen in the preview in the final summary

## Technical detail

This is a frontend state-mapping bug, not a model bug. The fix is to unify UFC summary rendering around `best_bet`, because that is what the UI already presents as the top recommendation.
