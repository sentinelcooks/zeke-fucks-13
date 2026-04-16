

## Plan: Revert Hit Rates to 4 Rings (Season, L10, L5, VS)

### Changes

**`src/pages/NbaPropsPage.tsx`** (lines 1954-1960):
- Remove the `home_away` ring (line 1958) — this is the "AWAY"/"HOME" ring causing 5 rings
- Keep only: Season, L10, L5, and VS [opponent]
- Update the VS ring delay from `0.4` to `0.3`

**`src/pages/FreePropsPage.tsx`** (lines 369-374):
- Change the H2H ring label from `"H2H"` to `vs ${opponent}` format to match NbaPropsPage style

### Result
4 rings total on both pages: Season, L10, L5, VS [opponent] — matching the second screenshot.

