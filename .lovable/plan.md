

## Plan: Filter Odds to Match Requested Line

### Problem
When checking a prop like "Connor McDavid Over 1 Goal", the odds comparison shows books with different lines (e.g., 1.5, 2.5) instead of only books offering the exact line requested. Alt lines above the requested line should never appear.

### Solution
Filter the returned books **client-side** in `OddsComparison.tsx` after fetching. This avoids changing the backend edge function.

### Logic
After `setBooks(data.books)`, filter the books array:
1. **Exact match first**: Keep only books where `book.line === requested line`
2. **If no exact matches**: Also include books with lines **below** the requested line (alt lines that are easier to hit)
3. **Never show** books with lines **above** the requested line

### File Changed
**`src/components/OddsComparison.tsx`** (~5 lines added in the `fetchOdds` function):
- After receiving `data.books`, filter: keep entries where `b.line <= line`, preferring exact matches
- If there are exact-line books, only show those; otherwise fall back to below-line books

### What Won't Change
- No backend/edge function changes
- No UI design changes
- Works for all sports (NBA, MLB, NHL, NFL, UFC)

