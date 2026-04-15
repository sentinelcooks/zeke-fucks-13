

## Plan: Fix Correlated Props "+" Button to Use Global Parlay Slip

### Problem
The "+" button on correlated props adds legs to a **local** `parlaySlip` state (`useState` on line 415), not the **global** `ParlaySlipContext` (`globalSlip` on line 387). The `FloatingParlaySlip` and `ParlayPage` read from the global context, so legs added via the "+" button never appear in the actual parlay builder.

### Changes

**`src/pages/NbaPropsPage.tsx`** — Update the "+" button's `onClick` handler (~line 2202):

1. Replace `setParlaySlip(prev => [...prev, ...])` with `globalSlip.addLeg(...)`, passing the required fields (`sport: "NBA"`, `player`, `propType`, `line: ""`, `overUnder: "over"`, `odds: -110`).

2. Replace the `isInSlip` check (line 2154) from checking local `parlaySlip` to using `globalSlip.isInSlip(c.correlated_player, c.correlated_prop, "")`.

3. Replace the remove path (`setParlaySlip(prev => prev.filter(...))`) with finding the matching leg in `globalSlip.legs` and calling `globalSlip.removeLeg(id)`.

This connects the correlated props "+" button to the same slip the floating pill and parlay builder use.

### Scope
- 1 file, ~6 lines changed in the click handler and `isInSlip` check

