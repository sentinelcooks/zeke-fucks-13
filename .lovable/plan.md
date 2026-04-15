

## Plan: Improve Games Tab Sport Switching

### Changes to `src/pages/GamesPage.tsx`

**1. Add per-sport cache using `useRef`**

Add a `useRef` cache map (`Record<SportFilter, { games, ufcEvents, oddsMap }>`) that stores fetched data per sport. When switching to a previously loaded sport, instantly restore from cache instead of fetching.

**2. Update `fetchGames` to populate cache**

After a successful fetch, store the results in the cache ref. On sport switch (`useEffect`), check cache first — if data exists, restore it immediately (no loading state). Only fetch from API on first load or manual refresh.

**3. Manual refresh bypasses cache**

The existing "Refresh" button will pass a `force` flag that skips the cache check and re-fetches from API, updating the cache afterward.

**4. Replace spinner with skeleton cards**

Replace the current `<Loader2>` spinner (lines 961-964) with 4 skeleton game cards that match the `GameCard` dimensions — two team name bars, score area, and odds row, all with `animate-pulse`. This avoids the blank screen flash.

### Technical Details

- Cache is `useRef` (not `useState`) to avoid re-renders on cache writes
- Silent auto-refresh (10s/60s) updates cache too, keeping it fresh
- Skeleton cards: `vision-card` container with `h-[140px]` rounded pulse bars mimicking team logos, names, and odds layout
- No new files or dependencies

