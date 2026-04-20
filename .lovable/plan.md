

## Goal

Add a **"Today's Edge History"** section to the Admin dashboard that logs every `tier="edge"` pick generated, shows running performance metrics (hit rate, wins/losses/pushes, streak), and lets admins manually update results. Persisted in the existing `daily_picks` table — no schema changes beyond adding a `push` result option.

## Why this is mostly free

The `daily_picks` table already stores every required field (`pick_date`, `sport`, `home_team`, `away_team`, `player_name`, `prop_type`, `line`, `direction`, `hit_rate` (=confidence at pick time), `odds`, `result`, `tier`, `created_at`). The `daily-picks` edge function already persists every Today's Edge pick with `tier="edge"`, and `grade-picks` already auto-updates `result` to `"hit"`/`"miss"`. So the data is already being logged — we just need to surface it.

## Changes

### 1. `supabase/functions/admin-onboarding/index.ts` — add 2 actions
Extend the existing admin endpoint (already password-gated by `ADMIN_SECRET_PASSWORD`):

- **`list_edge_history`** — accepts optional `{ start_date, end_date, sport }` filters. Returns all `daily_picks` rows where `tier = 'edge'`, ordered by `pick_date` desc, plus an aggregate block:
  ```
  { picks: [...], stats: { total, resolved, wins, losses, pushes, pending,
    hit_rate, current_streak: { type: 'W'|'L', count } } }
  ```
  Streak computed from resolved picks in chronological order (`hit`→W, `miss`→L, `push` ignored).

- **`update_edge_result`** — accepts `{ pick_id, result }` where `result ∈ {"hit","miss","push","pending"}`. Updates the row's `result` column. Used by the manual override UI.

### 2. `src/pages/AdminPage.tsx` — add new tab
- Add a third tab next to the existing **Keys** and **Onboarding** tabs: **"Edge History"** (icon: `History` from lucide-react).
- Tab content layout:

```text
┌─────────────────────────────────────────────────────────┐
│  HIT RATE   TOTAL   W / L / P   PENDING   STREAK        │
│   62.5%      48      30/18/0      6        🔥 W4        │
└─────────────────────────────────────────────────────────┘

[Date range: ▾ Today | 7d | 30d | All | Custom ]   [Sport ▾]

┌──────────────────────────────────────────────────────────┐
│ Date       Sport  Matchup           Pick           Conf  │
│                                     Line   Odds   Result │
├──────────────────────────────────────────────────────────┤
│ Apr 19     NBA   LAL @ GSW          LeBron O 24.5 67%    │
│                                     -110          [W][L][P][↺] │
└──────────────────────────────────────────────────────────┘
```

- **Stat cards row** at top: large number for **Hit Rate %** (green if ≥55%, yellow 50-54%, red <50%), then small tiles for Total, Wins, Losses, Pushes, Pending, and a streak chip (🔥 W4 in green for win streak ≥3, ❄️ L3 in red for loss streak).
- **Date range filter**: 4 quick presets (Today / 7d / 30d / All) + a custom range using shadcn `DatePicker` (two `Popover`+`Calendar` with `pointer-events-auto`).
- **Sport filter**: dropdown with `All / NBA / MLB / NHL / UFC`.
- **Table row**: shows `pick_date`, sport pill (reuses `SPORT_COLORS`), matchup (`away_team @ home_team` for moneyline, or `player_name (team vs opponent)` for props), pick (`prop_type direction line` or `bet_type team`), confidence %, odds, and result badge:
  - `hit` → green ✓ Win
  - `miss` → red ✗ Loss
  - `push` → gray Push
  - `pending` → yellow Pending
- Each row has a small inline action menu: **W / L / P / Reset** buttons that call `update_edge_result`. Single click → optimistic update + reload stats.
- Loading + empty states; client-side filter applied after fetch (server returns all, frontend re-filters on date preset change without refetch unless custom range crosses fetched window).

### 3. No DB migration needed
- `result` column is `text` with no CHECK constraint — `"push"` is already storable.
- `tier="edge"` already populated by `daily-picks`.
- RLS on `daily_picks` allows service role full access — the edge function uses service key, so reads + updates work without policy changes.

## Files changed

- `supabase/functions/admin-onboarding/index.ts` — add `list_edge_history` and `update_edge_result` actions.
- `src/pages/AdminPage.tsx` — add **Edge History** tab with stats header, date+sport filters, results table, inline result-update buttons.

## Non-goals

- No schema changes, no new tables.
- No backfill (history starts from whatever's already in `daily_picks` with `tier='edge'`).
- No changes to `daily-picks`, `grade-picks`, or the user-facing Today's Edge carousel.
- No CSV export (can be added later).

## Verification

1. Authenticate to `/dashboard/admin` → see new **Edge History** tab.
2. Switch to it: stats header shows correct totals; table lists every `daily_picks` row with `tier='edge'` newest first.
3. Apply **7d** preset → table + stats narrow to the last 7 days; switch to **All** → returns full set.
4. Apply **Sport: NBA** filter → only NBA edge picks shown; stats recompute.
5. Click **W** on a `pending` row → row instantly shows green Win, hit rate + wins increment, streak updates. Refresh page → change persisted.
6. Click **Reset** on a resolved row → reverts to Pending, stats recompute.
7. Pick a custom date range covering yesterday → confirm yesterday's `daily_picks` rows appear with whatever result `grade-picks` assigned.

