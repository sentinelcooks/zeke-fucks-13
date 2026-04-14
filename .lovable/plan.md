

## Plan: Replace Moneyline Analysis Breakdown with Props-Style

### Problem
The moneyline "Analysis Breakdown" section uses a custom bar-chart style (team comparison bars with scores). The user wants it to match the Props section, which uses the `WrittenAnalysis` component (timeline-style with icons, narrative sections, and overall verdict).

### Key Insight
The `WrittenAnalysis` component is **already rendered** below the Analysis Breakdown for moneylines (line 1877). So there are currently two analysis sections stacked — the bar-chart breakdown AND WrittenAnalysis. The fix is simply to remove the redundant bar-chart "Analysis Breakdown" Section.

### Implementation

**File: `src/components/MoneyLineSection.tsx`**
- Remove the `<Section title="Analysis Breakdown">` block (lines ~1656-1767) which contains the bar-chart team comparison UI
- The existing `WrittenAnalysis` component (already at line 1877) will serve as the sole analysis section, matching the Props style exactly

### What Won't Change
- No backend changes
- No changes to `WrittenAnalysis.tsx`
- All other moneyline sections (Past Meetings, Injury Report, Splits, etc.) remain intact
- The AI Summary that was inside the bar-chart section is already captured by WrittenAnalysis

