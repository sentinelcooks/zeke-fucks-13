

## Plan: Fix Frontend Hit Rate Filter + Add Best Available Fallback

### Problems Found

1. **Frontend filter blocks new picks**: `ModernHomeLayout.tsx` line 253 filters `p.hit_rate >= 70`, but the updated daily-picks function now generates picks at 60-61%. The 2 picks that were just generated (Brice Turang 61%, Elly De La Cruz 61%) exist in the DB but are filtered out by the frontend.

2. **Same filter in FreePicksPage.tsx**: Line ~157 also filters `hit_rate >= 70`.

3. **No "best available" fallback in the edge function**: The plan called for a fallback that takes top 10 picks by confidence (>45%) when fewer than ~5 picks pass the threshold. This was not implemented — the function only produced 2 picks total.

### Changes

**File: `src/components/home/ModernHomeLayout.tsx`**
- Lower the `hit_rate >= 70` filter on line 253 to `hit_rate >= 50` so picks from the lowered thresholds actually appear in the carousel
- Same change on line 266 for the fallback query

**File: `src/pages/FreePicksPage.tsx`**
- Lower the equivalent `hit_rate >= 70` filter to `hit_rate >= 50`

**File: `supabase/functions/daily-picks/index.ts`**
- Add the "best available" fallback from the original plan: after all phases, if `allPicks.length < 5`, collect all analyzed picks that scored >45% from a separate `allAnalyzed` array and fill up to 10 picks total. This ensures the carousel always has meaningful content.
- Track all analyzed picks (including those below threshold) in an `allAnalyzed` array throughout the function

### Technical Details

```text
Current: DB has 2 picks at 61% → frontend filters >= 70% → shows 0
Fixed:   DB has 2 picks at 61% → frontend filters >= 50% → shows 2
         + fallback fills to 10 picks from sub-threshold analyses
```

| File | Change |
|------|--------|
| `src/components/home/ModernHomeLayout.tsx` | Lower hit_rate filter from 70 to 50 |
| `src/pages/FreePicksPage.tsx` | Lower hit_rate filter from 70 to 50 |
| `supabase/functions/daily-picks/index.ts` | Add best-available fallback when <5 picks pass threshold |

