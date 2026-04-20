

## Goal

Fix the Lines tab in the Analyze section so live odds reliably appear next to the moneyline / spread / total for any team a user searches — and when odds genuinely can't be fetched, show a clear "odds unavailable" state instead of a blank UI.

## Root cause (verified against backend + frontend)

After analyzing a matchup in the Lines tab (`MoneyLineSection`), the UI is supposed to show two odds blocks:

1. **"Odds & Value" card** — uses `results.odds`, computed server-side in `moneyline-api/index.ts` by `fetchOddsForMatchup` → `buildOddsPayload`.
2. **`MoneylinePlatformOdds` panel** — fetches live odds **client-side** via `fetchNbaOdds()` → `nba-odds/events`.

I confirmed the `nba-odds/events` endpoint is healthy (Cavs vs Raptors comes back with DraftKings / FanDuel / BetOnlineAG odds for h2h, spreads, totals). So the data is there — the bugs are in how it's matched, rendered, and how failures are surfaced:

- **Bug 1 — Card silently disappears.** `MoneyLineSection.tsx` line ~1670 wraps the entire "Odds & Value" card in `{results.odds && (...)}`. When `fetchOddsForMatchup` returns `null` (no event match — common for tip-off-imminent games or when only `us`/`us2` regions are queried), the card just vanishes. No "odds unavailable" message, no retry, nothing — exactly the "blank/broken UI" the user is reporting.
- **Bug 2 — Backend uses fewer regions than frontend.** `fetchOddsForMatchup` (`moneyline-api` line 1045) only queries `regions=us,us2`. The client `nba-odds/events` queries all 4 regions (`us`, `us2`, `us_dfs`, `us_ex`). Result: server `results.odds` can be `null` for a matchup where the client's `MoneylinePlatformOdds` finds odds. Inconsistent. Worse, the server short-circuits with `if (!match) return null` — so a single fuzzy-match miss kills the entire Odds & Value card.
- **Bug 3 — `MoneylinePlatformOdds` is hidden until after Analyze.** It only renders inside `{results && (...)}` (line 1745). Users who land on Lines mode and search a team see no live odds at all until they hit the Analyze button — feels like odds are "not working."
- **Bug 4 — `useEffect` doesn't refetch on team-object identity change.** Deps are `[team1.name, team2.name, oddsFormat, sport]`. If the analyzer returns the same team name with a different casing or a refetch is needed on retry, the panel won't re-trigger. Also, no manual retry control when load fails.
- **Bug 5 — Loading/error UX is incomplete on the "Odds & Value" card.** Zero feedback. The `MoneylinePlatformOdds` block has a loading spinner + a yellow "temporarily unavailable" alert, but the upstream card has neither.

## Fix — 2 files

### 1. `supabase/functions/moneyline-api/index.ts`

- **Widen the regions** in `fetchOddsForMatchup` (line 1045) from `regions=us,us2` to `regions=us,us2,us_dfs,us_ex` so it matches what the client + the rest of the app uses. This alone resolves the "no match" cases for matchups whose lines only post on DFS/exchange books first.
- **Return a structured "no-data" payload** instead of `null` when matching fails: `{ market, bestLine: null, impliedProb, ev: 0, allBooks: [], unavailable: true, reason: "no_match" | "no_entries" | "fetch_failed" }`. This lets the frontend distinguish "haven't fetched yet" from "we tried, no odds exist for this matchup yet."
- Same pattern in `buildOddsPayload`: when `entries.length === 0`, return the same structured `{ unavailable: true, reason: "no_entries", ... }` object instead of `null`.

### 2. `src/components/MoneyLineSection.tsx`

- **Render `MoneylinePlatformOdds` before analysis** when both `team1` and `team2` are selected. Move the component out of the `{results && (...)}` branch and also render it (in a lighter "preview" state with `modelProb={undefined}`) once teams are picked. So the user sees live odds the moment they pick two teams — no Analyze click required.
- **Replace `{results.odds && (...)}` (line ~1670)** with `{results.odds ? (<OddsValueCard … />) : (<OddsUnavailableCard team1={results.team1} team2={results.team2} />)}`. The unavailable card shows the same yellow "AlertTriangle" treatment as `MoneylinePlatformOdds` with copy: *"Live odds for {team1.shortName} vs {team2.shortName} aren't posted yet. Analysis still uses our model — odds will appear once books publish them."*
- **Honor the new `unavailable: true` flag** from `buildOddsPayload`: treat `results.odds?.unavailable === true` as the "show unavailable card" branch.
- **Add a retry button to `MoneylinePlatformOdds`** in its existing "Live odds temporarily unavailable" state — clicking it re-runs the load function. Trivially implemented by wrapping the `useEffect` body in a `loadOdds` callback and exposing it via a refresh button.
- **Improve `useEffect` deps** to also depend on `team1.id`/`team2.id` so a re-pick of the same team name (different objects) triggers a refetch.
- **Loading skeleton on the Odds & Value card** while `loading === true` (mirror the existing `MoneylinePlatformOdds` spinner so both blocks feel consistent).

## Files changed

- `supabase/functions/moneyline-api/index.ts` — broaden odds regions to all 4 us regions, return structured `unavailable` payload instead of `null` from `fetchOddsForMatchup` and `buildOddsPayload`.
- `src/components/MoneyLineSection.tsx` — render `MoneylinePlatformOdds` once both teams are selected (not gated on analysis), add an "Odds Unavailable" fallback card when `results.odds` is missing or `unavailable`, add a retry button + better loading state to `MoneylinePlatformOdds`, expand `useEffect` deps for reliable refetch.

## Non-goals

- No backend schema/migration. No changes to the props analyzer or the props "VS" tab. No changes to GamesPage (its odds work fine — confirmed by curl). No changes to `nba-odds/events` itself (already healthy).

## Verification

1. Open Analyze → Lines → NBA → pick **Cleveland Cavaliers vs Toronto Raptors** (without clicking Analyze): the live odds panel should now appear immediately with DraftKings / FanDuel / etc. odds for moneyline, spread, total.
2. Click **Analyze Matchup** → confirm the "Odds & Value" card shows best book + EV, AND the platform odds panel still displays.
3. Pick two teams that don't have a scheduled game tonight (e.g. two random teams) → confirm both blocks show the new "Live odds for X vs Y aren't posted yet" yellow alert instead of disappearing.
4. Repeat for **MLB** and **NHL** in Lines mode → live odds render the same way.
5. In `MoneylinePlatformOdds`'s unavailable state, click the new **Retry** button → confirm it re-fetches.

