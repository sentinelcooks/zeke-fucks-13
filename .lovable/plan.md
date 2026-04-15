

## Plan: Add AI Written Analysis to Free Props Detail View

### What's Happening
The `WrittenAnalysis` component is present on the Analyze tab (`NbaPropsPage.tsx`) and working correctly. However, the **Free Props detail view** (`FreePropsPage.tsx`) — which claims to "mirror NbaPropsPage results exactly" — is missing the AI written analysis section entirely. When you tap a free prop and see its breakdown, there's no In-Depth Analysis section.

### Fix

**`src/pages/FreePropsPage.tsx`** — Add `WrittenAnalysis` after the minutes trend section (around line 520), before Correlated Props:

1. Import `WrittenAnalysis` at the top
2. Insert the component with the same props as NbaPropsPage:
   - `type="prop"`, `verdict`, `confidence`, `playerOrTeam`, `line`, `propDisplay`, `overUnder`, `reasoning`, `seasonHitRate`, `last10`, `last5`, `h2hAvg`, `ev`, `edge`, `minutesTrend`, `injuries`, `sport`, `withoutTeammatesData`

### Scope
- 1 file changed, ~20 lines added (1 import + component insertion)
- No backend changes — uses the existing `ai-analysis` edge function which is working correctly

