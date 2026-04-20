

## Goal

Fix two bugs in the NBA Analyze tab's **Correlated Props** section in `src/pages/NbaPropsPage.tsx`. Backend (`correlated-props` edge function) already filters by direction correctly and is already receiving `over_under` — no backend changes needed.

## Root cause

**Issue 1 — direction display & propagation (frontend only):**
The data is correct, but the UI hardcodes "OVER":
- Line 2155: `When {player} {propType} hits, these also hit:` — neutral, OK.
- Line 2179: `OVER {c.correlated_line}` — always says OVER.
- Line 2195 / 2206: clicking the search (🔍) icon re-analyzes the correlated prop with `overUnder: "over"` hardcoded.
- Line 2225: clicking `+` adds the leg with `overUnder: "over"` hardcoded.

**Issue 2 — toggle never flips (the real bug):**
Line 2158: `globalSlip.isInSlip(c.correlated_player, c.correlated_prop, "")` passes an empty string for `line`, but `addLeg` (line 2225) stores the leg with the actual `corrLineStr`. `useParlaySlip.isInSlip` matches on `player + propType + line` — empty string never matches the stored line, so `isInSlip` is always `false`. The button never switches to the X state, and clicking again hits the `addLeg` dedup path (silent no-op) instead of the remove branch.

## Fix — `src/pages/NbaPropsPage.tsx` only

1. **Use the analyzed direction throughout the section.** Capture the direction the user analyzed (the `overUnder` state already in scope, which corresponds to what was sent to the edge function) and use it for:
   - Header copy: `When {lastName} {propType.toUpperCase()} goes {OVER|UNDER}, these also tend to go {OVER|UNDER}:`
   - Per-row line label: `{OVER|UNDER} {c.correlated_line} {c.correlated_prop.toUpperCase()}`
   - Search-icon re-analyze (line 2195, 2206): pass `overUnder: <analyzed direction>` instead of hardcoded `"over"`.
   - `+` button add (line 2225): `overUnder: <analyzed direction>`.

2. **Fix the toggle.** Change line 2158 from:
   ```tsx
   const isInSlip = globalSlip.isInSlip(c.correlated_player, c.correlated_prop, "");
   ```
   to use the same `corrLineStr` that `addLeg`/`removeLeg` use:
   ```tsx
   const corrLineStr = String(c.correlated_line ?? "");
   const isInSlip = globalSlip.isInSlip(c.correlated_player, c.correlated_prop, corrLineStr);
   ```
   With this fix, the existing `isInSlip ? remove : add` branch (lines 2221–2226) and the existing Plus↔X icon swap (line 2234) immediately work as a true toggle.

3. **Tiny safety:** lift `corrLineStr` to the top of the row map so both `isInSlip` and the two button handlers reference the same string (avoids redeclaration).

## Files changed

- `src/pages/NbaPropsPage.tsx` — header/label copy uses analyzed direction; pass analyzed direction in re-analyze and `addLeg`; fix `isInSlip` to pass `corrLineStr` instead of `""`.

## Non-goals

- No backend / edge function changes (`correlated-props` already correctly filters by `over_under` and caches per direction).
- No changes to `ParlaySlipContext`, MLB/UFC/NHL paths, or the parlay UI.
- No DB migration.

## Verification

1. Analyze an NBA player **OVER** prop → confirm correlated rows show `OVER X.5`, header reads "goes OVER, these also tend to go OVER".
2. Click `+` on a correlated row → button switches to X (highlighted state); leg appears in the floating parlay slip.
3. Click the same button again → leg is removed from the slip; button reverts to `+`.
4. Re-analyze the same player as **UNDER** → confirm rows now show `UNDER`, header reads "goes UNDER, these also tend to go UNDER", and `+` adds the leg as `under` (visible in the slip leg's direction).
5. Mixed: add an OVER leg, switch analysis to UNDER, add the UNDER version of the same prop — confirm both legs coexist in the slip and each `+` toggles its own state independently.

