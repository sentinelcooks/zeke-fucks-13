

## Plan: Add In-Depth Analysis Animation Style to All Collapsible Sections

### Problem
The `Section` component in `MoneyLineSection.tsx` (used for Head-to-Head Scores, Score Differential, Past Meetings, Injury Report, Home/Away Splits) uses a basic CSS transition with no animated expand/collapse. The "All Sportsbooks" and "Other Markets" sections are not collapsible at all. The user wants all of these to match the smooth `AnimatePresence` + `motion.div` animation style used in the In-Depth Analysis component.

### Changes

**`src/components/MoneyLineSection.tsx`**

1. **Upgrade the `Section` component** (lines 276-292):
   - Replace the CSS `transition-transform` chevron with a `motion.div` rotating chevron
   - Replace the conditional `{open && ...}` render with `AnimatePresence` + `motion.div` that animates `height: 0 → auto` and `opacity: 0 → 1` on expand, reverse on collapse
   - Add `overflow-hidden` to the motion wrapper
   - Default `defaultOpen` to `false` (collapsed by default, matching the screenshots)
   - Add the subtle gradient accent line at the top of the card

2. **Make "All Sportsbooks" collapsible** (lines 969-1053):
   - Add `useState` (`allBooksOpen`, default `false`)
   - Convert the header `div` into a clickable `button` with rotating chevron
   - Wrap the sportsbook list in `AnimatePresence` + `motion.div`

3. **Make "Other Markets" collapsible** (lines 1055-1116):
   - Add `useState` (`otherMarketsOpen`, default `false`)
   - Convert the header into a clickable `button` with rotating chevron
   - Wrap content in `AnimatePresence` + `motion.div`

### Animation Pattern (matching WrittenAnalysis)
```tsx
<motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3 }}>
  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65" />
</motion.div>

<AnimatePresence initial={false}>
  {open && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="overflow-hidden"
    >
      {content}
    </motion.div>
  )}
</AnimatePresence>
```

### What Won't Change
- No backend changes
- All content inside each section stays identical
- The existing Odds & EV Analysis collapsible header keeps its current animation

