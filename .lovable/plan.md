

## Plan: Sort Past Meetings Newest-First + Defensive H2H Date-Range Hardening

### What I verified (live curl results)
I called the deployed `moneyline-api/analyze` for three matchups today (2026-04-17):

| Sport | Matchup | H2H games returned | 2026 games included? |
|---|---|---|---|
| NBA | Heat vs Magic | 5 (10/22/25, 12/06/25, 12/09/25, **01/29/26**, **03/15/26**) | ✅ Yes (2 of 5) |
| NHL | Oilers vs Kings | 3 (**01/11/26**, **02/27/26**, **04/11/26**) | ✅ Yes (all 3) |
| MLB | Yankees vs Red Sox | 6 (all from Aug–Sep 2025) | ❌ No 2026 games — but ESPN confirms first 2026 meeting is **April 21, 2026** (4 days from now). The fallback to 2025 season is correct. |

So the backend is **already** fetching the current season correctly: `getSeasonForSport` uses today's date (`month >= 9 ? year+1 : year`) → returns `2026` for NBA/NHL/NCAAB and `year` (2026) for MLB, and `extractH2HFromEvents` uses the union check `comp?.status?.type?.completed === true || comp?.status?.type?.name === "STATUS_FINAL"` exactly as the user requested.

### Real root cause of the user's perception
The **frontend H2HTable renders games in ESPN's natural order — chronological ascending (oldest first)**. So a user looking at "Past Meetings" sees `10/22/25, 12/06/25, 12/09/25, 1/29/26, 3/15/26` from top to bottom. The 2025 dates sit at the top, the 2026 dates sit below. On a 390px viewport this can read as "data cuts off at 2025" if the user doesn't scan the full table.

### Changes (frontend + small backend hardening)

**1. `src/components/MoneyLineSection.tsx` — `H2HTable` (line 600)**
   - Sort the array **descending by date** before mapping rows so 2026 games appear first: `const sorted = [...h2h].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())`.
   - Same sort applied in `H2HChart` (line 159), `DifferentialChart`, and `TotalChart` consumers — actually leave the chart in chronological asc order (charts read left→right by time), only sort the **table** descending.

**2. `src/components/MoneyLineSection.tsx` — display the season in the header**
   - Update the `<Section title="Past Meetings">` heading to `Past Meetings (2025–26 Season + Last Season)` so the user can immediately see the date range covered. Sport-aware label (e.g. `2026 Season + Last Season` for MLB).

**3. `supabase/functions/moneyline-api/index.ts` — `getTeamSchedule` (line 138) hardening**
   - Currently: returns the FIRST URL's events when `events.length > 10`. Issue: this skips `seasontype=3` (playoffs) — for NBA today (April, in the play-in/playoffs window), regular-season-only is fine for H2H but we should guarantee we cover the full season window. 
   - Change: always **merge** events from `season=current&seasontype=2` AND `season=current&seasontype=3` (regular + playoffs) into one deduped array (key on `event.id`) before returning. Keeps response shape identical, just adds any post-season meetings.
   - Keep the existing previous-season fallback in `getHeadToHead` exactly as-is (used when current-season H2H is empty — e.g. MLB today).

**4. `supabase/functions/moneyline-api/index.ts` — `extractH2HFromEvents`**
   - No status-filter change needed (already uses the requested union). 
   - Add explicit sort: `h2h.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())` before returning, so backend ALSO returns newest-first as a contract guarantee for any other consumer.

**5. Sport coverage check**
   - All 5 sports (NBA/MLB/NHL/NFL/NCAAB) flow through the same `getHeadToHead → getTeamSchedule → extractH2HFromEvents` path in `moneyline-api`. The hardening in step 3-4 applies to all of them automatically.
   - `mlb-model` and `nhl-model` only consume `schedule1`/`schedule2` for factor scoring (`computeH2H`, `computeLast5`, etc.) and don't produce a separate `head_to_head` array — `moneyline-api` always overrides with its own canonical `head_to_head`. Already consistent.

### Verification (in default mode)
1. Deploy `moneyline-api` and re-curl the three matchups above.
2. Confirm `head_to_head` is sorted descending (most recent first) in JSON output.
3. Visual check on `/dashboard/analyze` for Heat vs Magic — confirm `Past Meetings` table shows `3/15/26` and `1/29/26` at the **top** of the table.
4. Repeat for an NHL matchup → confirm 2026 dates at top.
5. Repeat for MLB Yankees vs Red Sox (after April 21, the first 2026 meeting will appear; until then, last-season fallback is correct).
6. Paste curl JSON slices showing 2026 dates in position [0] of `head_to_head`.

### Out of scope
- No DB / RLS changes.
- No factor scoring changes.
- No new endpoints — purely sort + season-window hardening + UI label.
- Past meetings remains sport-agnostic; same code path for all leagues.

