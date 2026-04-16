

## Diagnosis Summary

### 1. Does `logSnapshot()` exist?
**Yes** — defined in `supabase/functions/nba-api/index.ts` at **line 293**. Uses `SUPABASE_SERVICE_ROLE_KEY` correctly (bypasses RLS).

### 2. Is it called in every `/analyze` handler?

| File | Status | Line |
|------|--------|------|
| `supabase/functions/nba-api/index.ts` | ✅ Called | 3618 |
| `supabase/functions/mlb-model/index.ts` | ❌ **Missing** | — |
| `supabase/functions/nhl-model/index.ts` | ❌ **Missing** | — |
| `supabase/functions/ufc-api/index.ts` | ❌ **Missing** | — |
| `supabase/functions/moneyline-api/index.ts` | ❌ **Missing** | — |

Search confirmed: zero matches for `logSnapshot` / `prediction_snapshots` in the other 4 files.

### 3. Service role key usage
The helper in `nba-api` reads `SUPABASE_SERVICE_ROLE_KEY` and uses REST API directly — correct, bypasses RLS. The other functions don't have a helper at all.

### 4. Silent catch
Yes — `nba-api/index.ts` line 3639: `.catch(() => {})` swallows errors. Will fix to log.

### 5. Edge function logs
Recent `nba-api` logs show only boots/shutdowns, no insert errors. No useful failure trace because it never ran for non-NBA paths.

### 6. Database actual count
`select count(*) from prediction_snapshots` returned **3 rows** (1 NBA, 2 NHL via nba-api). All three came through `nba-api/analyze` — confirming the helper works, but only that endpoint logs.

**Why the user saw zero / few rows:** UFC matchups go to `ufc-api/matchup`, moneyline games go to `moneyline-api/analyze`, and the daily-picks generator hits `mlb-model`, `nhl-model`, `moneyline-api` directly — none of which log snapshots.

---

## Fix Plan

### A. Add a shared `logSnapshot()` helper to each missing function
Copy the same fire-and-forget REST helper (using `SUPABASE_SERVICE_ROLE_KEY`) into:
- `supabase/functions/mlb-model/index.ts`
- `supabase/functions/nhl-model/index.ts`
- `supabase/functions/ufc-api/index.ts`
- `supabase/functions/moneyline-api/index.ts`

### B. Wire `logSnapshot()` into each `/analyze` (and ufc `/matchup`) success path
Insert minimal payloads right before the final `return json(prediction)`:

- **mlb-model** (~line 836): log `sport=mlb`, `market_type=bet_type`, player or team names, confidence, verdict (PASS/LEAN/STRONG via threshold), top factors.
- **nhl-model** (~line 820): same pattern, `sport=nhl`.
- **moneyline-api** (`/analyze`): log `sport` from request, `market_type=moneyline|spread|total`, teams, confidence, odds if present.
- **ufc-api** (`/matchup`): log `sport=ufc`, `market_type=moneyline`, fighter1 vs fighter2, model confidence.

All calls fire-and-forget with `.catch(err => console.error('logSnapshot failed:', err))`.

### C. Fix the silent catch in nba-api
Replace `.catch(() => {})` on line 3639 with `.catch(err => console.error('logSnapshot failed:', err))`.

### D. Verify after deploy
1. Note current count (3).
2. Run an NBA prop analysis from the UI.
3. Run an MLB or NHL game analysis.
4. Wait 10s, query `select count(*), sport from prediction_snapshots group by sport`.
5. Confirm new rows appeared for each sport hit; report count in completion message.

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/mlb-model/index.ts` | Add `logSnapshot` helper + call before final return |
| `supabase/functions/nhl-model/index.ts` | Add `logSnapshot` helper + call before final return |
| `supabase/functions/ufc-api/index.ts` | Add `logSnapshot` helper + call in `/matchup` return |
| `supabase/functions/moneyline-api/index.ts` | Add `logSnapshot` helper + call in `/analyze` return |
| `supabase/functions/nba-api/index.ts` | Replace silent catch with logged catch |

### Out of Scope
- No frontend changes
- No schema changes (tables already exist with correct RLS + service role bypass)
- No changes to existing factor calculations

