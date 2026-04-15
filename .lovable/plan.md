

## Plan: Fix Correlated Props Not Working

### Root Cause
Two issues are preventing correlated props from returning results:

1. **Frontend sends empty team**: The frontend extracts team via `data.team || data.player_info?.team` but the `analyzeProp` response stores it at `data.player.team_abbr`. So `team` is always `""`.

2. **Edge function team detection fails**: When the correlated-props function receives an empty team, it tries ESPN search to detect the team, but the ESPN search response format (`searchData.items[0].team?.abbreviation`) doesn't match the actual response structure. The player's team comes nested differently.

3. **No error surfaced**: When 0 correlations are found, the UI silently shows nothing instead of a helpful message.

### Changes

**1. `src/pages/NbaPropsPage.tsx`** — Fix team extraction (2 locations)

Replace:
```ts
const playerTeam = data.team || data.player_info?.team || "";
```
With:
```ts
const playerTeam = data.team || data.player?.team_abbr || data.player?.team || data.player_info?.team || "";
```
At lines 585 and 726.

Also add "Correlated props unavailable" fallback text when `corrProps.length === 0` and not loading (around line 2181), replacing the current empty state.

**2. `src/pages/FreePropsPage.tsx`** — Same team extraction fix

Replace line 265:
```ts
const playerTeam = data.team || data.player_info?.team || prop.team || "";
```
With:
```ts
const playerTeam = data.team || data.player?.team_abbr || data.player?.team || data.player_info?.team || prop.team || "";
```

**3. `supabase/functions/correlated-props/index.ts`** — Improve team detection fallback

When ESPN search doesn't return a team abbreviation, fetch the athlete endpoint directly (`/athletes/{id}`) to get the team. Also add a `team.$ref` fallback. Add logging for better debugging.

**4. UI fallback** — Show "Correlated props unavailable" message in both NbaPropsPage and FreePropsPage when the function returns empty or errors, instead of silently hiding the section.

### Scope
- 2 frontend files (team extraction + error UI)
- 1 edge function (team detection fallback + logging)
- Redeploy correlated-props

