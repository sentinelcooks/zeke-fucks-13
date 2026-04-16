

## Plan: Fix Home/Away Splits + Pace, Add PPG Explainer Popup

### Root Cause (Backend)

In `supabase/functions/moneyline-api/index.ts`, the helpers `computeHomeAwaySplits` (line 194) and `computePace` (line 274) filter completed games using `comp.status?.type?.completed === true`. ESPN's `/teams/{id}/schedule` endpoint returns this `completed` boolean **inconsistently** — it's often missing or `false` on games that have actually finished. Every other model in this repo (`mlb-model`, `nhl-model`, `nba-api`) correctly uses `comp.status?.type?.name === "STATUS_FINAL"` instead.

That's why the screenshot shows Celtics 0-0 / 0-0 (0% PPG) and Hornets only 1-0 home — most completed games are being silently dropped from the count, so PPG/win% reads as zero.

This single helper feeds **NBA, MLB, NHL, NFL, NCAAB** in the Lines tab, so one fix covers every sport.

### Changes

**1. `supabase/functions/moneyline-api/index.ts`**

- `computeHomeAwaySplits` (line 194): replace
  `if (!comp || comp.status?.type?.completed !== true) continue;`
  with the union check used elsewhere:
  `const isFinal = comp?.status?.type?.completed === true || comp?.status?.type?.name === "STATUS_FINAL"; if (!isFinal) continue;`
- `computePace` (line 274): same union check on the `.filter(...)`.
- `extractH2HFromEvents` (line 336): apply the same union check so head-to-head also picks up finals that ESPN flags only via `STATUS_FINAL`.

This is sport-agnostic — applies to NBA, MLB, NHL, NFL, NCAAB automatically.

**2. `src/components/MoneyLineSection.tsx` — Pace explainer popup**

In the Pace card (lines 1838-1861), wrap each team row in a `<button>`. On click, open a small dialog (using existing `framer-motion` modal pattern already used elsewhere in this file at line 1443) that explains:

- **PPG** = Points Per Game (or Runs Per Game for MLB, Goals Per Game for NHL — sport-aware label based on `results.sport`)
- **Net** = the team's recent PPG minus opponents' recent PPG
- **Pace number** = estimated possessions per game (NBA) / runs context (MLB) / shots+goals context (NHL)
- A concrete example using the team's actual numbers, e.g. *"Hornets average 127.0 PPG and allow 126.0, giving a +1.0 net rating over their last 10 games. Higher PPG = faster, higher-scoring style."*

Single shared modal component at the bottom of the section, opened via `useState<{team, pace, sportLabel} | null>`, dismissed on backdrop click or X button. No new dependencies — reuses Vision UI styling and the dialog pattern already present in this file.

### Verification (mandatory before marking complete)

1. **Deploy** `moneyline-api` edge function.
2. **Curl** the deployed function with an NBA matchup that has played games (e.g. Celtics vs Hornets) and grep the JSON response for `"splits"` — confirm `home.wins + home.losses > 0` and `home.ppg > 0`. Paste the relevant slice of the response in the completion message.
3. **Repeat** the curl with an MLB matchup (e.g. Yankees vs Red Sox) and an NHL matchup to confirm splits/pace are now non-zero across sports. Paste both responses.
4. **UI smoke**: load `/dashboard/analyze`, select Moneyline → Lines, run Celtics vs Hornets, expand "Home / Away Splits" → confirm non-zero values; tap a team in the Pace card → confirm the PPG explainer popup opens with the example sentence.

### Out of Scope

- No DB changes (no migrations needed).
- No changes to MLB/NHL 20-factor model files — they already use `STATUS_FINAL` correctly and pass through the splits/pace from `moneyline-api`'s helpers.
- No Pace card layout redesign — just adds tap-to-explain.

