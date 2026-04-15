

## Plan: Fix UFC Fighter Avatars Obscuring Bell Notification

### Problem
The fighter avatars (44px circles) in the 5-column grid layout extend upward and overlap with the bell notification button positioned at `top-3 right-3`. The rightmost avatar (fighter 2) visually covers the bell, making it untappable.

### Fix (single file: `src/pages/GamesPage.tsx`)

**1. Add `z-10` to the bell/main-event container** (line 820)

The `absolute top-3 right-3` div containing the bell and "Main Event" badge needs a higher z-index so it sits above the grid content.

Change:
```tsx
<div className="absolute top-3 right-3 flex items-center gap-1.5">
```
To:
```tsx
<div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
```

**2. Add top padding to the grid to avoid visual overlap** (line 840)

Add `mt-6` to the grid container so the fighter row sits below the bell area:
```tsx
<div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-1.5 mt-6">
```

### Scope
- Single file, two small class additions
- No layout or styling changes elsewhere

