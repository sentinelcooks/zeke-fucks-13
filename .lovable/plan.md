

## Goal

Turn the three static feature pills (Live Games, AI Picks, Profit Tracker) on the onboarding/marketing screen into **living micro-previews** — small in-card animations that mirror the real in-app screens. No layout overhaul, same 3-column grid and dark card styling, just real component DNA inside each card.

## Source of truth (real in-app components mirrored)

- **Live Games** → `GamesPage` live game tile: team logo dots, score, pulsing red `LIVE` chip, period/clock.
- **AI Picks** → `ModernHomeLayout` Today's Edge carousel + analyzer screen: confidence ring (`HitRateRing` style), `+EV` chip in `nba-green`, mini player row.
- **Profit Tracker** → `ProfitCharts` / `PnLCalendar`: sparkline trending up, green ROI value, micro bar-chart day strip.

## Design — `src/pages/OnboardingPage.tsx` (lines 350–367 only)

Replace the current static pill content. **Layout, grid, card sizing, border, padding all stay the same.** Only the inside changes.

### Card 1 — Live Games (live game tile)
- Top: pulsing red dot + "LIVE" in `text-[7px] font-black uppercase tracking-wider text-nba-red`, framer-motion `animate={{ opacity: [1, .4, 1] }}` 1.5s loop.
- Middle: two team abbreviations (`LAL` vs `BOS`) with dots colored to team accents, score `108–112` in `text-[11px] font-extrabold tabular-nums`.
- Bottom: `Q4 · 2:14` micro label, `text-[8px] text-muted-foreground/55 tabular-nums`. Clock seconds tick down via `useEffect` setInterval on a single `seconds` state (purely visual; pauses when off-screen via `IntersectionObserver` is overkill — just `setInterval` is fine here).
- Title row "Live Games" stays, sub-line condenses to "NBA · MLB · NHL" in same `text-[8px] text-muted-foreground/55`.

### Card 2 — AI Picks (mini pick row + confidence ring)
- Top: tiny SVG ring (20px) showing 64% in `text-nba-green`, animated stroke-dashoffset on mount (0.6s ease-out) — same look as `HitRateRing` shrunk down. Center number `64` at `text-[8px] font-black`.
- Right of ring: stacked "OVER 32.5" / "PTS" mini label at `text-[8px] font-bold`.
- Bottom: `+EV 7.2%` chip with `bg-nba-green/15 text-nba-green text-[8px] font-extrabold tabular-nums px-1.5 py-0.5 rounded`.
- Subtle `motion.div` hover/tap: `whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}` on the whole card, easing 0.2s.

### Card 3 — Profit Tracker (sparkline + ROI)
- Top: 24px-tall inline SVG sparkline polyline trending upward, stroke `hsl(var(--nba-green))` width 1.5, with a `motion.path` `pathLength` animation 0–1 over 0.9s on mount, then a glowing dot at the end-point (radius 1.5, `nba-green` fill, soft shadow).
- Below: `+$1,284` in `text-[12px] font-extrabold tabular-nums text-nba-green`, sub `text-[8px] uppercase tracking-wider text-muted-foreground/55` reading `30D · ROI +18%`.
- Title "Profit Tracker" stays.

## Shared interaction polish
- Wrap each card in `motion.div` with: `initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}` already there from the parent stagger; add `whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}` and `transition={{ type: "spring", stiffness: 380, damping: 28 }}`.
- Cards become `<button type="button">` (or `motion.button`) with `aria-label` describing the feature, so they're tappable. Tap currently does nothing visible (no nav) — this is a marketing surface; the tap feedback alone is the "alive" cue. (Confirm with user if a tap should scroll to a deeper section, but per request "not a tooltip or modal" — pure micro-demo.)
- Replace remaining hex on these cards with tokens we already use elsewhere: `border-border/40`, `bg-card/80`, `text-muted-foreground/55`, `text-nba-green`, `text-nba-red`. No raw `#00FF6A`, `#2A2A2A`, `#141414` inside the new card content.
- All animations under 1s, easing `[0.32, 0.72, 0, 1]` (matches existing `ease` const in this file). Respect `prefers-reduced-motion` by guarding the looping pulse + clock tick behind `useReducedMotion()` from framer-motion (no loops if reduced).

## Implementation notes

- Add three small inline subcomponents at the bottom of `OnboardingPage.tsx` (or just inline JSX): `LiveGameMini`, `AIPickMini`, `ProfitTrackerMini`. Each ~40 lines, no external deps, no new files.
- Sparkline = static `points` array, no recharts (keeps bundle untouched and matches the "small native preview" feel).
- Ring = single `<svg>` with two circles + `strokeDasharray` math, animated via framer-motion `animate` on `strokeDashoffset`.
- Live clock = `useState(134)` seconds + `setInterval(()=>set(s=>Math.max(0,s-1)),1000)` cleared on unmount; format `Q4 · M:SS`. Loops back to `134` when it hits 0 so it always feels live.
- Icons stay (`Calendar`, `Brain`, `BarChart3`) but shrink to `w-3 h-3` as a corner accent so the title row reads identically; the demo content is the new visual focus.

## Files to update

- `src/pages/OnboardingPage.tsx` (only the feature-pills block, lines ~350–367, plus ~3 small inline subcomponents added in the same file).

## Non-goals

- No changes to the rest of the onboarding screen, the "Today's Picks" preview card above, or the AI Analysis Preview block.
- No new routes, no nav on tap, no modals/tooltips.
- No new dependencies. No new files.
- No layout/grid/spacing changes around the cards.

## Verification

1. Open `/onboarding` step 1 in 390px preview.
2. Live Games card: red `LIVE` dot pulses, clock ticks down each second, score is legible at the same size as before.
3. AI Picks card: confidence ring fills to 64% on mount, `+EV 7.2%` chip is the same green token as the analyzer screen.
4. Profit Tracker card: sparkline draws in over ~1s, ends with a glowing green dot, `+$1,284` matches the analyzer's stat-value typography.
5. Tap each card → spring-scale tap feedback, no navigation, no modal.
6. Toggle macOS "Reduce motion" → loops/animations stop, final states render statically.
7. Side-by-side vs. live `GamesPage` live tile, `HitRateRing`, and `ProfitCharts` — visual language clearly belongs to the same family.

