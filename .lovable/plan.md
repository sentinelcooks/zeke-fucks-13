

## Diagnosis

Live DB check: `daily_picks` and `free_props` for today are **empty** (0 rows). The hard cap `odds >= 500 → Pass` is already live in `edge_scoring.ts`. So the "1% / +5000" picks the user is still seeing must come from one of two paths:

1. **3-day fallback in `ModernHomeLayout.tsx` (lines 261-272)**: when today has no picks, the layout pulls rows from the last 3 days — including the old longshots from before the gates were tightened. This is the actual leak.
2. **No client-side odds guard**: even if the DB had a junk row, nothing filters it out before render.

The user's plan items are mostly correct but a few are already done or unnecessary. Here's the trimmed plan:

## Fix (2 files, no schema changes, no SQL needed — DB is empty)

### 1. `src/components/home/ModernHomeLayout.tsx` — client-side safety net + kill stale fallback
- **Remove the 3-day fallback (lines 261-272)** entirely. If today has no picks, show empty state. Never auto-promote stale picks into Today's Edge.
- **Tighten `hrOk` to 0.55** (was 0.5).
- **Add odds guard** in the same filter chain: drop any pick where `Math.abs(parseInt(odds)) >= 500`.
- **Defensive confidence display**: when computing the confidence ring, handle both decimal and percent storage (`raw > 1 ? raw : raw * 100`), and skip render if final percent < 55.

### 2. `supabase/functions/daily-picks/index.ts` — confirm unconditional wipe
- Verify the today-wipe of `daily_picks` and `free_props` is unconditional (runs every invocation, not gated). If gated, make it unconditional. Already done in the last patch — quick read to confirm.

## Skipped (already in place)
- SQL DELETE — DB is empty, nothing to delete.
- `edge_scoring.ts` hard cap — already live (line 116: `if (odds >= 500) return "Pass"`).
- `force` flag — `slate-scanner` already wipes + regenerates on every invocation.

## Verification
1. After deploy, run:
   ```sql
   SELECT player_name, odds, hit_rate, tier FROM daily_picks 
   WHERE pick_date = CURRENT_DATE ORDER BY tier DESC;
   ```
2. Trigger `slate-scanner` to repopulate today.
3. Re-run the SELECT, confirm zero rows with `|odds| >= 500` and zero with `hit_rate < 0.55`.
4. Reload Home, confirm Today's Edge shows only valid picks or empty state — no +5000 longshots.

## Files touched
1. `src/components/home/ModernHomeLayout.tsx` — remove 3-day fallback, add odds + hit_rate guard, defensive confidence display.
2. `supabase/functions/daily-picks/index.ts` — confirm wipe is unconditional (read-only check, edit only if needed).

