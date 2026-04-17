
This is a large visual-only refactor. The user wants to bridge onboarding (black + neon green #00FF6A + Inter) into the main app (currently dark navy + purple/blue primary). Strict constraint: visuals only, no logic.

Strategy: do this primarily via design tokens in `src/index.css` and `tailwind.config.ts` so most changes propagate automatically, then targeted per-file tweaks for hardcoded colors.

## Plan

### 1. Global tokens (`src/index.css`)
- Repoint `--primary` from purple `250 76% 62%` → neon green `135 100% 50%` (#00FF6A)
- Repoint `--ring`, `--accent`, `--sidebar-primary`, `--sidebar-ring` to same green
- Update `--gradient-blue` and `--gradient-purple` token values used by primary CTAs to green-tinted gradients
- Add new utility vars: `--color-primary-dim`, `--color-primary-glow`
- Confirm `body` font-family already includes Inter (it does — keep)

This single change automatically converts: shadcn `Button` default variant, all `bg-primary` / `text-primary` / `border-primary` / `ring-primary` usages across the app, sidebar active states, focus rings, and the bottom tab bar's `text-primary` icons.

### 2. Bottom tab bar (`src/components/mobile/BottomTabBar.tsx`)
- Active indicator pill gradient: purple→blue → solid `#00FF6A` with green glow
- Icons/labels already use `text-primary` → auto-update via token

### 3. Atmospheric glow orbs
- Add fixed glow orbs (purple top-center + green bottom-right at low opacity) to `src/pages/DashboardLayout.tsx` so all dashboard pages inherit the onboarding atmosphere

### 4. Hardcoded purple/blue → green sweeps (visual className only)
Targeted files where primary actions use hardcoded hex/HSL instead of tokens:
- `src/pages/PaywallPage.tsx` — leave (already greens for selection)
- `src/pages/FreePicksPage.tsx` — confidence badges, edge %, active filter pills → green
- `src/pages/GamesPage.tsx` — active sport tab, "Analyze Matchup" button, LIVE badge, calendar icon → green
- `src/pages/Dashboard.tsx` (Analyze) — Props/Lines toggle, OVER active, sport tabs, stat pills, primary Analyze CTA, results "STRONG BET" / hit-rate ring stroke, ADD TO PARLAY → green
- `src/pages/ProfitTrackerPage.tsx` — IN PROFIT card, ROI value, "+ Add Play" CTA, filter pills → green
- `src/pages/SettingsPage.tsx` — American/Decimal toggle, Modern/Classic toggle, switch on-state → green
- `src/components/home/ModernHomeLayout.tsx` — Today's Edge section dot + label accent → green; edge card border → green tint; "+ Add to Slip" button → green bg/black text/green glow

### 5. What I will NOT touch
- No state, hooks, handlers, routing, data, conditionals, layout structure, text content
- Colored icon backgrounds in Quick Access (user said keep)
- Inactive tab styling
- Red destructive colors (UNDER, losses) stay red
- Yellow warning ("MOST POPULAR", medium confidence) stays amber

### Files touched (visual className/token only)
1. `src/index.css` — token repoint
2. `src/components/mobile/BottomTabBar.tsx` — active pill green
3. `src/pages/DashboardLayout.tsx` — atmospheric orbs
4. `src/components/home/ModernHomeLayout.tsx` — Today's Edge accents + Add to Slip
5. `src/pages/GamesPage.tsx` — sport tabs, LIVE, Analyze CTA
6. `src/pages/Dashboard.tsx` — analyzer toggles, CTAs, results accents
7. `src/pages/FreePicksPage.tsx` — confidence/edge/filter colors
8. `src/pages/ProfitTrackerPage.tsx` — profit card, Add Play CTA, filter pills
9. `src/pages/SettingsPage.tsx` — toggles to green

Most reach is achieved by step 1 alone; steps 4–9 only swap remaining hardcoded purples/blues. Zero functional changes.
