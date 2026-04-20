

## Goal

Make the three onboarding feature preview cards (Live Games, AI Picks, Profit Tracker) collapsible — collapsed by default showing only the title + icon, tap to expand the preview. Independently togglable. Also restructure Live Games expanded content into two stacked horizontal team rows (abbr left, score right) matching the in-app game card pattern.

## Changes — `src/pages/OnboardingPage.tsx` only

### 1. `FeatureCard` (lines 830–857) — make collapsible

- Add internal `useState<boolean>(false)` for `open`.
- Convert root from a single `motion.button` to a `<div>` containing:
  - A header `<button>` (full row, title + icon + chevron) that toggles `open`. Add a small `ChevronDown` icon (from `lucide-react`, already used elsewhere) that rotates 180° when `open`.
  - An `AnimatePresence` block that conditionally renders the children inside a `motion.div` with `initial/animate/exit = { height, opacity }` using `microEase` (~0.28s). Use `overflow-hidden`.
- Remove the bottom border from the header row when collapsed; keep the inset glow + border styling on the outer card so collapsed cards still look premium.
- Keep `whileTap={{ scale: 0.98 }}` on the header button only.
- Drop the `min-h-[56px] flex items-start` content slot — the expanding container provides its own height.
- `aria-expanded={open}` on the header button; `aria-hidden` swap on content.

### 2. `LiveGameMini` (lines 859–895) — restructure to two stacked team rows

Replace the single horizontal score pill with two rows inside one rounded container, each row formatted as:

```
[dot] LAL ............................ 108
[dot] BOS ............................ 112
```

Structure:
- Outer wrapper unchanged (`flex flex-col gap-2.5`).
- Header row (LIVE dot + label + Q4 clock) unchanged.
- Replace score pill block with:
  ```
  <div className="bg-white/[0.03] rounded-md px-2.5 py-2 flex flex-col gap-1.5">
    <Row team="LAL" dotColor="#FDB927" score={108} />
    <Row team="BOS" dotColor="#007A33" score={112} winner />
  </div>
  ```
  Each row: `flex items-center justify-between` — left side = colored dot + abbr (`text-[11px] font-bold`); right side = score (`text-[13px] font-extrabold tabular-nums`), winner row score colored `text-nba-green`.
- Keep "NBA · MLB · NHL" sub-label.

### 3. `AIPickMini` and `ProfitTrackerMini`

No internal changes — they will simply render inside the new collapsible content slot.

### 4. Default state

All three start **collapsed**. The header alone (title + icon + chevron) is what's visible until tapped.

## Animation

- Expand/collapse: `height: auto ↔ 0` and `opacity: 1 ↔ 0`, duration ~0.28s with existing `microEase`. Honors `useReducedMotion()` (instant snap when reduced).
- Chevron rotation: same duration/ease.

## Non-goals

- No changes outside `FeatureCard`, `LiveGameMini`, and the grid container.
- No changes to AIPickMini / ProfitTrackerMini internals.
- No changes to grid layout, card border treatment, or any other onboarding section.

## Verification

1. `/onboarding` at 390px: three cards show collapsed (title + icon + chevron only) with equal heights.
2. Tapping each card independently expands its preview with smooth height animation; tapping again collapses.
3. Live Games expanded shows two stacked rows: `● LAL  108` then `● BOS  112` (winner score in green), with breathing room.
4. AI Picks and Profit Tracker expanded look unchanged from current.
5. Reduced motion: expand/collapse snaps without animation; LIVE dot pulse and ring/sparkline animations still respect reduce-motion as before.

