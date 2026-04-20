

## Goal

Improve the internal spacing, hierarchy, and polish of the three feature preview cards (Live Games, AI Picks, Profit Tracker) on the onboarding screen so each feels like a premium micro-preview with clear breathing room — without changing the grid, card count, or overall layout.

## Changes — `src/pages/OnboardingPage.tsx`

### FeatureCard wrapper (lines ~830–857)

- Increase internal padding from `p-2.5` to `p-3`
- Increase gap from `gap-1.5` to `gap-2`
- Increase minimum content height from `min-h-[48px]` to `min-h-[56px]` so content has vertical room
- Add subtle inner glow: `shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]` for depth
- Move the icon into the title line with a slightly larger size (`w-3.5 h-3.5`) and reduce its opacity to 50% so the title dominates
- Add a thin separator between the title row and the content area using a `border-b border-border/20 pb-1.5 mb-0.5` on the header row

### LiveGameMini (lines ~859–895)

- Increase gap from `gap-1` to `gap-1.5` on the outer column
- Bump the LIVE label to `text-[8px]` and the pulsing dot to `w-1.5 h-1.5` for better legibility
- Increase score text from `text-[11px]` to `text-[12px]` so it reads as the hero number
- Give the team row a subtle background pill: `bg-white/[0.03] rounded-md px-1.5 py-1` to frame the matchup
- Bump team abbreviations from `text-[9px]` to `text-[10px]`
- Move the "NBA · MLB · NHL" sub-label to `text-[7px]` with `mt-0.5` for breathing room from the matchup

### AIPickMini (lines ~897–939)

- Increase the confidence ring from 20px (`w-5 h-5`) to 24px (`w-6 h-6`), bump the center number from `text-[7px]` to `text-[8px]`
- Increase outer gap from `gap-1.5` to `gap-2`
- Increase the pick label ("OVER 32.5") from `text-[8px]` to `text-[9px]` and the "PTS" sub from `text-[7px]` to `text-[8px]`
- Add a subtle horizontal divider (`border-t border-border/20 pt-1.5`) between the pick row and the EV chip
- Increase the EV chip text from `text-[8px]` to `text-[9px]` and give it `py-0.5 px-2` for a more tappable pill feel

### ProfitTrackerMini (lines ~941–976)

- Increase outer gap from `gap-1` to `gap-1.5`
- Bump the sparkline height from `h-6` (24px) to `h-7` (28px) so the trend line has more visual presence
- Bump the profit number from `text-[12px]` to `text-[13px]`
- Add a subtle green tinted background strip behind the profit number: `bg-nba-green/[0.06] rounded px-1.5 py-0.5 inline-block` to frame it as a stat callout
- Add `mt-0.5` between the profit number and the sub-label for breathing room

### Grid gap (line ~354)

- Increase the grid gap from `gap-2` to `gap-2.5` to give cards more separation

## Non-goals

- No changes to card count, grid columns, or overall page layout
- No changes to animations, interaction behavior, or reduced-motion handling
- No changes to colors/tokens (all stay as current semantic tokens)
- No changes outside the feature-pills block and the four subcomponents

## Files to update

- `src/pages/OnboardingPage.tsx` — `FeatureCard`, `LiveGameMini`, `AIPickMini`, `ProfitTrackerMini` subcomponents and the grid container

## Verification

1. Open `/onboarding` at 390px — cards should feel spacious with clear label/data/stat hierarchy
2. Each card's "hero" element (score, ring, profit number) should be the dominant visual
3. Subtle separators and background accents should add depth without clutter
4. Animations still work identically — clock ticks, ring fills, sparkline draws
5. Cards remain equal height and consistent in border/shadow treatment

