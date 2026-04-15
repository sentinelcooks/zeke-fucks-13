

## Plan: Make UFC Top Pick Reasoning Text White

### Problem
The reasoning text under the Top Pick card ("Most fights go past R1...") appears grey despite using `text-foreground`. The user wants it explicitly white.

### Changes

**`src/pages/UfcPage.tsx`** — 1 line:

1. **Line 339** — Change `text-foreground` to `text-white` on the reasoning paragraph to ensure it renders as pure white regardless of theme variable resolution.

### Scope
- 1 file, 1 class name change

