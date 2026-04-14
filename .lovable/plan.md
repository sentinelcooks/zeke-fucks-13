

## Plan: Make Parlay Leg Picks Clickable for Analysis

### Problem
In the saved parlays on the Profit Tracker page, the leg pick text (e.g., "Mark Stone OVER 1.5 sog") is static. The user wants it to be clickable and navigate to the corresponding player analysis page with the prop pre-filled.

### Approach
The NbaPropsPage already supports `location.state` with `autoAnalyze` to pre-fill and auto-run analysis. We just need to:

1. Parse the `leg.pick` string to extract player name, over/under, line, and prop type
2. Wrap the pick text in a clickable element that navigates to `/dashboard/nba` with the correct state

### Implementation

**File: `src/pages/ProfitTrackerPage.tsx`**

1. Import `useNavigate` from `react-router-dom`
2. Add a helper function to parse leg pick strings (e.g., `"Mark Stone OVER 1.5 sog"` → `{ player: "Mark Stone", over_under: "over", line: 1.5, prop_type: "sog" }`)
3. In the parlay legs rendering (lines 852-863), wrap the pick text `<span>` in a clickable button/link that calls `navigate("/dashboard/nba", { state: { autoAnalyze: true, player, prop_type, line, over_under, sport } })`
4. Style the pick text with underline/accent color to indicate it's clickable

### What Won't Change
- No backend changes
- No changes to NbaPropsPage or MoneyLinePage (they already handle navigation state)
- Parlay card layout stays the same — only the pick text becomes interactive

