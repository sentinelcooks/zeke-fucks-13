

## Goal

Three concrete fixes across all sports (NBA / MLB / NHL / UFC):

1. **Single source of truth for unit sizing** so the in-depth body and the Overall Verdict card always agree.
2. **Contextual, matchup-specific verdict copy** (no generic "stick with 0 units on Sabres" / "noBet tier" leakage).
3. **Less aggressive moneyline floor** so clear favorites (e.g. Spurs vs Blazers with Wemby) stop defaulting to 0 units.

## Root cause (verified)

- `supabase/functions/moneyline-api/index.ts` already builds a canonical `Decision` (`recommended_units`, `conviction_tier`, `winning_team_name`). Good — this is the SSOT we'll standardize on.
- `src/components/WrittenAnalysis.tsx` lines **133–204**: when `decision` is present it correctly honors `decision.conviction_tier` for the **Overall Verdict** card. ✅
- But the **3-section body** comes from `ai-analysis` (LLM). The LLM prompt at `supabase/functions/ai-analysis/index.ts` lines **222–235** passes the raw tier string `"noBet"` and tells the model to literally write `"${decision.recommended_units} units on ${decision.winning_team_name}"`. When units = 0 this produces ugly copy like *"stick with 0 units on Sabres"* and the model echoes the internal label *"noBet tier"* (visible in screenshot 1). That's the inconsistency the user sees.
- `analyzeMoneyline` (lines 645–828) verdict thresholds are too tight: needs `team1Score ≥ 65` for STRONG, `≥ 55` for LEAN. A clear favorite that grades 60 lands as LEAN, then `buildDecision`'s dominance gate at line **103** (`favorWinner < 3 || dominanceRatio < 0.55 → noBet`) downgrades it to noBet. The Spurs/Blazers case fails here.

## Fix — 3 files

### 1. `supabase/functions/moneyline-api/index.ts`

- **Loosen the dominance floor** in `buildDecision` (around line 103) so a real favorite isn't silently zeroed:
  - `favorWinner < 2 || dominanceRatio < 0.50 → noBet` (was `< 3 / < 0.55`).
  - `< 0.60 → low` (was `< 0.65`).
  - Keep medium/high/veryHigh boundaries.
- **Loosen the verdict thresholds** in `analyzeMoneyline` (line 820):
  - `≥ 60 → STRONG`, `≥ 53 → LEAN` (was 65 / 55). Same change for spread/total verdict builders.
- **Edge boost**: keep the existing `edge ≥ 8 → upgrade` logic, but also add `edge ≥ 4 → upgrade noBet/low to medium` so a +EV favorite never lands at 0 units.
- **Decision normalization**: when `recommended_units = 0`, also set a new `decision.pass_reason` field with one of: `"low_conviction"`, `"toss_up"`, `"negative_edge"` — used by the LLM prompt below for human copy.

### 2. `supabase/functions/ai-analysis/index.ts` (locked-pick block, lines 222–235)

Rewrite the locked-pick block so the LLM:

- Never receives the literal string `"noBet"` — translate `conviction_tier` to human phrases (`"high conviction"`, `"lean"`, `"pass — line doesn't meet our confidence threshold"`).
- When `recommended_units = 0`, instructs the model: *"Write a PASS recommendation that names BOTH teams and the specific line (e.g. moneyline price or spread number) the user analyzed. Do NOT write 'X units on [team]'. Use phrasing like 'Passing on [winning team] — [matchup-specific reason from the data points above]'."*
- When `recommended_units > 0`, keeps the existing rule (`"${units} units on ${winning_team_name}"`).
- Add a hard scrub on output: regex-replace `/\bnoBet tier\b/gi`, `/\b0 units on \w+/gi` → swap with deterministic phrasing before returning sections.
- Pass through `team1Name`, `team2Name`, and the matchup line/odds in the user prompt body so the LLM has the data it needs to be specific.

### 3. `src/components/WrittenAnalysis.tsx`

- Add `team1Name`, `team2Name`, `line`, `propDisplay`, `overUnder` to the `ai-analysis` invoke body (line ~352) so the backend prompt can reference the exact matchup.
- In `tierToSizing` (line 123): when `decision.recommended_units` is present, **use that exact number** to produce the unitSize label (`"3 units"`, `"2 units"`, `"1 unit"`, `"0.5 units"`) instead of the hardcoded `"1.5–2 units"` band — guarantees the Overall Verdict card unit number matches what the LLM is told to write in section 3.
- In `generateOverallSummary` noBet branches (lines 175, 192, 278): swap any internal-label phrasing for natural language ("This line doesn't clear our confidence threshold for [team1] vs [team2].").
- Forward `props.line` / `props.overUnder` into the noBet summary so the Overall Verdict card itself names the specific bet (e.g. *"Passing on Spurs ML at -180 — model gives 58% but the price already implies 64%"*).

## Files changed

- `supabase/functions/moneyline-api/index.ts` — loosen verdict + dominance thresholds, add `edge ≥ 4` upgrade, add `pass_reason` to Decision.
- `supabase/functions/ai-analysis/index.ts` — rewrite locked-pick block to humanize tier, branch prompt on `units = 0` vs `> 0`, post-response scrub.
- `src/components/WrittenAnalysis.tsx` — pass team names + line/odds to `ai-analysis`, derive unit label from `decision.recommended_units` directly, replace generic noBet copy with matchup-specific copy.

## Non-goals

- No DB migration, no schema change.
- No changes to Picks tab, Today's Edge, Games tab, props analyzer, or the slate-scanner.
- Not touching the 20-factor weights themselves — only the verdict-bucketing thresholds.

## Verification

1. After deploy, `curl moneyline-api` for **Spurs vs Blazers** (NBA), **Diamondbacks** (MLB), **Sabres** (NHL): confirm `decision.recommended_units > 0` for the favorite case, and that even when `= 0` the `pass_reason` field is populated.
2. Trigger the in-depth analysis in the UI for each of those three matchups and verify:
   - The Overall Verdict card unit number == the unit number written inside the "Verdict & Risk" section.
   - No occurrence of `"noBet"`, `"noBet tier"`, or `"0 units on [team]"` anywhere in the rendered text.
   - The Verdict & Risk section names BOTH teams and the line.
3. Paste the curl JSON `decision` object + the rendered three section bodies + Overall Verdict card text verbatim in the summary.

