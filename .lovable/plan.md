

## Plan: Fix NHL Odds Prop Type Mapping

### Problem
NHL prop types use shorthand values (`sog`, `goals`, `g+a`, `ppg`, etc.) that don't map to the Odds API's expected market keys (`player_shots_on_goal`, `player_goals`, `player_power_play_points`, etc.). The edge function converts unknown prop types to `player_{propType}`, resulting in keys like `player_sog` which the API doesn't recognize.

### Solution
Add an NHL prop type mapping table in the edge function, similar to the existing `MLB_PROP_MAP`.

### File Changed

**`supabase/functions/nba-odds/index.ts`** — Add an `NHL_PROP_MAP` alongside the existing `MLB_PROP_MAP` (~line 469):

```
NHL_PROP_MAP = {
  goals: "player_goals",
  nhl_points: "player_points",
  nhl_assists: "player_assists",
  sog: "player_shots_on_goal",
  "g+a": "player_points",         // goals+assists = points in NHL
  ppg: "player_power_play_points",
  blocked_shots: "player_blocked_shots",
}
```

Then add a check after the MLB mapping block: if `sport === "nhl"` and the prop type is in `NHL_PROP_MAP`, use the mapped value.

### What Won't Change
- No client-side changes needed
- No UI changes
- NBA/MLB/UFC odds unaffected

