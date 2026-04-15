

## Plan: Fix NHL TOI (Time on Ice) Showing 0

### Root Cause
ESPN NHL gamelog labels use `"TOI/G"` for time on ice, but the code only looks for `"TOI"`. Since `getIdx("TOI")` returns `-1`, all TOI values are 0.

### Fix — `supabase/functions/nba-api/index.ts`

**Line 340** — Update the `toiIdx` lookup to also check `"TOI/G"`:
```ts
const toiIdx = getIdx("TOI") !== -1 ? getIdx("TOI") : getIdx("TOI/G");
```

That's the only change needed. The TOI parsing logic (lines 366-377) already handles the `"MM:SS"` format correctly, and the `minutesTrend` function already reads `g.toi` for NHL. Once the index is found, all downstream TOI display will work.

### Scope
- 1 line changed in 1 edge function, redeploy

