

## Plan: Fix Sport Switching Showing Wrong Data

### Root Cause
Three race conditions in `GamesPage.tsx`:

1. **`fetchOdds`** (line 167) calls `setOddsMap()` directly — no abort check, so odds from a previous sport can arrive late and overwrite current sport's odds.
2. **`fetchUfcEvents`** (line 308) calls `setUfcEvents()` and `setGames([])` directly — same problem, no abort check.
3. **UFC path** in `fetchGames` (line 284-286) returns early after dispatching async work, never checks `controller.signal.aborted`.

### Fix (single file: `src/pages/GamesPage.tsx`)

**1. Pass the AbortController's signal to `fetchOdds` and `fetchUfcEvents`**

Both functions will accept an `AbortSignal` parameter. Before calling any `set*` state function, check `signal.aborted` — if true, discard the result silently.

**2. Fix the UFC early return**

The UFC branch currently does `await Promise.all([fetchUfcEvents(), fetchOdds(s)]); return;` which skips the abort check in the `finally` block. Move the abort check and `setLoading(false)` into both helper functions, or restructure so the UFC path flows through the same `finally` block.

**3. Bind sport identity to each fetch cycle**

Capture the `sport` value at the start of `fetchGames` and compare it against `sport` state before setting data. Combined with the abort signal, this eliminates all race conditions.

### Technical Details
- `fetchOdds(s, signal)` — add `if (signal.aborted) return;` before `setOddsMap(map)`
- `fetchUfcEvents(signal)` — add `if (signal.aborted) return;` before `setUfcEvents(events)` and `setGames([])`
- Remove the early `return` on line 286; let UFC path fall through to the existing abort-check logic in `finally`
- No new dependencies or files

