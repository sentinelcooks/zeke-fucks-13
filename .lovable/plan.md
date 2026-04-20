

## Goal

Stop "Today's Edge" from showing duplicates of the same pick (e.g. Josh Hart Under 0.5 Blocks appearing 3×). Verified in DB: today there are 3 identical rows for Josh Hart and 3 for Christian Braun — exact same `sport / player_name / prop_type / line / direction / pick_date / tier`.

## Root cause (verified)

Three layers all fail to enforce uniqueness:

1. **No DB-level unique constraint.** `daily_picks` only has a `PRIMARY KEY (id)`. Nothing in Postgres prevents identical rows.
2. **`daily-picks` edge function uses `DELETE then INSERT` (not transactional)** — `supabase/functions/daily-picks/index.ts` lines 735 + 768. If the function gets invoked twice in parallel (e.g. cron + manual `regenerate` from admin, or two browsers refreshing the home page during a regen), Run B deletes after Run A inserts, then both insert their own copies. With 3 duplicates we likely had 3 overlapping invocations.
3. **The home carousel reads everything raw** — `src/components/home/ModernHomeLayout.tsx` line 275/308 just `.select("*")` and filters by tier, so any duplicate row in the table renders as a duplicate card.

The in-function dedupe at line 680–686 (keyed by `sport|player|prop_type`) only protects within a single run; it can't protect against parallel runs.

## Fix (defense in depth)

### 1. DB migration — add unique index
Add a partial unique index on the natural identity of a pick so the database itself rejects duplicates:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS daily_picks_unique_per_day
ON public.daily_picks (
  pick_date, sport, tier,
  COALESCE(player_name,''),
  COALESCE(prop_type,''),
  COALESCE(direction,''),
  COALESCE(line, -9999)
);
```
Then de-dupe existing rows (keep oldest `id` per group) before creating the index, in the same migration.

### 2. `supabase/functions/daily-picks/index.ts`
- Replace the `INSERT` at line 768 with `upsert(rows, { onConflict: 'pick_date,sport,tier,player_name,prop_type,direction,line', ignoreDuplicates: true })`. With the new unique index, any concurrent run becomes a no-op for already-persisted rows instead of a duplicate.
- Keep the existing `DELETE` at line 735 (still wipes stale rows from earlier runs of the day) but wrap the delete+upsert sequence behind a simple in-process guard: store a row in a tiny `daily_picks_runs(date PRIMARY KEY, started_at)` table with `INSERT ... ON CONFLICT DO NOTHING` at the start of the function — if the insert returns no row, another run is already in flight and we exit early.

### 3. `src/components/home/ModernHomeLayout.tsx` (defensive client dedupe)
After line 289 (`allToday = …`), collapse to one entry per natural key so any pre-existing duplicate rows still in the DB render once:

```ts
const seen = new Set<string>();
const dedupedToday = allToday.filter(p => {
  const k = `${p.sport}|${p.player_name}|${p.prop_type}|${p.direction}|${p.line}|${p.tier}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
```
Use `dedupedToday` for the subsequent `edgeTier`/`dailyTier` split.

## Files changed

- New migration: add unique index + de-dupe existing rows + create `daily_picks_runs` lock table.
- `supabase/functions/daily-picks/index.ts` — switch insert→upsert, add run-lock guard.
- `src/components/home/ModernHomeLayout.tsx` — client-side dedupe before rendering carousel.

## Non-goals

- No changes to the scoring model, tier thresholds, grade-picks, or admin Edge History tab.
- No backfill of yesterday's data (we'll just dedupe today and forward).

## Verification

1. Open Home → Today's Edge: Josh Hart Under 0.5 Blocks appears **once**, Christian Braun Under 0.5 Blocks appears **once** (immediate fix from client dedupe).
2. Trigger `daily-picks` regen twice in quick succession from the admin tab → DB still has exactly one row per natural key (verified via `SELECT pick_date, player_name, prop_type, line, direction, COUNT(*) FROM daily_picks WHERE pick_date = CURRENT_DATE GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1` returning zero rows).
3. Edge History tab in Admin: counts and hit rate now reflect deduped reality, not inflated by triplicates.

