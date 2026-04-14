

## Plan: Fix Picks Tab Layout — Names Bunching Up

### Problem
The four category tabs (Picks, 100%, SGP, Trends) in the Picks page use `flex` with no overflow handling. On a 390px viewport, the tabs plus their icons and count badges overflow and get cramped/bunched together.

### Solution
Make the tab container horizontally scrollable and add `shrink-0` to each tab button so they maintain their natural width instead of compressing.

### File Changed

**`src/pages/FreePicksPage.tsx`** (lines 252-286)

1. Add `overflow-x-auto scrollbar-hide` to the tab container `<div className="flex gap-1.5">`
2. Add `shrink-0 whitespace-nowrap` to each tab `<button>` so the text and badges don't wrap or compress

This matches the existing pattern used for the sport filter pills and prop filter pills on the same page (lines 291, 305), which already use `overflow-x-auto scrollbar-hide`.

### What Won't Change
- No backend changes
- Tab functionality, icons, count badges all stay the same
- Filter pills and content sections unaffected

