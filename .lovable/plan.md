

## Root Cause

In `src/pages/NbaPropsPage.tsx` lines 2183–2197, the search button on each correlated prop row updates state (`setPlayer`, `setPropType`, `setLine`) and then calls `handleAnalyze()` after a 150ms `setTimeout`.

The bug: **React state updates are asynchronous and batched**. `handleAnalyze()` reads from the closure's stale `player`/`propType`/`line` values (still the originally searched player), not the just-tapped correlated player. The 150ms timeout is unreliable — sometimes state has flushed, sometimes not, depending on render timing. Result: the analysis fires for the previously searched player while the form *displays* the new player, so the stats shown don't match.

Other defects in the same handler:
- `c.correlated_line` may be `0` or `undefined` → `parseFloat("")` → `NaN` → analyze silently aborted.
- `parlaySlip.legs.find` for the remove button matches only on `player + propType` (no `line`), so removing the wrong leg is possible if the same player has multiple props in the slip.
- Sport scope: only NBA renders Correlated Props (`sport === "nba"` guard at line 2139), so this fix is NBA-only by design — the user's "all sports" request is moot here because correlated props is currently NBA-exclusive.

## Fix

In `NbaPropsPage.tsx`, replace the search button's onClick with a direct, parameterized analyze call that does **not** rely on React state for the values it sends to the edge function:

1. Refactor `handleAnalyze` to accept optional override params (`{ player, propType, line, overUnder }`). When provided, use those values for both the API call and the slip/results display. When omitted, fall back to current state (preserves the main search bar behavior).
2. The correlated-prop search button passes the row's `c.correlated_player`, `c.correlated_prop`, `c.correlated_line`, `"over"` directly. State setters still run for UI sync, but the fetch uses the override values — eliminating the stale-closure race.
3. Guard against missing `correlated_line`: if no line is present on the row, skip the auto-analyze, only populate the form (so user can adjust and tap Analyze themselves).
4. Tighten the slip remove match to include `line`.

No edge-function or DB changes — the `correlated-props` function already returns the correct per-row player; the bug is purely client-side stale state in the tap handler.

## Verification (post-approval, default mode)

1. Search a player with multiple correlated props (e.g., Devin Booker → Points).
2. Tap the search button on the **3rd** correlated row.
3. Confirm: results header shows the 3rd row's player + prop, network tab shows the analyze call body containing that exact player/prop/line.
4. Repeat tapping a different row twice in succession; confirm each navigation analyzes the tapped row, not the prior one.
5. Add a row to the slip, then a different row for the same player; remove one — confirm only that specific line is removed.

