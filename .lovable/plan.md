

## Plan: Fix Analyze Button and Make Correlated Props Specific

### Problem 1 — Analyze button on correlated props fails
The search icon button on each correlated prop card sets `setLine("")` then calls `handleAnalyze()` after 150ms. But `handleAnalyze()` validates `parseFloat(line) > 0` — since line is empty, it always fails with "Enter a valid line value". The correlated prop's computed line is never passed to the UI.

### Problem 2 — Correlated props are not specific
The edge function computes a median-based `line` for each correlated prop (e.g., "Over 7.5 Assists") but never returns it. The UI just shows "ASSISTS" without the specific line, making the correlation vague and the analyze button unusable.

### Changes

**`supabase/functions/correlated-props/index.ts`** — Add `correlated_line` to the response:

1. Add `correlated_line: number` to the `Correlation` interface.
2. In `computeCorrelations` (line 247), include the computed `line` value in each pushed correlation object.
3. In the cache insert (line 369), include `correlated_line` in the DB rows.
4. Update `generateReasoning` to mention the specific line (e.g., "Over 7.5 Assists" instead of just "Assists").

**Database migration** — Add `correlated_line` column:

```sql
ALTER TABLE public.correlated_props ADD COLUMN IF NOT EXISTS correlated_line numeric DEFAULT 0;
```

**`src/pages/NbaPropsPage.tsx`** — Update correlated props UI and analyze handler:

1. Update the `corrProps` state type to include `correlated_line?: number`.
2. In the correlated prop card display (~line 2175), show the specific line: "Over 7.5 ASSISTS" instead of just "ASSISTS".
3. Fix the search icon `onClick` (~line 2185-2194): set `setLine(String(c.correlated_line || ""))` instead of `setLine("")`, and pass the line directly to `analyzeProp()` rather than relying on stale state via `handleAnalyze()`.

### Scope
- 1 edge function updated + redeployed
- 1 migration (add column)
- 1 frontend file updated (~15 lines changed)

