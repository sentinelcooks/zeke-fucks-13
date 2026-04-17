

## Plan: Scroll to top after correlated prop search

### Root cause
In `src/pages/NbaPropsPage.tsx`, the correlated prop row's search button onClick calls `handleAnalyze({...})` but never scrolls. Since the correlated section sits well below the results area, the user stays at the bottom of the page even though new results have loaded above.

### Fix

**1. `src/pages/NbaPropsPage.tsx`** — correlated prop tap handler
- Right after the `handleAnalyze({ player, propType, line, overUnder })` call inside the correlated row's onClick, add a scroll-to-top.
- The dashboard scroll container is the `<main>` element in `DashboardLayout.tsx` (not `window`), so `window.scrollTo` alone won't work reliably. Use the same pattern as elsewhere — scroll the closest scrollable ancestor:
  ```ts
  document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  ```
- Place this immediately after the `handleAnalyze(...)` call so state updates and the fetch are already initiated.

**2. Audit other "tap a related row to re-analyze" patterns**
- Check `src/pages/MoneyLinePage.tsx`, `src/pages/UfcPage.tsx`, `src/components/MoneyLineSection.tsx`, `src/components/parlay/*` for similar "tap related item → re-run analysis" handlers. If found, apply the same scroll-to-top pattern.
- Likely candidates: any "View matchup" / "Analyze this prop" buttons inside results panels.

### Verification (default mode)
1. NBA Props → search Devin Booker Points → scroll down to Correlated Props → tap any row's search button.
2. Confirm the page smoothly scrolls back to the top and the new results header is visible without manual scrolling.
3. Repeat on at least one other page where a similar pattern exists (if found in audit).

### Out of scope
- No edge-function or DB changes — purely client-side scroll behavior.
- No changes to the analyze logic itself (already fixed in prior task).

