

## Plan: Add "Analyze" Button to Correlated Props

### What's Changing
Each correlated prop row currently has only a "+" button (add to slip). We'll add a small "analyze" button that, when tapped, populates the form with the correlated player's name and prop type, then triggers a full analysis — scrolling the user back up to see results.

### Changes

**`src/pages/NbaPropsPage.tsx`** — Correlated props row (lines ~2178-2201):

1. Add a new button between the hit rate percentage and the existing "+" button with a search/magnifying glass icon
2. On click, the button will:
   - Set `player` to `c.correlated_player`
   - Set `propType` to `c.correlated_prop`  
   - Set `overUnder` to `"over"` (default)
   - Clear `line` (let the API determine it)
   - Set the correct `activeCategory` for the prop type
   - Call `handleAnalyze()` via a setTimeout (to let state settle)
   - Scroll to the results section

3. Import `Search` icon from lucide-react (if not already imported)

### Scope
- 1 file, ~15 lines added (1 new button + handler logic)
- No backend changes

