

## Plan: Unify All Sports to NBA's Visual Design

### Current State

The app has **two separate analysis UIs**:

1. **MoneyLineSection.tsx** (1835 lines) — Used for NBA, MLB, NFL, NHL, NCAAB. Already renders ALL sports identically with the Vision UI dark glassmorphism design (vision-card panels, EV hero card, edge projection bar, best line card, sportsbook list, H2H charts, factor breakdown bars, injury report, home/away splits, B2B/pace cards, written analysis).

2. **MlbPredictionsPage.tsx** (472 lines) — A completely separate MLB-only page at `/dashboard/mlb-predictions` with a different visual language (lighter `bg-primary/5` cards, shadcn Tabs/Collapsible, different factor bars, no EV/odds/sportsbook sections). This is the only page that diverges from the NBA design.

**The MoneyLineSection already handles MLB, NFL, NHL, NCAAB with the exact same NBA design.** The only outlier is the standalone MlbPredictionsPage.

### What I'll Do

**1. Remove the MlbPredictionsPage route and redirect it**
- Change the `/dashboard/mlb-predictions` route in `App.tsx` to redirect to `/dashboard/moneyline` (which already supports MLB via the sport toggle in MoneyLineSection)
- Update `BottomTabBar.tsx` mapping for `mlb-predictions` path
- Remove the `MlbPredictionsPage` import from `App.tsx`

**2. Verify MoneyLineSection sport-specific terminology**
- Confirm the spread label says "Run Line" for MLB and "Puck Line" for NHL (currently both show generic "Spread")
- Add sport-aware label mapping in the bet type tabs and odds sections:
  - MLB: Spread → Run Line
  - NHL: Spread → Puck Line  
  - NFL/NCAAB/NBA: Spread (as-is)

**3. Update any navigation links pointing to mlb-predictions**
- Search for and redirect any internal links to the unified moneyline page with MLB pre-selected

### Files Changed
- `src/App.tsx` — Remove MlbPredictionsPage import, redirect route
- `src/components/mobile/BottomTabBar.tsx` — Update path mapping
- `src/components/MoneyLineSection.tsx` — Add sport-specific market terminology (Run Line, Puck Line)
- `src/pages/MlbPredictionsPage.tsx` — Can be deleted (no longer referenced)

### What Won't Change
- No backend logic, edge functions, or data fetching
- No routing structure changes beyond the redirect
- MoneyLineSection already handles all sports identically — no new components needed

