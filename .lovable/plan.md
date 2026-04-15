

## Plan: Brighten UFC Card Text

### Problem
The reasoning/description text in the "Top Pick" and "Moneyline Pick" UFC cards uses `text-muted-foreground/40` and `text-muted-foreground/50`, making it nearly invisible on the dark background.

### Changes

**`src/pages/UfcPage.tsx`** — 3 lines:

1. **Line 334** — "Top Pick" label: `text-muted-foreground/50` → `text-muted-foreground`
2. **Line 339** — Top Pick reasoning text: `text-muted-foreground/40` → `text-foreground`
3. **Line 392** — Moneyline Pick reasoning text: `text-muted-foreground/50` → `text-foreground`

### Scope
- 1 file, 3 opacity changes

