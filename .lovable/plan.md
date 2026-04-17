
## Plan: Paywall horizontal layout + Sparkline clip + Comparison chart fix

Three targeted edits from the uploaded spec. No pricing/routing/other-screen changes.

### Fix 1 — Paywall 3-column horizontal cards (`src/pages/PaywallPage.tsx`)
Replace the current vertical `space-y-3` pricing block with `grid grid-cols-3 gap-2`. Each card becomes a compact vertical column: centered top badge, tiny plan label, trial pill, price (monthly in `#00FF6A`), per-day text, saving line, and per-card CTA pill ("Try Free" / "Subscribe"). Selected state keeps green border + glow; monthly adds the double-ring shadow. Sticky bottom CTA footer, features accordion, and `pb-32` padding all unchanged.

### Fix 2 — Sparkline clipPath (`src/pages/OnboardingPage.tsx`)
Update the `Sparkline` component: add `overflow="hidden"` on the root `<svg>`, define a `<clipPath>` covering the 54×44 viewBox, and wrap all content (grid lines, gradient fill, glowing polyline, dot nodes, endpoint circle) inside a `<g clipPath={...}>`. This keeps grid strokes and glow filters from bleeding into surrounding cards.

### Fix 3 — Comparison chart sizing (`src/pages/OnboardingPage.tsx`, Screen 4)
- Change the two "ROI After 90 Days" labels → "ROI After 30 Days".
- Wrap each `Sparkline` in `<div className="mt-2 flex justify-center">` and give the sparkline `className="h-12 w-full max-w-[120px]"` so it no longer stretches across the narrow column.
- Tighten both comparison card paddings from `p-3` → `p-2.5` (keeping the red/green border colors).

### Verification
1. Visual at 390×844:
   - `/paywall` — 3 equal-width cards in one row, Monthly highlighted green with "MOST POPULAR" pill centered on top, per-card CTAs visible, sticky footer still pinned.
   - `/onboarding` Screen 1/2 — sparklines fully contained, no grid lines bleeding into card edges.
   - `/onboarding` Screen 4 — "Without Sentinel" vs "With Sentinel" cards each show a centered, non-stretched sparkline (max 120px wide) and say "ROI After 30 Days".
2. `npx tsc --noEmit` clean.
3. No DB or edge function changes in this task — purely client-side JSX/Tailwind. I will state this explicitly in the final summary instead of running SELECT/curl verification, since there is nothing backend-side to verify.

### Out of scope
Pricing values, routing, progress bar, ESPN avatars, sport icons, welcome/auth screens.
