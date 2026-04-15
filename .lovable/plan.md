

## Plan: Fix Hit Rate Rings Clipping Off Screen

### Problem
5 rings at 80px each (400px total) plus gaps exceed the viewport width on mobile (320-430px), causing the last 1-2 rings to clip off-screen.

### Changes

**`src/components/mobile/HitRateRing.tsx`**:
- Reduce ring size from `w-20 h-20` to `w-16 h-16`, and SVG radius from 32 to 26 accordingly.
- Reduce percentage text from `text-sm` to `text-xs`.

**`src/pages/NbaPropsPage.tsx`** (line 1954):
- Change container from `flex justify-between gap-3 px-1` to `flex justify-between gap-1 px-0` to minimize wasted space.

**`src/pages/FreePropsPage.tsx`** (line 369):
- Apply the same tighter container styling for consistency.

### Result
All 5 rings fit within 320px screens without clipping.

