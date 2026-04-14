

## Plan: Clear Parlay Slip After Saving to History

### What's Changing

When a user saves a parlay to history via the "SAVE PARLAY TO HISTORY" button in `ParlayAnalysisResults`, the floating parlay slip widget should automatically clear all legs so it disappears.

### Implementation

**In `src/components/parlay/ParlayAnalysisResults.tsx`:**

1. Import `useParlaySlip` from `@/contexts/ParlaySlipContext`
2. Destructure `clearSlip` from the hook
3. After `setSaved(true)` on successful save (line 88), call `clearSlip()` to empty the slip

This is a ~3-line change. No other files need modification — the `FloatingParlaySlip` already hides itself when `legs.length === 0`.

