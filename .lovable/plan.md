
## Plan: Raise and extend the Profit Tracker "Play Type" dropdown

### What’s happening
The dropdown itself is scrollable now, but it can still get visually covered by the next card ("Search player") because the form and the dropdown are competing with later siblings in the stacking order on mobile.

### Changes to make

**1. `src/components/tracker/BetTypeDropdown.tsx`**
- Increase the dropdown height again so more items are visible at once on small screens.
- Raise the dropdown stack level further (`z-[80]` or similar) so the menu sits above nearby cards.
- Keep the internal bottom padding so the last option is fully readable.
- If needed, slightly reduce vertical option padding so the last entries fit more comfortably on 390px screens.

**2. `src/pages/ProfitTrackerPage.tsx`**
- Give the expanded “New Play” form its own stacking context and higher z-index while open (`relative z-20` or similar), so its dropdown can render above the filters card below.
- Keep the form wrapper `overflow-visible`.
- Add a little extra spacing beneath the form while it’s open so the dropdown has more room before it reaches the next card.

### Expected result
- The Play Type menu opens taller.
- You can scroll all the way to the bottom and read the final option completely.
- The menu no longer gets covered by the “Search player” box in Profit Tracker.

### Scope
- 2 files
  - `src/components/tracker/BetTypeDropdown.tsx`
  - `src/pages/ProfitTrackerPage.tsx`
