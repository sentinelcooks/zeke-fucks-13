

## Plan: Fix Play Type Dropdown Scroll + Add 1Q Props

### Problem
1. Dropdown `max-h-[200px]` clips last items — no bottom padding inside the scroll container
2. NBA play types missing first-quarter props

### Fix — `src/components/tracker/BetTypeDropdown.tsx`

**1. Fix scroll clipping:** Increase `max-h` to `260px` and add `pb-2` inside the dropdown so the last item isn't cut off by rounded corners.

**2. Add 1Q props to NBA list** (insert before Moneyline/Spread):
- `1Q Points` — aliases: 1q pts, first quarter points, 1q scoring
- `1Q Rebounds` — aliases: 1q reb, first quarter rebounds
- `1Q Assists` — aliases: 1q ast, first quarter assists
- `1Q 3-Pointers` — aliases: 1q 3pt, first quarter threes, 1q triples

### Scope
- 1 file changed, ~8 lines added/modified

