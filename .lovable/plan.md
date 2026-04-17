
## Goal
Make the Games tab sport tabs adopt the same sport-themed active background as the Analyze tab (currently they all turn the global green `bg-accent`).

## Reference (Analyze tab pattern)
Active pill uses `linear-gradient(135deg, ${color}, ${color}dd)` with matching colored shadow:
- NBA `#1D428A` (blue), MLB `#002D72` (navy), NHL `#111111` (black), UFC `#3a1518` (maroon)

## Change — single file: `src/pages/GamesPage.tsx`

1. Add a `SPORT_COLOR` map (NFL gets `#013369` — official league navy):
   ```ts
   const SPORT_COLOR: Record<SportFilter, string> = {
     nba: "#1D428A", mlb: "#002D72", nhl: "#111111",
     nfl: "#013369", ufc: "#3a1518",
   };
   ```

2. Replace the active class `bg-accent text-accent-foreground shadow-lg` in the sport toggle map (line ~991-995) with the same active inline-style approach used in `NbaPropsPage.tsx`:
   - Active: `text-white` + `style={{ background: linear-gradient(135deg, color, color+'dd'), boxShadow: '0 4px 16px -2px ' + color + '55' }}`
   - Inactive: keep existing muted text classes

3. Optional polish: tint the top ambient orb (line 980) to match the active sport color so the page atmosphere subtly shifts when switching sports — same effect Analyze achieves with its colored pill.

No other logic/state/data touched.

## Verification
- Visual: switch tabs at `/dashboard/games` and confirm NBA → blue, MLB → navy, NHL → black, NFL → navy-blue, UFC → maroon (matches Analyze).
- Compare side-by-side with Analyze tab pills.
