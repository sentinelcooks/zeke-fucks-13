

## Goal

Make the Picks tab scan **every game on the Games-tab schedule**, not a 16-event slice. The Games tab data source (`games-schedule` edge function) already returns the full ESPN-derived list — the scanner must iterate over all of it for both game-line and player-prop evaluation.

## Root cause (confirmed in `supabase/functions/_shared/sport_scan.ts`)

1. **Player-prop scan is capped at 16 events** — `evaluatePlayerProps()` lines 263–271:
   - Pulls upcoming events from `nba-odds/events` (Odds-API), not from `games-schedule`.
   - Applies a 36-hour cutoff (line 263) that excludes later-in-the-week games visible on the Games tab.
   - Hard-caps to `.slice(0, 16)` (line 271).
2. **Game-line scan silently drops schedule games without an Odds-API event match** — `evaluateGameLines()` lines 181–204:
   - Reads the full Games-tab schedule via `games-schedule?sport=...` (good).
   - Builds `oddsMap` keyed by exact lowercase `home|away` names — any name mismatch (ESPN vs Odds-API naming) means the game is skipped, never scored.
3. **Analyzer cap of 20 across the entire sport** — line 488: `ANALYZER_CAP = 20` further bottlenecks how many candidates from a fully-expanded slate actually get validated into picks.

## Fix — `supabase/functions/_shared/sport_scan.ts` only

### 1. Drive player-prop scanning off the Games-tab schedule (lines 254–272)

Replace the 16-event Odds-API slice with the full upcoming game list from `games-schedule?sport=<sportKey>` — the same source `evaluateGameLines` and the Games tab use. Then match each scheduled game to its Odds-API event by `home|away` name key (with both name orderings as a fallback) so we know which `eventId` to fetch player props for. No 36h cutoff, no hard cap.

```ts
// fetch the full Games-tab schedule (same source as Live/Games tab)
const gamesRes = await fnFetch(`games-schedule?sport=${sportKey}`);
const games = Array.isArray(gamesRes.data) ? gamesRes.data : [];
const upcomingGames = games.filter(
  (g: any) => g.status !== "STATUS_FINAL" && g.status !== "STATUS_IN_PROGRESS"
);

// fetch odds events once, build name→eventId map
const eventsRes = await fnFetch(`nba-odds/events?sport=${sport}&markets=h2h`);
const oddsEvents = Array.isArray(eventsRes.data?.events) ? eventsRes.data.events : [];
const eventByMatchup = new Map<string, any>();
for (const ev of oddsEvents) {
  eventByMatchup.set(`${(ev.home_team||"").toLowerCase()}|${(ev.away_team||"").toLowerCase()}`, ev);
  eventByMatchup.set(`${(ev.away_team||"").toLowerCase()}|${(ev.home_team||"").toLowerCase()}`, ev);
}

// for each scheduled game, find its odds event; iterate ALL games, no slice
const upcoming = upcomingGames
  .map((g: any) => eventByMatchup.get(`${(g.home_team||"").toLowerCase()}|${(g.away_team||"").toLowerCase()}`))
  .filter(Boolean);
stats.events = upcoming.length;
stats.scheduled_games = upcomingGames.length; // expose for verification
```

Remove `.slice(0, 16)` and the 36h cutoff. Keep the 5-event chunked parallel fetch (`CHUNK = 5`) so wall-time stays bounded.

### 2. Loosen game-line matching so no scheduled game is silently dropped (lines 194–204)

Add the reverse-key lookup to `oddsMap` so an away/home swap in naming still matches:

```ts
for (const ev of oddsEvents) {
  const home = (ev.home_team || "").toLowerCase();
  const away = (ev.away_team || "").toLowerCase();
  oddsMap.set(`${home}|${away}`, ev);
  oddsMap.set(`${away}|${home}`, ev);
}
```

This guarantees every scheduled game with odds available is evaluated.

### 3. Raise the analyzer cap to match a full slate (line 488)

Change `ANALYZER_CAP = 20` → `ANALYZER_CAP = 75`. This lets the top candidates from a full ~16-game NBA slate (or 15-game MLB / 14-game NHL slate) actually reach the analyzer instead of being discarded after prefilter. `ANALYZER_CHUNK = 6` stays the same to keep wall-time safe.

### 4. Surface the new counts in the per-sport return (line 464)

Extend `stats` to include `scheduled_games` and keep `events`, `lines`, `candidates`. This lets us verify via the orchestrator's `perSport` JSON that `scheduled_games` matches what `games-schedule?sport=...` returns.

## Files changed

- `supabase/functions/_shared/sport_scan.ts` — only file touched.
  - Lines 177–251 (`evaluateGameLines`): add reverse-key entries to `oddsMap`.
  - Lines 254–272 (`evaluatePlayerProps`): swap 16-event Odds-API slice for full `games-schedule` iteration with name-key match.
  - Line 488 (`scanSport`): `ANALYZER_CAP = 20` → `75`.
  - Line 464 (`stats`): add `scheduled_games`.

## Non-goals

- No changes to the Games tab, `games-schedule` edge function, the Picks UI, the pick card design, the analyzer (`nba-api/analyze`), the scoring/EV math, or the `daily_picks` schema.
- No changes to `slate-scanner-{nba,mlb,nhl,ufc}` per-sport wrappers — they automatically pick up the new `scanSport()` behavior.
- No DB migration.

## Verification (will be run after the edit)

1. Deploy `slate-scanner-nba`, `slate-scanner-mlb`, `slate-scanner-nhl`, `slate-scanner-ufc`, and `slate-scanner` (orchestrator unchanged but redeployed so it picks up the shared module).
2. `curl` `games-schedule?sport=basketball_nba` → record total upcoming game count `G`.
3. `curl` `slate-scanner` → confirm `perSport.nba.stats.scheduled_games === G` (proves the Picks tab is now driven by the same schedule the Games tab shows).
4. `psql -c "SELECT COUNT(DISTINCT (home_team || '|' || away_team)) FROM daily_picks WHERE pick_date = CURRENT_DATE AND sport='nba';"` → confirm distinct game count is in the same order of magnitude as `G` (every scheduled NBA game with edge had a chance to surface a pick), instead of the previous ≤16 ceiling.
5. Paste all three outputs (`games-schedule` count, scanner JSON `scheduled_games`, SQL distinct count) verbatim in the summary.

