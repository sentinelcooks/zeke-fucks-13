
## Diagnosis

Two compounding bugs producing the screenshots:

### Bug A — Scanner storing alt lines as "edge"
The slate-scanner pulls **every** line for every player (standard + alt lines) and de-vigs each independently. Heavily juiced alt lines (e.g. Curry **over 19.5 @ -481** when the standard line is 27.5) de-vig to ~93–95% and pass the gate. These aren't edges — they're alt-line juice math artifacts, and books often only offer them on DFS apps, so the analyzer can't even find odds for them.

DB confirms: Curry 19.5 (real line 27.5), Booker 19.5, Bridges rebounds 3.5 — all alt-line edges with massive juice.

### Bug B — "No odds for this exact line" mismatch
Today's Edge stores the alt line (19.5). When user taps "See Why" → analyzer auto-runs at line 19.5 → the live `nba-odds/player-odds` lookup only returns books that post that exact line. Most major books only post the standard line (27.5), so the result is empty → "No odds found for this exact line."

## Plan

### 1. `supabase/functions/slate-scanner/index.ts` — only score the standard (consensus) line per player×market

In `evaluatePlayerProps`, after grouping outcomes, identify the **consensus / standard line** per `(player, market)` and discard alt lines:

- For each `(player, marketKey)`, build a list of unique `line` values with the count of bookmakers offering each.
- The standard line = the one offered by the **most bookmakers** (tiebreak: closest American odds to ±100, i.e. lowest `|odds - (-110)|` average).
- Drop every other line before scoring.
- Additionally, hard-skip any prop where the best price is more juiced than `-400` (these are essentially guaranteed alt lines / not realistically placeable).

This guarantees stored picks reflect lines that are actually bookable across multiple books.

### 2. Tighten the pre-rank filter
Already filters `odds >= 500`. Add `odds <= -350` reject (over-juiced not realistically placeable). Edge cards must be plays the user can actually place at a normal book.

### 3. Verification
- `supabase--deploy_edge_functions` `["slate-scanner"]`
- `supabase--curl_edge_functions` `POST /slate-scanner?debug=true` → paste `stats` and `counts`
- `supabase--read_query`:
  ```sql
  SELECT player_name, sport, prop_type, line, direction, odds, hit_rate
  FROM daily_picks
  WHERE pick_date = CURRENT_DATE AND tier = 'edge'
  ORDER BY hit_rate DESC;
  ```
  Confirm: Curry's line ≥ 25, Booker's line in normal range, no `-700`+ juice rows, all rows have realistic standard lines.
- Spot-check by calling `supabase--curl_edge_functions` `POST /nba-odds/player-odds` for the top edge pick to verify multiple books return odds at the stored line.

### Out of scope
Analyzer model, edge_scoring math, See Why flow (already navigates to live analyzer), card UI, onboarding, paywall.

### Files touched
1. `supabase/functions/slate-scanner/index.ts` only.
