

## Goal

Remove the "Model Weights" breakdown from the EV (Expected Value) section in the Analyze tab so users no longer see internal factor weights / per-factor scoring.

## Where it appears (verified)

The "Model Weights" UI exists in exactly two places, both inside the EV/Edge area of the Analyze tab:

1. **`src/components/MoneyLineSection.tsx` (lines 991–1012)** — Lines/Moneyline analyzer. Block labeled `{/* ── MODEL WEIGHTS ── */}` rendering each factor's score + weight % (e.g. `Off Rating (15%)`, `Def Rating (15%)`).

2. **`src/components/mobile/OddsProjection.tsx` (lines 470–488)** — Player Props analyzer EV card. Block labeled `{/* Model breakdown weights */}` rendering the L5 / L10 / Season / H2H hit rates with their `35% / 25% / 20% / 20%` weights.

Both sit between the EV / Implied / Edge stats and the rest of the EV section — removing them leaves the section visually clean (EV %, implied vs true probability, edge %, edge projection bar all remain intact).

## Fix

### 1. `src/components/MoneyLineSection.tsx`
- Delete lines **991–1012** (the entire `{modelWeights.length > 0 && (...)}` JSX block).
- Leave the surrounding EV/Edge stat tiles (lines 980–989) and the Edge Projection bar (lines 1014+) untouched.
- The `modelWeights` variable derivation can stay (harmless, may be used elsewhere); only the rendering is removed.

### 2. `src/components/mobile/OddsProjection.tsx`
- Delete lines **470–488** (the entire "Model breakdown weights" card containing the L5/L10/Season/H2H weight grid).
- Leave the model-vs-implied projection bar above it (lines ~440–468) and the `EdgeExplainer` below it (line 494+) untouched.

## Files changed

- `src/components/MoneyLineSection.tsx` — remove the Model Weights factor row.
- `src/components/mobile/OddsProjection.tsx` — remove the Model Weights L5/L10/Season/H2H card.

## Non-goals

- No backend changes. The model still computes weighted factors server-side; we're only hiding them from the UI.
- No changes to the EV %, implied probability, true (model) probability, edge %, edge projection bar, EdgeExplainer, or Best Book card — all stay exactly as they are.
- No changes to the "Factor Breakdown" section in the moneyline verdict (that's a separate, user-facing analysis narrative, not the raw weights).

## Verification

1. Analyze → **Lines** → pick any NBA matchup → in the EV / Edge card, confirm the row showing `Off Rating (15%) · Def Rating (15%) · Pace (10%) · …` is gone, and the EV %, Implied, True Prob, Edge %, and Edge Projection bar still render.
2. Analyze → **Props** → analyze any player prop → in the Odds Projection EV card, confirm the `L5 (35%) · L10 (25%) · Season (20%) · H2H (20%)` grid is gone, and the model-vs-implied projection bar plus the EdgeExplainer below it still render.
3. Repeat (1) for MLB and NHL Lines, (2) for an MLB prop — same expected result.

