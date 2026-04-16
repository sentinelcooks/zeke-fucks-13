

## Plan: Fix Stale Moneyline Results When Changing Teams

### Root Cause

When the user navigates from Games with autoAnalyze (e.g., Grizzlies vs Pelicans), results render. Then when they manually change the team dropdowns to 76ers vs Magic, the **old results stay visible** because results are only cleared on sport change or at the start of `handleAnalyze`. If the subsequent API call errors silently (the catch block on line 1300 sets an error message but only if `results` was already nulled — and it is, but the error message may not be prominent enough), the user sees confusing stale data.

Additionally, there's a potential race condition: the `autoAnalyzeTriggered` ref and `didAutoAnalyze` state could cause the auto-analyze to fire with stale team values if the component doesn't fully remount.

### Fix

**`src/components/MoneyLineSection.tsx`** — Clear results immediately when either team selection changes:

Add a `useEffect` that watches `team1` and `team2` and clears `results` and `error`:

```typescript
// Clear stale results whenever teams change
useEffect(() => {
  setResults(null);
  setError("");
}, [team1, team2]);
```

This goes after the existing sport-change effect (around line 1259). It ensures:
1. Old results disappear the moment the user changes either team dropdown
2. No confusing mismatch between selected teams and displayed results
3. If the API call fails, the user sees the error — not old data from a different matchup

### Scope
- 1 file, ~3 lines added

