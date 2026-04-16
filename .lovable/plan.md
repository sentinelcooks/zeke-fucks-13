

## Plan: Make Parlays Count in P&L, Stats, Charts, and Play List

### Problem

When a parlay is added via the tracker, it only appears in the "Parlays" tab. It is excluded from:
1. **Plays tab list** — parlays don't show in the play feed
2. **Play stats cards** (Profit, ROI, Record, Pending) — parlays not included
3. **ProfitCharts** — only receives `plays`, not parlays
4. **PnLCalendar** — same issue, only `plays` data
5. **CSV export** — parlays excluded

Additionally, when a parlay result is marked (win/loss), the `payout` field on `parlay_history` is never updated — it stays at `0` profit.

### Solution

Create a **unified play list** that merges `plays` and `parlays` into a single data stream for stats, charts, calendar, and the Plays tab list.

### Changes

**File: `src/pages/ProfitTrackerPage.tsx`**

1. **Create `allPlays` merged array** — a `useMemo` that converts each `SavedParlay` into a `Play`-compatible shape and concatenates with `plays`:
   - `id` → parlay id
   - `player_or_fighter` → "Parlay (N legs)"
   - `bet_type` → "Parlay"
   - `odds` → `parlay_odds`
   - `stake` → parlay stake
   - `payout` → on win: `potential_payout - stake`, on loss: `-stake`, on pending: `0`
   - `result` → parlay result
   - `created_at` → parlay created_at
   - `sport` → first leg's sport or "parlay"

2. **Update `playStats`** to use `allPlays` instead of `plays`

3. **Update `ProfitCharts`** to receive `allPlays` instead of `plays`

4. **Update `PnLCalendar`** (if rendered) to receive `allPlays`

5. **Update `filteredPlays`** to filter from `allPlays`

6. **Update `playsDates`** to derive from `allPlays`

7. **Update `exportToCSV`** to include parlay entries

8. **Fix `updateParlayResult`** — when marking win, set `profit` to `potential_payout - stake`; when loss, set `profit` to `-stake`. This ensures the merged view has correct payout values.

9. **In the plays list rendering**, detect parlay items and show a "Parlay" badge. When clicking W/L on a parlay in the plays list, call `updateParlayResult` instead of `updatePlayResult`.

### Technical Details

```typescript
// Merged plays array
const allPlays = useMemo(() => {
  const parlayAsPlays: Play[] = parlays.map(p => ({
    id: p.id,
    sport: (p.legs?.[0]?.sport || "parlay").toLowerCase(),
    player_or_fighter: `Parlay (${p.legs?.length || 0} legs)`,
    bet_type: "Parlay",
    line: null,
    odds: p.parlay_odds,
    stake: p.stake,
    result: p.result,
    payout: p.result === "win" ? p.potential_payout - p.stake 
          : p.result === "loss" ? -p.stake : 0,
    notes: null,
    created_at: p.created_at,
  }));
  return [...plays, ...parlayAsPlays];
}, [plays, parlays]);
```

### Files Modified

| File | Change |
|------|--------|
| `src/pages/ProfitTrackerPage.tsx` | Merge parlays into allPlays, update stats/charts/calendar/filters/export, fix parlay result payout |

