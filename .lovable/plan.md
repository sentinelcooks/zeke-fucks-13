

## Plan: Fix Tab Switch Scroll Reset

### Problem
The existing scroll reset (line 75) only scrolls `mainRef.current` (the `<main>` element). The outer window/viewport scroll position isn't being reset, so users see stale scroll positions when switching tabs.

### Change

**`src/pages/DashboardLayout.tsx`** — In the existing `useEffect` at line 70-76, add `window.scrollTo(0, 0)` alongside the existing `mainRef.current?.scrollTo(0, 0)`:

```tsx
useEffect(() => {
  if (skipNextScrollReset.current) {
    skipNextScrollReset.current = false;
    return;
  }
  window.scrollTo(0, 0);
  mainRef.current?.scrollTo(0, 0);
}, [location.pathname]);
```

Single line addition. Ensures both the window and the scrollable main container reset on every route change.

