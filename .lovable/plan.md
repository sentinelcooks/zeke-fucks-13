

## Plan: Fetch Best Sportsbook Odds in AddToSlipSheet

### Problem
The odds shown in the bottom sheet are hardcoded (`-110` in NbaPropsPage, or whatever static value is passed from the home carousel). They don't reflect actual live odds from the best sportsbook.

### Solution
When the `AddToSlipSheet` opens, fetch live player odds via `fetchPlayerOdds` and display the best available line with the sportsbook name. Show a loading state while fetching.

### Changes

**`src/components/AddToSlipSheet.tsx`**

1. Import `fetchPlayerOdds` from `@/services/oddsApi` and `getSportsbookInfo` from `@/utils/sportsbookLogos`, plus `Loader2` icon
2. Add state: `liveOdds` (best odds number), `bestBook` (string), `loadingOdds` (boolean)
3. Add `useEffect` that fires when `open && pick` — calls `fetchPlayerOdds(pick.player, pick.propType, pick.overUnder, pick.sport.toLowerCase())`, finds the book with the best (highest) odds, and sets `liveOdds`/`bestBook`
4. Use `liveOdds ?? pick.odds` for payout calculation and display
5. Show the best sportsbook name + logo next to the odds (e.g. "FanDuel" with its icon)
6. Show a small spinner while odds are loading
7. On confirm, pass `liveOdds ?? pick.odds` to `addLeg` so the slip stores the real odds

### Scope
- Single file edit: `src/components/AddToSlipSheet.tsx`
- No backend changes

