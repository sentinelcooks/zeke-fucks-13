

## Plan: Remove Duplicate Odds Card & Unify Odds Section

### What's happening now
There are **two** odds sections rendering for every sport:
1. A simple "Odds & Value" card (Model Prob / Best Odds / Best Book grid + All Books list) — powered by `results.odds` from the backend model
2. The full `MoneylinePlatformOdds` component — the richer design with EV hero card, edge projection bar, best line card, and all sportsbooks comparison (the design shown in your screenshots)

These are redundant and the first one is the blocky, less polished section you want removed.

### Changes

**1. Remove the "Odds & Value Card" block** (`MoneyLineSection.tsx`, lines ~1470-1544)
- Delete the entire `{results.odds && (...)}` card that renders Model Prob / Best Odds / Best Book in a 3-column grid
- This removes the duplicate; the `MoneylinePlatformOdds` component already covers this data with better design

**2. Keep `MoneylinePlatformOdds` as the single odds section**
- Already renders consistently for all sports (NBA, NHL, MLB) using live odds data
- Already includes: EV across all markets, model vs market hero, edge projection, best line, all sportsbooks list
- No changes needed to this component

### Files
- `src/components/MoneyLineSection.tsx` — remove lines ~1470-1544 (the "Odds & Value Card" block)

