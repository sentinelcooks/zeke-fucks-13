
## Plan

Revert the See Why inline modal. Tapping "See Why" should navigate to the Analyze page with auto-analyze pre-fill so the user always sees the live analyzer's verdict (no stored fake values).

### 1. `src/components/home/ModernHomeLayout.tsx`
- Remove `seeWhyPick` state and the entire `<AnimatePresence>{seeWhyPick && …}` modal block (lines ~1005–1090).
- Remove `setSeeWhyPick` declaration (line ~223).
- Replace the "See why →" button onClick with a `navigate()` call:
  - For player props (`pick.bet_type === 'prop'` or undefined): navigate to `/dashboard/analyze` with state:
    ```ts
    {
      autoAnalyze: true,
      sport: pick.sport,
      player: pick.player_name,
      prop_type: pick.prop_type,
      line: Number(pick.line),
      over_under: pick.direction,    // 'over' | 'under'
      opponent: pick.opponent_team || '',
    }
    ```
  - For game-line picks (`bet_type` = `moneyline` / `spread` / `total`): navigate to `/dashboard/moneyline` with state:
    ```ts
    {
      autoAnalyze: true,
      sport: pick.sport,
      home_team: pick.home_team,
      away_team: pick.away_team,
    }
    ```
- UFC props: same `/dashboard/analyze` route (NbaPropsPage handles `sport: 'ufc'` already in its auto-analyze useEffect).

This matches the existing pattern already used in `ProfitTrackerPage` (line 932) and `GamesPage` (line 739), so no changes needed in `NbaPropsPage` / `MoneyLineSection`.

### 2. Verification
- `code--view` updated `ModernHomeLayout.tsx` to confirm modal block + state removed and navigate calls in place.
- `supabase--read_query`:
  ```sql
  SELECT player_name, sport, prop_type, line, direction, bet_type, home_team, away_team
  FROM daily_picks
  WHERE pick_date = CURRENT_DATE AND tier = 'edge'
  ORDER BY hit_rate DESC;
  ```
  Confirm the columns we pass via nav state are populated for current edge picks.
- Manual: tap "See why" on an edge card in preview → lands on `/dashboard/analyze` with the player/prop pre-filled and the live analyzer running.

### Out of scope
Slate-scanner, edge_scoring, analyzer model, card layout/truncation (already fixed), pricing, onboarding.

### Files touched
1. `src/components/home/ModernHomeLayout.tsx` only.
