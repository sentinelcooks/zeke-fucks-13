

## Plan: Single Source of Truth for Pick Decisions

### Root cause (confirmed)

Three independently computed decisions:

1. **Probability bar / hero card** — `MoneyLineSection.tsx` reads `results.team1_pct`, `results.team2_pct`, `results.verdict` from the backend (`analyzeMoneyline` in `moneyline-api/index.ts` line 694–699). This is the *real* model decision.

2. **"Take This Pick" block** (`WrittenAnalysis.tsx` line 154–170) — recomputes its own tier from `factorBreakdown` counts, then writes `pickLabel = playerOrTeam`, where `playerOrTeam` is hardcoded to `results.team1?.shortName` at `MoneyLineSection.tsx` line 1932. **This is the bug**: when the model picks team2, this block still says "factors favor [team1]".

3. **"Verdict & Risk" prose** — `ai-analysis/index.ts` LLM call. The prompt passes `verdict` as a string ("LEAN HORNETS") but never passes the winning team name as a locked variable, so the LLM occasionally writes around the wrong side.

### Fix — Decision Object as Single Source of Truth

**A. Backend (`supabase/functions/moneyline-api/index.ts`)** — emit a canonical decision object on every response (moneyline / spread / total, all sports including the NHL/MLB delegated paths):

```ts
decision: {
  winning_side: "team1" | "team2" | "over" | "under" | null,
  winning_team_name: string | null,   // resolved label, e.g. "Hornets"
  win_probability: number,            // 0-100
  edge: number | null,                // win_prob - implied_odds_pct
  conviction_tier: "noBet" | "low" | "medium" | "high" | "veryHigh",
  recommended_units: 0 | 0.5 | 1 | 2 | 3,
  verdict_text: string,               // "LEAN HORNETS" — kept for back-compat
}
```

Add a shared helper `buildDecision(team1, team2, team1_pct, verdict, factorBreakdown, oddsImpliedPct, betType, overUnder)` that:
- Picks `winning_side` from `verdict` text (STRONG/LEAN keyword + team match) — falls back to `team1_pct` ≷ 50.
- Computes `edge = win_prob - implied_odds_pct` (skips if odds missing).
- Computes `conviction_tier` from edge + dominance ratio (port the existing `computeMoneylineTier` logic but use `winning_side` to pick the right tally side).
- Maps tier → `recommended_units`: noBet=0, low=0.5, medium=1, high=2, veryHigh=3.

Apply at all 4 return points: generic moneyline/spread/total (line ~1266), MLB delegate (line ~1144), NHL delegate (line ~1201).

**B. Frontend — read decision, never recompute**

1. `MoneyLineSection.tsx` line 1932: pass the decision into `<WrittenAnalysis>` and the hero card:
   - Replace hardcoded `playerOrTeam={results.team1?.shortName}` with `playerOrTeam={results.decision?.winning_team_name || results.team1?.shortName}`.
   - Forward `decision={results.decision}` as a new prop.

2. `WrittenAnalysis.tsx`: 
   - Add `decision?: Decision` prop.
   - In `generateOverallSummary`: if `decision` is present, **skip recomputation**. Use `decision.winning_team_name` for `pickLabel`, `decision.conviction_tier` for tier, `decision.recommended_units` for sizing string. Keep the existing fallback path only for the prop type (which also needs the same single-source treatment in a follow-up; out of scope here unless trivial).
   - Use `decision.winning_team_name` everywhere `pickLabel` currently appears in the moneyline branch.

**C. AI prompt lock-in (`supabase/functions/ai-analysis/index.ts`)**

Accept `decision` in the request body. Prepend a hard-locked block to all 4 moneyline prompts (NHL / UFC / MLB / generic) **and** the prop prompt:

```
LOCKED PICK (DO NOT CONTRADICT):
- Side: ${decision.winning_team_name}
- Conviction: ${decision.conviction_tier}
- Recommended sizing: ${decision.recommended_units} units
- Win probability: ${decision.win_probability}%
- Edge over market: ${decision.edge ?? "n/a"}%

You MUST write rationale supporting THIS pick. Do NOT recommend the opposite side. 
Do NOT change the unit size. Your "Verdict & Risk" section must explicitly say:
"${decision.recommended_units} units on ${decision.winning_team_name}".
```

Drop `temperature` from 0.6 → 0.3 to reduce drift on this section.

**D. Validation guardrail (client-side, sport-agnostic)**

In `WrittenAnalysis.tsx`, after the AI sections return:
- Build a regex of "wrong side" tokens: every team/player name that is NOT `decision.winning_team_name`.
- Scan each section's content + the "Verdict & Risk" section. If any section recommends/leans/bets on the wrong side (heuristic: phrase like `bet on X`, `take X`, `lean X`, `X moneyline`, `X cover` where X ≠ winning side), then:
  - `console.warn("[decision-mismatch]", { expected, found, section })`.
  - Fire a `window.dispatchEvent(new CustomEvent("sentinel:decision-mismatch", { detail }))` so any future Sentry/log integration can subscribe.
  - **Block the AI sections from rendering** and instead show: "Regenerating analysis…" with a retry button that re-invokes `ai-analysis`.
  - Hard cap: max 2 auto-retries, then fall back to `generateFallbackSections` (which builds prose from the locked `decision`, so it cannot contradict).

The guardrail lives in `WrittenAnalysis.tsx` (shared component used by all sports — moneyline, spread, total, props), satisfying the "sport-agnostic" requirement.

**E. Sport coverage**

`WrittenAnalysis` is already used for NBA/NCAAB/MLB/NHL/UFC/MLS/EPL/NFL/NCAAF moneyline + spread + total + props (single shared component). No sport-specific wiring needed beyond the backend `buildDecision` helper applied at all 3 return points.

### Files changed

1. `supabase/functions/moneyline-api/index.ts` — add `buildDecision()`, attach `decision` to all 3 response payloads.
2. `supabase/functions/ai-analysis/index.ts` — accept `decision` body field, prepend locked-pick block to all 5 prompts, lower temperature to 0.3.
3. `src/components/WrittenAnalysis.tsx` — accept `decision`, short-circuit `generateOverallSummary` when present, add post-AI validation guardrail with retry + fallback.
4. `src/components/MoneyLineSection.tsx` — pass `decision={results.decision}` and use `decision.winning_team_name` for `playerOrTeam`.

### Verification

1. Re-run **Magic vs Hornets** moneyline analysis.
2. Confirm: probability bar (e.g. Magic 45 / Hornets 55), Verdict & Risk paragraph, and Take This Pick block all reference **Hornets** with the **same conviction tier** and **same unit size**.
3. Repeat across NBA player prop, MLB moneyline, NHL puckline, NFL spread, UFC moneyline.
4. Force a contradiction (manually corrupt one AI section) → verify console warning + "Regenerating analysis…" UI.
5. `console` filter: `decision-mismatch` should be empty on clean runs.

### Out of scope

- Server-side Sentry wiring (hook is dispatched as CustomEvent so it can be subscribed later).
- Backend prop analyzer (`nba-api/analyze`) — same `buildDecision` pattern can extend there in a follow-up; this round covers all moneyline/spread/total markets and the LLM lock-in covers prop prose contradictions.

