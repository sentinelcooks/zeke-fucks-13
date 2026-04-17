

## Plan: Add team logos to Today's Edge moneyline / game-bet cards

### Root cause
In `src/components/home/ModernHomeLayout.tsx` (lines 538–584), the 52×52 header slot on each Today's Edge card has two branches:
- **Player props** (`!isGameBet`): renders the player headshot from `headshots[pick.player_name]`.
- **Game bets** (moneyline / spread / totals): renders only a 💰/📊/📈 emoji + the bet-type label. **No team logos are ever rendered**, even though `pick.home_team`, `pick.away_team`, and `pick.sport` are available, and `getTeamLogoUrl(team, sport)` already exists in `src/utils/teamLogos.ts` and returns ESPN CDN URLs (no base64 conversion needed — ESPN URLs render directly in `<img>`).

### Fix (single file: `src/components/home/ModernHomeLayout.tsx`)

Replace the game-bet branch of the logo slot (lines ~545–558) so it shows **two stacked team logos** (away over home) instead of an emoji:

```
┌────────────┐
│  [away]    │   ← away team logo, 22×22
│  [home]    │   ← home team logo, 22×22
└────────────┘
```

Implementation:
1. Import `getTeamLogoUrl` from `@/utils/teamLogos`.
2. Compute `sportKey = (pick.sport || 'nba').toLowerCase()` and cast to the supported union (`nba`/`mlb`/`nhl`/`nfl`); fall back to emoji branch if sport is unsupported (e.g. UFC).
3. Resolve `awayLogo = getTeamLogoUrl(pick.away_team || pick.opponent || '', sportKey)` and `homeLogo = getTeamLogoUrl(pick.home_team || pick.team || '', sportKey)`.
4. If at least one logo URL resolves, render both stacked vertically inside the existing 52×52 tile (each ~22×22, `objectFit: contain`, with `onError` hiding the broken `<img>` so the existing emoji fallback shows).
5. If neither resolves (e.g. UFC moneyline, unmapped team name), keep the current emoji + bet-type label as the fallback — no regression.

No edge-function, DB, or schema changes. No base64 conversion needed (the stack-overflow snippet about base64 doesn't apply here — that was for edge-function rendering; this is a direct browser `<img>` to ESPN CDN, which works fine and is already used elsewhere in the app, e.g. `src/components/MoneyLineSection.tsx`).

### Verification
1. Open `/dashboard/home` → scroll to Today's Edge.
2. Confirm moneyline cards (e.g. "Chicago White Sox" pick from screenshot) now show stacked away/home team logos in the left tile instead of the 💰 emoji.
3. Confirm spread + over/under game-bet cards also get logos.
4. Confirm player-prop cards still show headshots (unchanged branch).
5. Confirm UFC or any unmapped team gracefully falls back to the existing emoji.

