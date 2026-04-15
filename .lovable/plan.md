

## Plan: Fix Hit Rates Section — Restore Missing Rings and Fix Overflow

### Problem
1. The **Home/Away** hit rate ring was removed — only 4 rings show instead of 5.
2. The container uses `flex justify-center gap-4` which causes rings to clip on narrow screens.

### Changes

**`src/pages/NbaPropsPage.tsx`** (~lines 1955-1961):
1. Change container from `flex justify-center gap-4` to `flex justify-between gap-3 px-1`.
2. Re-add the Home/Away `HitRateRing` using `results.home_away` data.

**`src/components/mobile/HitRateRing.tsx`**:
1. Add `min-w-0 flex-shrink-0` to the wrapper div to prevent layout collapse.

### Result
All 5 hit rate rings (Season, L10, L5, Home/Away, vs Opponent) visible without clipping on mobile.

