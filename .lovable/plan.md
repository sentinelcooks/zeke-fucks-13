

## Plan: Fix EV/Edge Text Overflow on Mobile

### Problem
In the `OddsProjection` component's 3-column model comparison grid, the large `text-xl` numbers (e.g. "57.0%", "+10.5%") overflow their containers on small mobile screens (320-390px). The edge value with its "+" prefix and decimal is especially tight.

### Changes

**File: `src/components/mobile/OddsProjection.tsx`**

1. **Reduce number font size** — Change `text-xl` to `text-lg` on all three stat values (lines 405, 410, 418-419) so they fit within the `grid-cols-3` cells on narrow screens.

2. **Add overflow protection** — Add `min-w-0 overflow-hidden` to each grid cell to prevent text from breaking layout.

3. **Shrink Edge value further** — The Edge cell has the longest text (e.g. "+10.5%"), so use `text-base` there specifically, or use `text-[16px]` for all three for consistency.

### Files Modified

| File | Change |
|------|--------|
| `src/components/mobile/OddsProjection.tsx` | Reduce stat number font sizes from `text-xl` to `text-[16px]`, add `min-w-0` to grid cells |

