

## Plan: Add Feedback to Today's Edge Refresh Button

### Problem
The refresh button works mechanically (calls `daily-picks` then reloads), but gives **no feedback** to the user about what happened. The `daily-picks` edge function is a heavy operation that can take 30-60+ seconds — it fetches ESPN games, analyzes props across multiple sports, and inserts picks. If it times out, errors, or returns 0 picks, the user sees nothing — just the spinner stopping and the same "No picks" state.

### Fix

**`src/components/home/ModernHomeLayout.tsx`** — Add toast notifications to `handleRefresh`:

```typescript
const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    const { data, error } = await supabase.functions.invoke("daily-picks");
    if (error) {
      toast.error("Failed to refresh picks. Try again later.");
    } else {
      const count = data?.count || 0;
      toast.success(count > 0 
        ? `${count} picks generated!` 
        : "No games available for picks right now.");
    }
    await fetchTodayPicks();
  } catch {
    toast.error("Failed to refresh picks. Try again later.");
  } finally {
    setRefreshing(false);
  }
}, [fetchTodayPicks]);
```

- Import `toast` from `sonner` (already used elsewhere in the app)
- Show success with pick count, or a clear message when no picks are available
- Show error toast on failure

### Scope
- 1 file, ~10 lines changed

