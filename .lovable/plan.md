

## Plan: Brighten AI Analysis Section Text

### Problem
The reasoning text under verdict labels like "STRONG" uses `text-foreground/70` (70% opacity), making it too dark and hard to read against the dark background.

### Changes

**`src/components/WrittenAnalysis.tsx`** — 2 lines:

1. **Line 342** — Section content text: change `text-foreground/70` → `text-foreground`
2. **Line 386** — Overall verdict summary text: change `text-foreground/70` → `text-foreground`

### Scope
- 1 file, 2 class changes

