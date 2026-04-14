

## Plan: Auto-Restore Scroll Position on Browser Tab Return

### Problem
When a user is deep in a page (e.g. viewing prop analytics with results scrolled down), accidentally switches browser tabs, and comes back within 10 seconds, they lose their scroll position because the layout resets scroll to top on route change.

### Changes

**`src/pages/DashboardLayout.tsx`**

1. **Save scroll position + route on visibility change** — Listen for the `visibilitychange` event on `document`. When the page becomes `hidden`, snapshot `{ pathname, scrollTop, timestamp }` into a ref (not state, to avoid re-renders).

2. **Restore on return** — When the page becomes `visible` again, check if:
   - The user returned within 10 seconds (`Date.now() - timestamp < 10_000`)
   - The route hasn't changed (`pathname === location.pathname`)
   
   If both conditions are true, restore `mainRef.current.scrollTop` to the saved value.

3. **Guard the existing scroll-to-top** — The current `useEffect` that scrolls to top on `location.pathname` change should skip restoration if the user just returned from a tab switch (use a `skipNextScrollReset` ref flag set during restore, cleared after the effect runs).

### How It Works

```
User viewing prop analysis (scrolled to 1200px)
  → switches browser tab (saves {path: "/dashboard/nba", scroll: 1200, time: now})
  → comes back in 5 seconds
  → scroll restored to 1200px ✓

User switches tab, comes back after 15 seconds
  → 15s > 10s threshold → no restore, normal behavior

User switches tab then navigates via bookmark to different page
  → pathname mismatch → no restore
```

### What Won't Change
- No backend changes
- No new dependencies
- Normal in-app navigation scroll-to-top behavior unchanged
- No localStorage needed (ref-only, session-scoped)

