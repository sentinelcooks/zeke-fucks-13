

## Plan: Add Refresh Button to Today's Edge

### What
Add a refresh button next to "Updated Xm ago" in the Today's Edge section header. Tapping it calls the `daily-picks` edge function to regenerate picks, then re-fetches from the database.

### Changes — `src/components/home/ModernHomeLayout.tsx`

1. **Add `refreshing` state** (line ~225): `const [refreshing, setRefreshing] = useState(false)`

2. **Extract `fetchPicks` so it's callable outside the effect** — move the fetch logic into a `useCallback` or define a `refreshPicks` function that re-runs the today query and updates state.

3. **Add `handleRefresh` function**:
   - Sets `refreshing = true`
   - Invokes `supabase.functions.invoke("daily-picks")` to regenerate
   - Re-fetches today's picks from the `daily_picks` table
   - Sets `refreshing = false`

4. **Add refresh button in header** (line ~438, next to "Updated Xm ago"):
   ```tsx
   <button onClick={handleRefresh} disabled={refreshing}>
     <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
   </button>
   ```
   Style: small icon button, muted color, spins while refreshing. Placed between the "Updated" text and the right edge.

5. **Update "Updated" text** to show real time after refresh instead of the random `minsAgo`.

### Scope
- 1 file edited: `ModernHomeLayout.tsx`
- No backend changes — reuses existing `daily-picks` edge function

