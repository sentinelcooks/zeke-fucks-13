

## Plan: Remove the "AI Analysis" Section

### What
The "AI Analysis" section (the collapsible accordion showing bullet-point reasoning lines like "⚾ MLB 20-Factor Batter Model — Shohei Ohtani") is redundant — the Written Analysis section below already presents the same information in a more polished narrative format.

### Changes

**`src/pages/NbaPropsPage.tsx`** (~lines 2038-2057)
- Remove the entire `<Section title="AI Analysis">` block that maps over `results.reasoning`

**`src/pages/FreePropsPage.tsx`** (~lines 514-530)
- Remove the same `<Section title="AI Analysis">` block from the free props results

### What Won't Change
- Written Analysis section stays (it already covers the AI narrative)
- No backend changes
- All other sections (Hit Rates, Odds, Game Log, etc.) unaffected

