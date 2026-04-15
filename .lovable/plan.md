

## Plan: Make All UFC Reasoning Text White

### Problem
Multiple reasoning text elements in the UFC results section appear grey instead of white. The user circled the reasoning text under the "STRONG" badge.

### Changes

**`src/pages/UfcPage.tsx`** — 2 lines:

1. **Line 252** — Change `text-muted-foreground/50` to `text-white` on round predictions reasoning text.
2. **Line 392** — Change `text-foreground` to `text-white` on ML Pick reasoning text.

(Line 339 in the Top Pick card already uses `text-white` — no change needed.)

### Scope
- 1 file, 2 class name changes

