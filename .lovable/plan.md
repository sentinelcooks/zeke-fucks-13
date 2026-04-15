

## Plan: Increase Gray Text Brightness Globally

### Problem
Muted/gray text (`text-muted-foreground`) is too dim across the app, making it hard to read.

### Change

**`src/index.css`** — Bump the lightness of `--muted-foreground` and `--secondary-foreground` CSS variables:

- `--muted-foreground`: `228 12% 75%` → `228 12% 82%` (line 28)
- `--secondary-foreground`: `228 12% 80%` → `228 12% 86%` (line 25)
- `--sidebar-foreground`: `228 10% 63%` → `228 10% 72%` (line 55)

This is a single-file, 3-line edit that affects every component using these tokens — no per-component changes needed.

