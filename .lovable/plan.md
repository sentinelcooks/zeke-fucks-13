

## Plan: Add MLB Scoring Zones (Baseball Diamond Visualization)

### What Changes

**1. Backend — `supabase/functions/nba-api/index.ts`**

Add a `computeMlbScoringZones(games: GameRow[])` function that derives zone data from existing MLB game log stats (hits, home_runs, total_bases, walks, stolen_bases, runs, rbi). Zones on a baseball diamond:

- **Infield** (cx: 50, cy: 62) — singles/grounders, derived from `hits - home_runs - estimated_extra_base`
- **Outfield Left** (cx: 20, cy: 35) — portion of extra-base hits
- **Outfield Center** (cx: 50, cy: 25) — portion of extra-base hits  
- **Outfield Right** (cx: 80, cy: 35) — portion of extra-base hits
- **Over the Fence** (cx: 50, cy: 12) — home runs
- **On Base** (cx: 15, cy: 80) — walks (OBP contribution)

Each zone shows a percentage (e.g., hit rate or share of total bases) and attempt count. Wire it into the existing `shot_chart` result block alongside the NHL check (~line 2769), setting `shot_chart_type: "mlb"`.

**2. Frontend — `src/components/mobile/ShotChart.tsx`**

Add a `BaseballDiamond` SVG component matching the style of `NhlRink` and `BasketballCourt`:
- Dark background with subtle diamond/field lines (basepaths, infield arc, outfield fence arc, bases, home plate, pitcher's mound)
- Same animated zone bubbles with `motion.circle`, color coding, and arc trails pointing toward home plate
- Same gradient accent line and glow filter pattern

Update the main `ShotChart` export to detect `mlb` sport and render `BaseballDiamond`. Update empty-state text for MLB context.

**3. Frontend — `src/pages/NbaPropsPage.tsx`**

Update the Section title logic (~line 1901) to include MLB: show "Hit Zones" or "Scoring Zones" for MLB props.

**4. Frontend — `src/pages/FreePropsPage.tsx`**

Same Section title update if MLB is referenced there.

### What Won't Change
- NBA basketball court and NHL rink visualizations stay identical
- No database migrations needed
- All existing zone color/styling helper functions are reused

