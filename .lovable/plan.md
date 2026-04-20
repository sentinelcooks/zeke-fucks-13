

## Goal

Make the Dashboard / Picks / Tracker / Parlay tabs on Onboarding Screen 2's preview panel **interactive**. Tapping a tab swaps the panel body to a representative snapshot of that section, using styles already in the codebase. No navigation, no new design language.

## Changes — `src/pages/OnboardingPage.tsx` only

### 1. Lift active tab state into Screen 2 component (around line 370)

```tsx
const [activeTab, setActiveTab] = useState<"Dashboard" | "Picks" | "Tracker" | "Parlay">("Dashboard");
```

### 2. Convert tab row (lines 393–404) from `<span>` to interactive buttons

- `<button onClick={() => setActiveTab(t)}>` per tab.
- Active state: `bg-[#00FF6A] text-black` (current Dashboard styling — keep identical).
- Inactive: `text-white/50 hover:text-white/80`.
- Add subtle `whileTap={{ scale: 0.96 }}` via `motion.button` for native feel.
- `aria-pressed={activeTab === t}` for a11y.

### 3. Wrap panel body (lines 406–450) in `AnimatePresence` with `mode="wait"`

Each tab renders its own snapshot inside a `motion.div` keyed by tab name, with a 0.18s opacity+y(4px) crossfade (matches existing `pageT` micro-interactions). Fixed minimum height (~220px) so the outer card doesn't jump.

### 4. Tab content snapshots — all reuse existing patterns

**Dashboard** (default): keep current content unchanged — TODAY'S TOP PICKS rows + YTD performance + locked block.

**Picks**: reuse the same `SCREEN2_PICKS` row style but show it as a **Free Picks**-style list. Header: "FREE PICKS · TODAY" with a small green "FREE" pill (mirrors `FreePropsPage` pattern). Show the same 3 rows but with a "HIGH CONF" badge replacing the locked block. Row markup is identical to lines 415–427 — no new component.

**Tracker**: pull from the existing `ProfitTrackerMini` (already defined at line 1007) visual language — bankroll header "+$1,284" with ROI pill "+18.0%", the existing `Sparkline` component (already used at line 437) at full width, and a 3-column stats strip "Record 42–18 · Win Rate 70% · Streak W6". Same `bg-[#0A0A0A] border border-[#2A2A2A]` cards used elsewhere on this panel.

**Parlay**: reuse the AI Picks row pattern (player headshot + name + line + conf%) as 3 stacked **legs**, then a footer strip showing "3-LEG PARLAY · +650" on the left and "Grade: A−" badge on the right (mirrors the Slip Builder grading shown in `mem://features/slip-builder`). Same row styling (`bg-[#0A0A0A] border border-[#2A2A2A] px-2 py-1.5`). Headshots: Tatum, Doncic (already in `ESPN_HEADSHOTS`), Matthews.

### 5. Animation

- Tab indicator: instant background swap (matches paywall tab pattern).
- Panel body: `AnimatePresence mode="wait"` with `initial={{opacity:0, y:4}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-4}} transition={{duration:0.18, ease}}`.
- Honors `useReducedMotion()` — set duration to 0 when reduced.

## Non-goals

- No changes to the surrounding screen (heading, social proof, CTA, locked footer).
- No changes to other onboarding screens or the collapsible feature cards on Screen 4.
- No new components, files, or assets — all snapshots built inline using existing styles.
- No real data fetching — all snapshots are hardcoded sample content (consistent with the rest of this preview panel).

## Verification

1. `/onboarding` → advance to Screen 2 at 390×844.
2. Tap each tab in turn:
   - **Dashboard** → current Top Picks + YTD view (unchanged baseline).
   - **Picks** → Free Picks list with FREE pill + 3 rows + HIGH CONF badge.
   - **Tracker** → bankroll header + sparkline + record/win-rate/streak strip.
   - **Parlay** → 3 leg rows + parlay payout footer with grade badge.
3. Active tab pill is green (`#00FF6A` bg, black text); inactive are `text-white/50`.
4. Panel body crossfades smoothly; outer card height stays stable.
5. Tab swap works without navigating off `/onboarding`.

