

## Goal

Two targeted fixes to the onboarding feature preview cards: (1) loosen the Live Games card's internal spacing so it doesn't feel cramped, and (2) replace the generic "OVER 32.5 PTS" in AI Picks with a realistic player pick example that mirrors what users actually see in the app.

## Changes — `src/pages/OnboardingPage.tsx`

### LiveGameMini (~lines 870–894)

- Increase outer column gap from `gap-1.5` to `gap-2`
- Add `py-0.5` to the LIVE header row for vertical breathing room
- Increase team matchup pill padding from `px-1.5 py-1` to `px-2 py-1.5` so scores aren't pressed against edges
- Add `gap-1.5` between team name and score column (currently everything is `justify-between` in a tight row — add slight padding around the score)
- Bump the sports sub-label from `mt-0.5` to `mt-1` for more separation from the matchup

### AIPickMini (~lines 897–940)

Replace the generic "OVER 32.5 / PTS" with a realistic player prop example that matches what the app actually shows:

- Add a player name row above the pick line: `"J. Tatum"` in `text-[9px] font-bold text-white/90` — mirrors how picks appear in the Today's Edge carousel
- Change pick label from `"OVER 32.5"` to `"Over 24.5 Pts"` — a realistic points prop with the stat type inline (matches the analyzer screen format)
- Add a subtle team/matchup context line: `"BOS vs MIA"` in `text-[7px] text-muted-foreground/55` below the player name
- Keep the confidence ring (64%) and `+EV 7.2%` chip unchanged — those are already correct

The updated layout becomes:
```
[Ring 64]  J. Tatum
           BOS vs MIA
           Over 24.5 Pts
─────────────────────
+EV 7.2%
```

## Files to update

- `src/pages/OnboardingPage.tsx` — `LiveGameMini` and `AIPickMini` subcomponents only

## Non-goals

- No changes to ProfitTrackerMini, FeatureCard wrapper, grid, or any other part of the page
- No animation or interaction changes
- No new files or dependencies

## Verification

1. Open `/onboarding` at 390px — Live Games card should have visible breathing room between the LIVE row, matchup pill, and sports label
2. AI Picks card should read as a real player prop pick (player name, matchup, specific stat line) not a generic "OVER 32.5"
3. All animations still work — clock ticks, ring fills, sparkline draws

