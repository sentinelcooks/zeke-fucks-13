

## Plan: Fix Broken Team Logos

### Root Cause
The `games-schedule` edge function already returns `home_logo` and `away_logo` fields directly from ESPN's API (reliable CDN URLs). But the `Game` interface in `GamesPage.tsx` doesn't include these fields, so the page falls back to `getTeamLogoUrl()` which does a name-based lookup that fails when team names don't match exactly.

### Changes

**1. `src/pages/GamesPage.tsx` — Use ESPN logos directly + add fallback**

- Add `home_logo?: string` and `away_logo?: string` to the `Game` interface
- Replace `getTeamLogoUrl(game.away_team, ...)` with `game.away_logo` (and same for home), falling back to `getTeamLogoUrl()` if the field is missing
- Wrap each `<img>` with an `onError` handler that hides the image and shows a colored circle with team initials instead

**2. `src/utils/teamLogos.ts` — Keep as fallback, no changes needed**

The existing function remains as a secondary fallback for pages where ESPN logo URLs aren't available.

### Technical Details

Logo rendering pattern (used for both home and away):
```tsx
const logoUrl = game.away_logo || getTeamLogoUrl(game.away_team, sport);
// Render with onError fallback to initials circle
```

Initials fallback: extract first letter of each word from team name (e.g., "Boston Celtics" → "BC"), render in a 20×20 colored circle with `bg-white/10` and muted text.

### Scope
- Single file change: `src/pages/GamesPage.tsx`
- No new dependencies

