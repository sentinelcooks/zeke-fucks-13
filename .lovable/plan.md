

## Plan: Fix Stale Cache Bug on Sport Switching

### Root Cause

The cache-syncing `useEffect` at line 443-447 stores `{ games, ufcEvents, oddsMap }` keyed by the current `sport` state. But state updates from async fetches can resolve *after* `sport` has already changed. For example:

1. User is on NBA → games state has NBA data
2. User switches to MLB → `sport` changes to `"mlb"`, fetch starts
3. The cache-sync effect fires and stores NBA games under the `"mlb"` key (because `sport` is now `"mlb"` but `games` still holds NBA data)
4. Next time user switches to MLB → cache hit → shows NBA games

### Fix (single file: `src/pages/GamesPage.tsx`)

**1. Remove the cache-syncing `useEffect` entirely** (lines 443-447)

This reactive approach is fundamentally broken because `sport` and `games` can be out of sync during state transitions.

**2. Write to cache imperatively inside `fetchGames`**

After successful fetch/state-set, store the data in `sportCache.current[s]` using the `s` parameter (the sport being fetched), not the `sport` state variable. This guarantees the cache key always matches the data.

- After cache restore (line 265-268): no change needed — data is already in cache
- After fresh ESPN fetch (line 299): cache the fetched data under `s`
- After UFC fetch: cache after both `fetchUfcEvents` and `fetchOdds` complete, using local variables for the results

**3. Update `fetchOdds` and `fetchUfcEvents` to return their results**

Instead of calling `setOddsMap`/`setUfcEvents` directly inside these functions, have them return the data. `fetchGames` will then call `set*` and write the cache in one place, ensuring sport-key consistency.

**4. Skeleton cards styling update**

Update the existing skeleton cards (lines 988-1012) to match the requested spec:
- Background: `#1a1832`, border: `1px solid #252340`, border-radius: `14px`, height: `120px`
- Replace Tailwind `animate-pulse` with inline style using the specified keyframes

### No changes to
- Any other file
- Refresh button behavior
- Cache structure or ref type
