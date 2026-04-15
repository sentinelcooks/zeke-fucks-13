

## Plan: Replace Minutes Trend with At-Bats for MLB

### Problem
For MLB players, the "Minutes Trend" section shows `0 min avg` because MLB has no minutes — it should show **At-Bats per game** instead.

### Backend Changes (`supabase/functions/nba-api/index.ts`)

1. **Add `at_bats` to `GameRow` interface** (line ~225, after `stolen_bases`)
2. **Store `at_bats` in game push** (line ~407): `at_bats: abIdx >= 0 ? parseStat(stats[abIdx]) : 0`
3. **Make `minutesTrend` sport-aware** — accept a `sport` param; when `"mlb"`, use `g.at_bats` instead of `g.min` for the trend calculation
4. **Pass sport to `minutesTrend`** call (line ~2783)

### Frontend Changes

**`src/pages/NbaPropsPage.tsx`** (line ~2057, 2069)
- Change label: `sport === "mlb" ? "At-Bats Trend" : sport === "nhl" ? "TOI Trend" : "Minutes Trend"`
- Change unit: `sport === "mlb" ? "AB avg" : sport === "nhl" ? "TOI avg" : "min avg"`

**`src/components/ResultsPanel.tsx`** (line ~357-364)
- Same label/unit changes for MLB

**`src/pages/FreePropsPage.tsx`** (line ~491-503)
- Same label/unit changes for MLB

### Scope
- 1 edge function updated + redeployed
- 3 frontend files updated (label/unit swaps)

