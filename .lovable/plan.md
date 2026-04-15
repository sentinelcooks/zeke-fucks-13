

## Plan: Fix UFC Fighter Avatars Obscuring Bell Notification

### Problem
The notification bell container at line 820 lacks a `z-index`, so the fighter avatars in the grid below can visually overlap and block taps on the bell.

### Fix (`src/pages/GamesPage.tsx`)

**Two changes:**

1. **Line 820** — Add `z-10` to the bell/badge container:
   ```tsx
   <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
   ```

2. **Line 757** — Add `relative z-[1]` to each `FighterAvatar` wrapper to explicitly keep avatars below:
   ```tsx
   <div className="w-11 h-11 rounded-full bg-secondary/40 border border-border/20 overflow-hidden shrink-0 relative z-[1]">
   ```

### Scope
- Single file, two class additions
- Bell always tappable, fighter avatars render below it

