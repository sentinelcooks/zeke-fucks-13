

## Goal

Align the typography, weights, and color tokens on the onboarding **Today's Picks** preview card so its confidence badge, EV figure, YTD ROI, and Win Rate stats look like they belong to the same design system as the full pick analysis screen (the model/edge tiles in `OddsProjection` and the `HitRateRing` averages). Layout stays the same — only type scale, weight, casing, and color treatments change.

## Reference values pulled from the analysis screen

- Big percentage display (Our Model / Implied / Edge tiles in `OddsProjection.tsx`):
  - Value: `text-[16px] font-extrabold tabular-nums`
  - Sub-label: `text-[8px] font-bold uppercase tracking-wider text-muted-foreground/55`
- EV readout (Edge Projection row in `OddsProjection.tsx`):
  - `text-[11px] font-extrabold tabular-nums` + `getEVColor()` token (`text-nba-green` for +EV)
- Stat hierarchy (Hit Rates section / `HitRateRing.tsx`):
  - Label: `text-[9px] font-bold uppercase tracking-wider text-muted-foreground`
  - Value: `font-black tabular-nums` in a semantic color token (`text-nba-green`, `text-nba-blue`, etc.)

The onboarding card currently uses raw hex (`#00FF6A`, `#2A2A2A`, `#0A0A0A`) and inconsistent sizes (`text-sm`, `text-lg`, `text-[8px]`, `text-[9px]`). We'll align those without redesigning the card.

## Changes — `src/pages/OnboardingPage.tsx` (Today's Picks preview block, lines ~250–285)

### 1. Confidence badge + percent (right column of the pick row)
- "HIGH CONF" pill → match the analysis tile sub-label rhythm:
  - `text-[8px] font-bold uppercase tracking-wider`
  - Background stays the green chip but use the same green token used elsewhere (`bg-nba-green/15 text-nba-green`).
- Confidence number `64%` → match the big-percent treatment from the analysis tiles:
  - `text-[16px] font-extrabold tabular-nums text-nba-green leading-none`
- Add a tiny "Confidence" sub-label underneath at `text-[8px] text-muted-foreground/55` to mirror the "Hit Probability" sub-label on the analysis Model tile (keeps the same vertical rhythm).

### 2. EV figure (`+EV: 7.2%`)
- Match the Edge Projection EV readout:
  - `text-[11px] font-extrabold tabular-nums text-nba-green`
- Keep the `+EV:` prefix muted (`text-muted-foreground/55`) so the number itself carries the color weight, exactly like the analysis screen.

### 3. YTD ROI + Win Rate stats row (bottom of card)
Replace the current `text-[9px]` label / `text-lg` value pattern with the analysis-screen stat hierarchy:
- Label: `text-[9px] font-bold uppercase tracking-wider text-muted-foreground` (was `text-white/50`)
- Value: `text-base font-black tabular-nums` (was `text-lg font-extrabold`) with semantic color tokens:
  - YTD ROI value → `text-nba-green` (positive)
  - Win Rate value → `text-foreground` (neutral, like the Implied tile in analysis)
- Sparkline stays as-is, stroke color updated to `hsl(var(--nba-green))` so it shares the token instead of `#00FF6A`.

### 4. Token swap (no visual redesign)
Across this card only, replace the hardcoded hex with the design tokens already used on the analysis screen:
- `#00FF6A` → `hsl(var(--nba-green))` / `text-nba-green` / `bg-nba-green/15`
- `#2A2A2A` borders/dividers → `border-border/40`
- `#141414` card bg → keep the visual but use `vision-card`-style token (`bg-card/80` with existing border) to match the analysis tile surface.
- `text-white/50` muted text → `text-muted-foreground/55` (matches analysis sub-labels).

## Non-goals

- No layout, spacing, icon, or content changes.
- No changes to the actual Today's Edge carousel on the live home screen (`ModernHomeLayout.tsx`) — that one already uses the shared tokens. This is purely the onboarding preview card shown in the screenshot.
- No changes to the AI Analysis Preview block beneath the stats row.

## Files to update

- `src/pages/OnboardingPage.tsx` (only the Today's Picks preview card markup, lines ~250–285)

## Verification

1. Open `/onboarding` step 1 in the 390px preview.
2. Confirm the Today's Picks card shows:
   - "HIGH CONF" pill at the same micro-label scale used by analysis tile labels.
   - `64%` rendered at the same weight/size as the big percentages on the analysis screen's Model/Implied/Edge tiles.
   - `+EV: 7.2%` rendered with the same green + size as the Edge Projection EV readout in `OddsProjection`.
   - YTD ROI and Win Rate values look like the stat tiles in the analysis Hit Rates section: small uppercase muted label paired with a bold tabular-nums number, ROI green, Win Rate neutral foreground.
3. Side-by-side check vs. the live analyzer (`/dashboard/analyze` → run a player) — type sizes, weights, and color tokens should feel like the same family.

