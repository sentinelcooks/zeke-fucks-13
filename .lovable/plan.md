

## Plan: Fix Stat Pills and Hit Rate Rings Layout on Mobile

### Problem
After removing MTD, the stat pills grid still uses `grid-cols-5` but only has 4 items, leaving an empty column and making the remaining items too narrow — causing text like "SEASON" to wrap awkwardly. The hit rate rings have a similar centering issue.

### Changes

**`src/pages/NbaPropsPage.tsx`** — 2 locations:

1. **Stat pills grid (line 1913)** — Change `grid-cols-5` to `grid-cols-4` so the 4 remaining pills (Season, L10, L5, vs OPP) fill the row evenly.

2. **Hit rate rings (line 1955)** — Change `flex justify-around` to `flex justify-center gap-4` so the 4 rings are properly centered with consistent spacing instead of spread across the full width.

**`src/components/mobile/StatPill.tsx`** — Improve label text sizing:

3. Change label from `text-[9px] tracking-widest` to `text-[8px] tracking-wider` to prevent long labels (like "SEASON") from wrapping in narrow columns.

### Scope
- 2 files, 3 small CSS changes

