

## Plan: Fix Odds Issues & Add Multi-Market EV to Lines Tab

### Problem 1: Player Props "No Odds Found"
The player-odds endpoint times out because it fetches prop data for every event sequentially. The fix is to add a timeout per event and limit the number of events searched, plus improve the matching to try cached events-only data first before fetching per-event props.

### Problem 2: Add All-Market EV Cards to Lines Tab
Currently the Lines tab only shows EV for the selected bet type. The user wants to see EV/odds for **all three markets** (moneyline, spreads, totals) after running an analysis.

---

### Changes

**1. Update `MoneylinePlatformOdds` component** (`src/components/MoneyLineSection.tsx`)
- Expand to fetch and display **all three markets** (h2h, spreads, totals) instead of just h2h
- Show odds rows for each market type with proper labels
- Add an EV summary card for each market using the model confidence from `results`

**2. Create a new `MoneylineEVSummary` component** (inside `MoneyLineSection.tsx`)
- Takes `oddsData` from the events API (h2h, spreads, totals per bookmaker) and model confidence
- Calculates EV and edge for each market type (moneyline, spread, total)
- Displays three EV cards side-by-side similar to the existing `OddsComparison` EV grid
- Shows best book, best odds, and implied probability for each market

**3. Update the results section** in `MoneyLineSection`
- After analysis results render, show the new multi-market EV summary
- Pass `results.team1_pct` / `results.confidence` to compute EV for each market
- The existing single `results.odds` card remains for the selected bet type; the new component shows all three

**4. Fix `nba-odds/index.ts` player-odds timeout**
- Add a 10-second timeout per event prop fetch to prevent the endpoint from hanging
- Limit event iteration to max 5 events (today's games only)
- If no events have props cached, try the first 3 events max before returning "not found"

### Technical Details

- The events endpoint already returns h2h, spreads, and totals data per bookmaker — no additional API calls needed for the Lines tab enhancement
- EV formula: `(modelProb × decimalOdds − 1) × 100`
- Edge formula: `modelProb − impliedProb`
- The `MoneylinePlatformOdds` component will be refactored to accept a `markets` prop to control which markets to display
- For the player-odds fix, `AbortController` with timeout will be used for per-event fetches

