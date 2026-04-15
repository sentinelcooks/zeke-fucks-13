

## Plan: Fix UFC Fighter Icons Not Loading

### Root Cause
The fighter headshot URL uses ESPN's athlete headshot path (`/i/headshots/mma/players/full/${id}.png`), but the code extracts `competitors[0]?.id` (the **competitor/competition ID**) instead of `competitors[0]?.athlete?.id` (the **athlete ID**). These are different values — the headshot endpoint only works with athlete IDs.

### Fix (`src/pages/GamesPage.tsx`)

**Lines 427-428** — Extract the athlete ID instead of the competitor ID:

```tsx
fighter1Id: competitors[0]?.athlete?.id || competitors[0]?.id || undefined,
fighter2Id: competitors[1]?.athlete?.id || competitors[1]?.id || undefined,
```

This prioritizes the athlete ID (which matches the headshot URL format) and falls back to the competitor ID if unavailable.

### Scope
- Single file, two line changes
- All fighter headshots should load correctly after this fix

