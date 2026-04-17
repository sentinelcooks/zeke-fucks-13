

## Plan: Make Lean Play Box Read From Computed Factor Counts (Never Contradict Verdict)

### Root cause
`generateOverallSummary` in `src/components/WrittenAnalysis.tsx` (lines 105-137 for moneyline) classifies a verdict as `"lean"` when the model returns `TOSS-UP` and then writes the summary string `"Coin-flip matchup. ${pickLabel} is too close to call with conviction. Recommended sizing: 0.5 units max."` — that's the exact contradiction in the screenshots. A toss-up should NOT carry a unit size.

The user also wants the unit size derived from a **factor count** (factors favoring team 1 vs team 2 vs neutral) — which already exists on the backend as `factorBreakdown` (each entry has `team1Score`, `team2Score`, `weight`). We just need to consume it and map count → tier → unit size, with a strict "no sizing on toss-up/pass" rule.

### Changes (frontend only — no backend/DB)

**1. `src/components/WrittenAnalysis.tsx` — rewrite `generateOverallSummary` for moneyline**

a. Add `factorBreakdown?: Array<{ name; team1Score; team2Score; weight }>` to `WrittenAnalysisProps`.

b. Compute factor counts (only weighted factors count):
   - `favorTeam1` = factors where `team1Score >= 60`
   - `favorTeam2` = factors where `team2Score >= 60`
   - `neutral` = remaining
   - `total` = `favorTeam1 + favorTeam2`
   - `winnerCount` = `max(favorTeam1, favorTeam2)`
   - `pickedTeamWins` = whichever side aligns with the model's `verdict` (e.g. `LEAN MAGIC` → team2)
   - `dominanceRatio` = `winnerCount / max(1, total)` (share of decisive factors going to the picked side)

c. Tier mapping (no slight/moderate/etc. of the OPPOSITE side — must align with model verdict):
   ```
   - winnerCount < 3 OR dominanceRatio < 0.55  → "noBet"   (no sizing line shown)
   - dominanceRatio in [0.55, 0.65)            → "low"     → "0.5 units max"
   - dominanceRatio in [0.65, 0.75)            → "medium"  → "1 unit"
   - dominanceRatio in [0.75, 0.90)            → "high"    → "1.5–2 units"
   - dominanceRatio >= 0.90                    → "veryHigh"→ "3 units"
   ```
   Plus a hard guard: if model `verdict === "TOSS-UP"` OR has no clear `LEAN`/`STRONG` direction → force `"noBet"` regardless of dominance.

d. Build the summary string from the tier:
   - `noBet`: `rating = "fade"`, `unitSize = null`, summary: `"No bet recommended. Factors split too evenly (${favorTeam1} vs ${favorTeam2}, ${neutral} neutral) to bet with conviction."` — **NO** word "toss-up", "coin-flip", "pass", or "uncertainty" anywhere when sizing line shown; in the `noBet` case sizing is simply omitted.
   - `low`: `rating = "lean"`, summary ends with `"Recommended sizing: 0.5 units max."`
   - `medium`: `rating = "lean"`, summary ends with `"Recommended sizing: 1 unit."`
   - `high`: `rating = "take"`, summary ends with `"Recommended sizing: 1.5–2 units."`
   - `veryHigh`: `rating = "take"`, summary ends with `"Recommended sizing: 3 units."`

e. Apply the same logic for the **prop** branch — count per-factor signals (the existing `bullish`/`bearish` increments already mirror this; add the same threshold + sizing tiers + `noBet` guard so props can also return "No bet recommended" with no sizing).

**2. UI render guard (lines 354-393)**

In the Lean Play box render block, branch on `overallSummary.unitSize`:
   - If `unitSize === null` (noBet): show heading "❌ No Bet Recommended" (red), summary text without sizing line, hide the sizing entirely.
   - Otherwise render exactly as today.

Also add a **post-render scrub**: if `overallSummary.summary` contains any of `"toss-up"|"coin-flip"|"pass"|"uncertainty"` (case-insensitive), force `unitSize = null` and replace any trailing `"Recommended sizing: ..."` sentence with `"No bet recommended."` This is the belt-and-suspenders rule the user explicitly asked for.

**3. Pass `factorBreakdown` from caller**

Find the place(s) `WrittenAnalysis` is rendered in `src/components/MoneyLineSection.tsx` and add `factorBreakdown={results?.factorBreakdown}` to the props. The backend already returns this on every analyze response across NBA/MLB/NHL/NFL/NCAAB (see `analyzeMoneyline` line 696 + delegates).

### Sport coverage
Sport-agnostic — the factor model in `moneyline-api` already runs for NBA/MLB/NHL/NFL/NCAAB and produces `factorBreakdown`. No per-sport branching needed in the UI logic.

### Verification (will run in default mode)
1. UI test: run a near-50/50 NBA matchup (e.g. Hornets vs Magic) → confirm Verdict & Risk says "toss-up/pass" AND Lean Play box shows "❌ No Bet Recommended" with **no** sizing line.
2. Run a `LEAN ${team}` matchup → confirm Lean Play shows "Recommended sizing: 0.5–1 unit" matching the dominance tier.
3. Run a `STRONG ${team}` matchup → confirm Lean Play shows "1.5–2 units" or "3 units" per tier.
4. Repeat smoke check for MLB and NHL matchups.
5. Console-grep the rendered summary text to ensure no occurrence of "toss-up"/"coin-flip"/"pass"/"uncertainty" co-occurs with "Recommended sizing".

### Out of scope
- Backend `moneyline-api` math, weights, or verdict thresholds (unchanged).
- The AI-generated narrative sections (the model is already passed `overallRating`; tightening that prompt is a separate task if needed).
- Props analyzer scoring math beyond reusing the same noBet guard + tier output.

