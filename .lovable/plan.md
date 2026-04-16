

## Plan: Fix Correlated Props to Respect Over/Under Direction

### Problem
The correlated props engine **always computes correlations for the "over" direction**, regardless of what the user selected. Two places hardcode `>` comparisons:

1. **Line 195** — Source player hit games: `getStatValue(g.stats, sourceProp) > sourceLine` (always "over")
2. **Line 241** — Correlated player hits: `getStatValue(g.stats, prop) > line` (always "over")

When a user picks "under 1.5 3-Pointers", the function still finds games where the player went **over** the line, producing correlations that contradict the user's chosen direction.

Additionally, the frontend callers never pass `over_under` to the function.

### Fix

**1. `supabase/functions/correlated-props/index.ts`** — Accept and use `over_under` parameter:

- Parse `over_under` from the request body (default to `"over"` for backward compat)
- Pass it into `computeCorrelations`
- Source hit filter: use `< sourceLine` when direction is "under", `> sourceLine` when "over"
- Correlated hit filter: same direction-aware comparison
- Update reasoning text to reflect direction (e.g., "stays under" vs "exceeds")

```typescript
// Line 193-196: direction-aware source filtering
const hitEventIds = new Set(
  sourceLog.games
    .filter(g => overUnder === "under" 
      ? getStatValue(g.stats, sourceProp) < sourceLine
      : getStatValue(g.stats, sourceProp) > sourceLine)
    .map(g => g.eventId)
);

// Line 241: direction-aware correlated hit check
if (overUnder === "under" 
  ? getStatValue(g.stats, prop) < line
  : getStatValue(g.stats, prop) > line) coHits++;
```

**2. Frontend callers** — Pass `over_under` in all 3 invocation sites:

- `src/pages/NbaPropsPage.tsx` (2 call sites) — add `over_under: overUnder` or `over_under: navState.overUnder`
- `src/pages/FreePropsPage.tsx` (1 call site) — add `over_under: prop.over_under || "over"`

**3. Cache key** — Add `over_under` to the cache lookup/insert so "over" and "under" results are cached separately.

### Scope
- 3 files: edge function + 2 frontend pages
- No database changes (the cache table doesn't need a new column — we can append direction to `source_prop` in the cache key)

