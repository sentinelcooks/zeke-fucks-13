

## Plan: Show Full Fighter Names on UFC Cards

### Problem
Fighter names are truncated with `...` due to `truncate` class on the name spans (lines 843, 857).

### Fix (`src/pages/GamesPage.tsx`)

**Two changes:**

1. **Line 843** — Remove `truncate` from fighter1 name, allow wrapping:
   ```tsx
   <span className="text-[11px] font-bold text-foreground block leading-tight">{fight.fighter1}</span>
   ```

2. **Line 857** — Same for fighter2:
   ```tsx
   <span className="text-[11px] font-bold text-foreground block leading-tight">{fight.fighter2}</span>
   ```

Also remove `overflow-hidden` from the parent divs (lines 842, 856) so text can wrap freely.

### Scope
- Single file, 4 class changes
- Names wrap to second line if needed instead of being cut off

