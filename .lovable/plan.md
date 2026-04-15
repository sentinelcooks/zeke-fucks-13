

## Plan: Improve Profit Tracker & Analytics Preview on Paywall

### Problem
The current preview for "Profit Tracker & Analytics" is just a flat grid of colored squares — it doesn't represent the actual tracker which has stats, a P&L calendar with intensity-scaled cells, and performance metrics.

### Changes

**`src/pages/PaywallPage.tsx`** — Replace the preview JSX for the "Profit Tracker & Analytics" feature (lines 155-163) with a more representative mini dashboard:

1. **Mini stat row** at top: three small stat pills showing "Win Rate 67%", "Profit +$482", "ROI +12.3%" with appropriate green coloring
2. **Improved calendar grid**: Keep the 7-column layout but make it look like a real P&L calendar — add day-of-week headers (S M T W T F S) in tiny muted text, use varying green/red intensities (opacity levels) to show different profit/loss magnitudes, and make cells slightly larger with rounded corners
3. **Mini sparkline row** at bottom: a simple row of small bars (like a tiny bar chart) showing a 7-day profit trend, with green bars for wins and red for losses

This creates a preview that mirrors the actual Profit Tracker's key elements: stats summary, P&L calendar, and trend visualization.

### Technical Details
- Only the `preview` ReactNode in the FEATURES array entry for "Profit Tracker & Analytics" changes
- No new dependencies — all inline JSX with Tailwind classes
- Keeps the same compact sizing as other feature previews

