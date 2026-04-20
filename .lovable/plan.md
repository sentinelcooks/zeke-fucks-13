

## Goal

Fix the Live Games onboarding preview card's cramped internal spacing. Only this card is touched.

## Root cause

The `FeatureCard` content slot (line 854) uses `min-h-[56px] flex items-center`, which vertically centers and compresses the three-row `LiveGameMini` layout. Combined with tight gaps inside `LiveGameMini`, everything feels mashed together.

## Changes — `src/pages/OnboardingPage.tsx`

### Line 854 — FeatureCard content slot

Change the content wrapper from vertically centering to top-aligning, so taller content like Live Games isn't squeezed:

```
// Before
<div className="min-h-[56px] flex items-center">{children}</div>

// After
<div className="min-h-[56px] flex items-start w-full">{children}</div>
```

### Lines 871–893 — LiveGameMini component

1. **Outer gap**: increase from `gap-2` to `gap-2.5` (line 871)
2. **LIVE header row**: increase vertical padding from `py-0.5` to `py-1` (line 872)
3. **Score pill**: increase padding from `px-2 py-1.5` to `px-2.5 py-2` and add `gap-2` for internal spacing between team names and score (line 881)
4. **Sport sub-label**: increase top margin from `mt-1` to `mt-1.5` (line 892)

Updated LiveGameMini JSX:

```tsx
<div className="w-full flex flex-col gap-2.5">
  <div className="flex items-center gap-1 py-1">
    {/* LIVE dot + label + clock — unchanged content */}
  </div>
  <div className="flex items-center justify-between bg-white/[0.03] rounded-md px-2.5 py-2 gap-2">
    {/* team dots, abbreviations, score — unchanged content */}
  </div>
  <div className="text-[7px] text-muted-foreground/55 mt-1.5">NBA · MLB · NHL</div>
</div>
```

## Files to update

- `src/pages/OnboardingPage.tsx` — lines 854, 871, 872, 881, 892

## Non-goals

- No changes to AIPickMini, ProfitTrackerMini, FeatureCard structure, grid, or any other component
- No animation or color changes

## Verification

1. Open `/onboarding` at 390px — Live Games card should have visible breathing room between LIVE row, score pill, and sport label
2. AI Picks and Profit Tracker cards should look identical to before
3. Clock still ticks, LIVE dot still pulses

