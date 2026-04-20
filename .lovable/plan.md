

## Goal

Make the three onboarding feature preview cards behave exactly like the paywall accordion: only one open at a time, opening another auto-closes the previous, full-width when expanded so titles fully display, and Live Games preview renders horizontally so it doesn't look scrunched.

## Root cause of current bugs

1. **Blank card on close**: each `FeatureCard` owns its own `useState`, so multiple can be open simultaneously. The 3-column grid forces equal heights — when one card has tall content and another collapses, layout glitches leave a "blank card" look.
2. **Truncated titles ("Live...", "AI P...", "Prof...")**: `grid-cols-3` at 390px gives ~110px per cell. Title + icon + chevron can't fit, so `truncate` cuts them.
3. **Live Games scrunched**: stacked rows inside a 110px column look botched.

## Fix — match paywall pattern (`src/pages/OnboardingPage.tsx`)

### 1. Lift state to parent (lines 351–365)

Replace the `grid grid-cols-3` container with a vertical `space-y-2` stack (same as paywall's `mt-6 space-y-2`). Add a single `expandedCard` state at the parent (`ScreenValue` or wherever the grid lives — confirmed at line 354's parent component).

```tsx
const [expandedCard, setExpandedCard] = useState<string | null>(null);

<div className="mt-4 space-y-2">
  <FeatureCard id="live" title="Live Games" icon={Calendar}
    isExpanded={expandedCard === "live"}
    onToggle={() => setExpandedCard(expandedCard === "live" ? null : "live")}>
    <LiveGameMini />
  </FeatureCard>
  {/* AI Picks, Profit Tracker — same pattern */}
</div>
```

This guarantees: only one open at a time, opening another closes the previous, and full-width cards mean titles always fully display ("Live Games", "AI Picks", "Profit Tracker" — no truncation).

### 2. Refactor `FeatureCard` (lines 830–881) to be controlled

- Remove internal `useState`. Accept `isExpanded: boolean` and `onToggle: () => void` props.
- Mirror paywall styling exactly: `rounded-xl px-3.5 py-2.5 border border-[#2A2A2A] bg-[#141414]`, border becomes `border-[#00FF6A]/40` when expanded.
- Header row: `flex items-center gap-3`, icon (w-4 h-4, green), title in `text-sm font-semibold text-white` (no truncate, no tiny `text-[11px]`), chevron `w-4 h-4 text-white/50` rotating 180° when open.
- Animation: `AnimatePresence` with `{ opacity: 0, height: 0 } ↔ { opacity: 1, height: "auto" }`, duration 0.2s — exact paywall values.
- Expanded body wrapper: `mx-1 mt-1 rounded-lg border border-[#2A2A2A] bg-[#141414] p-3` — matches paywall.

### 3. Restructure `LiveGameMini` (lines 883–924) horizontally

Now that the card is full-width (≈340px on a 390px screen), use a horizontal layout that reads naturally:

```
┌─────────────────────────────────────────────────┐
│ ● LIVE  Q4 · 2:14                    NBA·MLB·NHL│
│                                                 │
│  ● LAL  108     vs     ● BOS  112  ✓            │
└─────────────────────────────────────────────────┘
```

JSX outline:
```tsx
<div className="w-full flex flex-col gap-2.5">
  {/* header row: LIVE chip left, sports right */}
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-1.5">
      <motion.span className="w-1.5 h-1.5 rounded-full bg-nba-red" animate={...} />
      <span className="text-[10px] font-black uppercase tracking-wider text-nba-red">LIVE</span>
      <span className="text-[10px] text-muted-foreground/60 tabular-nums ml-1">Q4 · {m}:{s}</span>
    </div>
    <span className="text-[9px] text-muted-foreground/55">NBA · MLB · NHL</span>
  </div>

  {/* Single horizontal row: team A — score — vs — score — team B */}
  <div className="bg-white/[0.03] rounded-lg px-3 py-2.5 flex items-center justify-between gap-2">
    <div className="flex items-center gap-2 flex-1">
      <span className="w-2 h-2 rounded-full bg-[#FDB927]" />
      <span className="text-xs font-bold text-white/90">LAL</span>
      <span className="text-base font-extrabold tabular-nums text-white/90 ml-auto">108</span>
    </div>
    <span className="text-[9px] text-muted-foreground/40 px-1">vs</span>
    <div className="flex items-center gap-2 flex-1">
      <span className="text-base font-extrabold tabular-nums text-nba-green">112</span>
      <span className="text-xs font-bold text-white ml-auto">BOS</span>
      <span className="w-2 h-2 rounded-full bg-[#007A33]" />
    </div>
  </div>
</div>
```

Winner side (BOS) score colored `text-nba-green`. Clock still ticks; LIVE dot still pulses.

### 4. AIPickMini and ProfitTrackerMini

No internal changes — they already render fine and now have full card width to breathe.

## Files updated

- `src/pages/OnboardingPage.tsx` — only:
  - Grid container (lines 352–365): switch to `space-y-2`, add `expandedCard` state, pass `isExpanded`/`onToggle` props.
  - `FeatureCard` (830–881): remove internal state, become controlled, restyle to match paywall accordion exactly.
  - `LiveGameMini` (883–924): convert to horizontal one-row layout.

## Verification (will run after edit)

1. Navigate to `/onboarding`, advance to the value screen at 390×844.
2. Screenshot — confirm three full-width cards with full titles "Live Games", "AI Picks", "Profit Tracker" visible.
3. Tap Live Games → expands horizontally with `LAL 108 vs 112 BOS`. Tap AI Picks → Live Games auto-closes, AI Picks opens. Tap AI Picks again → cleanly collapses, no blank card.
4. Paste screenshots in summary as proof.

## Non-goals

- No changes to AIPickMini / ProfitTrackerMini internals, the screen above the cards, navigation, or any other onboarding section.
- No DB or edge function changes (this is a pure UI fix — verification will be visual via browser screenshots, not SQL/curl).

