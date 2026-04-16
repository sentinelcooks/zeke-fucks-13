

## Plan: Fix Moneyline Page Showing Stale Results on Re-navigation

### Root Cause

When the user navigates from Games → Moneyline with `autoAnalyze: true` for one matchup (e.g., Pelicans vs Grizzlies), then goes back to Games and navigates again for a different matchup (Magic vs 76ers), React **reuses the same `MoneyLineSection` component instance**. The internal state (`didAutoAnalyze = true`, `autoAnalyzeTriggered.current = true`, and old `results`) persists, so the new `initialTeam1`/`initialTeam2` props are ignored and the old results keep showing.

### Fix

**`src/pages/MoneyLinePage.tsx`** — Add a `key` prop to `MoneyLineSection` that changes whenever the navigation state changes, forcing React to unmount and remount the component with fresh state:

```tsx
<MoneyLineSection
  key={`${state?.home_team}-${state?.away_team}-${state?.sport}`}
  initialTeam1={state?.home_team}
  initialTeam2={state?.away_team}
  initialSport={state?.sport}
  autoAnalyze={state?.autoAnalyze}
/>
```

### Scope
- 1 file, 1 line changed — adds a `key` prop to force re-render on new matchup navigation.

