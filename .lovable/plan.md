
## Plan

### 1. `src/components/home/ModernHomeLayout.tsx` (Today's Edge carousel)
- Locate the Today's Edge query + render block
- Query: `.eq('tier','edge').order('hit_rate',{ascending:false}).limit(5)`
- Filter client-side: `Math.abs(parseInt(odds)) < 500 && hit_rate >= 0.55`
- Render ALL picks via `.map()` in a horizontal snap carousel (`flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide`), each card `w-[280px] flex-shrink-0 snap-start`
- Player name: remove `truncate`, use `leading-tight break-words`, container `min-w-0`, allow 2-line wrap

### 2. See Why modal
- Locate where Today's Edge cards open the explainer (likely `PropExplainerDialog` or inline)
- Render confidence/verdict/reasoning **directly from the pick row** (`pick.hit_rate`, `pick.reasoning`, `pick.direction`, `pick.line`, `pick.prop_type`, `pick.odds`)
- Remove any live analyzer fetch on open
- Verdict label derived locally: `>=0.75 STRONG`, `>=0.65 LEAN`, else `MID`

### 3. `supabase/functions/slate-scanner/index.ts` — full-name resolution
- Add lightweight name normalizer per game using ESPN rosters already available via `nba-api`/`mlb-model`/`nhl-model`/`ufc-api` roster endpoints (or `games-schedule` payload if it includes rosters)
- For each prop's `playerName`, attempt match against the game's roster by last-name + initial; on match, store the full ESPN name in `player_name`
- Fallback: original odds-API string if no match
- Keep stored `hit_rate` = raw projected_prob (no re-transformation) so See Why and card show identical numbers

### 4. Verification (after deploy)
- Deploy `slate-scanner`, trigger via `supabase--curl_edge_functions` `POST /slate-scanner`
- `supabase--read_query`: 
  ```sql
  SELECT player_name, tier, hit_rate, odds, sport 
  FROM daily_picks 
  WHERE pick_date=CURRENT_DATE AND tier='edge'
  ORDER BY hit_rate DESC;
  ```
  Confirm 5 rows, full names (no "B. Miller"), hit_rate matches what UI will display
- Reload `/dashboard/home`, confirm:
  - Up to 5 edge cards in horizontal scroll
  - Names show in full / wrap
  - "See Why" confidence == card badge

### Schema note
`daily_picks` already has `player_name`, `hit_rate`, `reasoning`, `odds`, `direction`, `line`, `prop_type`, `tier`. No migration needed.

### Out of scope
Analyzer model, scoring logic, `edge_scoring.ts`, pricing, onboarding, schema migrations.

### Files touched
1. `src/components/home/ModernHomeLayout.tsx`
2. See Why modal component (located after read)
3. `supabase/functions/slate-scanner/index.ts`
