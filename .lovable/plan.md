

## Plan

Route every analyzer-validated pick from `slate-scanner` so that the top 5 surface in Today's Edge (already in place) and the remainder flow into the Picks tab under the correct sport tab.

### 1. `supabase/functions/slate-scanner/index.ts`
- Keep the new flow: prefilter → analyzer call → strict floor (`confidence ≥ 65`, `edge > 0.025`, no `PASS/FADE`, no injured players).
- After analyzer validation, write **all** surviving picks to `daily_picks` (not just edge tier):
  - Top 5 overall (max 2/sport) → `tier = 'edge'`
  - Next batch per sport (cap ~15/sport) → `tier = 'daily'`
  - Anything below `confidence 70` but ≥ 65 → `tier = 'value'`
- Store `sport` on every row so the Picks tab can group.

### 2. `src/pages/FreePicksPage.tsx` (Picks tab)
- Confirm it queries `daily_picks` for today and renders by `sport`.
- Add tab/section grouping: NBA / MLB / NHL / UFC, sorted by `hit_rate desc` within each.
- Exclude rows already shown in Today's Edge carousel? No — show all so the tab is the full slate; mark edge picks with a small "Edge" chip.
- Reuse the same "See why" → `/dashboard/analyze` navigation pattern from `ModernHomeLayout.tsx` so analyzer output stays the source of truth.

### 3. Verification
- Deploy `slate-scanner`, trigger `POST /slate-scanner?debug=true`, paste counts per sport/tier.
- SQL:
  ```sql
  SELECT sport, tier, COUNT(*) 
  FROM daily_picks 
  WHERE pick_date = CURRENT_DATE 
  GROUP BY sport, tier ORDER BY sport, tier;
  ```
- Reload `/dashboard/home` → 5 edge cards. Open `/dashboard/picks` → confirm remaining picks appear under correct sport sections, all with realistic standard lines and no injured players.

### Out of scope
Analyzer model, edge_scoring, card UI styling, onboarding, paywall, free_props cron.

### Files touched
1. `supabase/functions/slate-scanner/index.ts`
2. `src/pages/FreePicksPage.tsx`

