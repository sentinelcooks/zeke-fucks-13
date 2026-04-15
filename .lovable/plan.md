

## Plan: Make AI Impact Analysis Sport-Aware

### Problem
The `analyzeInjuryImpact` function in `supabase/functions/nba-api/index.ts` uses generic/NBA-centric terminology like "at-bats/usage", "shot attempts", "floor time" regardless of sport. The screenshot shows "at-bats/usage" appearing for what should be sport-specific language.

### Changes — `supabase/functions/nba-api/index.ts`

1. **Add `sport` parameter** to `analyzeInjuryImpact` function signature (line 946)

2. **Replace generic line 968** with sport-specific usage text:
   - NBA: `"Expect increased minutes/usage for {player}..."`
   - MLB: `"Expect increased at-bats/usage for {player}..."`
   - NHL: `"Expect increased ice time/TOI for {player}..."`
   - NFL: `"Expect increased snaps/targets for {player}..."`
   - UFC: `"Expect increased striking/grappling volume for {player}..."`

3. **Make prop-type insights sport-aware** (lines 970-984):
   - NBA props (points, 3-pointers, assists, rebounds): "More shot attempts", "handle ball more", "More floor time"
   - MLB props (hits, total_bases, home_runs, rbi): "Lineup adjustment", "Batting order shift", "plate appearances"
   - NHL props (goals, assists, shots_on_goal, points): "More ice time on PP", "increased SOG", "power play promotion"
   - NFL props (passing_yards, rushing_yards, receptions): "More snaps", "increased targets", "routes run"
   - UFC props: "More striking output expected", "grappling exchanges"

4. **Update line 997** ("shift rotations") to be sport-specific:
   - NBA: "shift rotations"
   - MLB: "shift lineup/bullpen usage"
   - NHL: "shift line combinations"
   - NFL: "shift offensive scheme"

5. **Update call site** (line 2788-2791) to pass `sport` as 6th argument

### Scope
- 1 edge function updated, no frontend changes

