

## Plan: Single Source of Truth for Injury Data

### Root cause (what's actually wrong)

Three different edge functions fetch injuries from **three different ESPN endpoints** with **different parsing rules**:

| Caller | Endpoint | Field shape | Cache |
|---|---|---|---|
| `moneyline-api` (Lines / Spreads / Totals) | `/sports/{sport}/injuries` (league-wide) | `{ name, position, status, type, details }` | 5-min module-scoped per sport |
| `mlb-model` / `nhl-model` (delegated MLB+NHL) | `/teams/{teamId}/injuries` | different shape | none |
| `nba-api` (Props tab) | `/sports/{sport}/injuries` filtered by abbr | `{ player_name, position, status, … }` | none |

So the EXACT same player can appear with different statuses depending on which tab the user is on. Worse, `_injuryCache` lives across requests — meaning Lines (cache hit, stale) and Spreads (potentially fresh after invalidation) can disagree even within the same matchup. And the moneyline-api raw `inj.status` is whatever ESPN returns ("Day-To-Day", "Day To Day", "questionable", etc.) with no normalization, so a string like `"Day-To-Day"` flows straight to the UI badge — that's how Bam appeared "day-to-day" in Spreads while another section (using a different fetch) didn't show him at all.

### Fix strategy: One canonical injury fetch per analyze, normalized, returned in response, no cache

**1. New shared injury module — `supabase/functions/_shared/injuries.ts`**

A single helper used by `moneyline-api`, `mlb-model`, `nhl-model`, and `nba-api`. Fetches `/sports/{sport}/injuries` ONCE per analyze invocation (no module cache), and returns a normalized array per team with a strict status enum:

```ts
type NormalizedStatus = "out" | "doubtful" | "questionable" | "day-to-day" | "probable";
interface NormalizedInjury {
  name: string;        // canonical display name
  player_name: string; // alias for nba-api callers
  position: string;
  status: NormalizedStatus;  // lowercased + hyphenated
  rawStatus: string;         // original ESPN string for debugging
  detail: string;
  source: "espn-league-injuries";
  fetchedAt: string;         // ISO timestamp
}
```

Normalization rules — applied in ONE place only:
- Lowercase + collapse whitespace + replace spaces with hyphens between letters: `"Day To Day"` / `"Day-To-Day"` → `"day-to-day"`
- Map ESPN variants: `injured-list`/`il` → `out`; `dtd` → `day-to-day`; anything not in the enum → DROPPED (not shown). This implements "default to available — never guess".
- De-dupe by player name within a team.

**2. `moneyline-api/index.ts` — remove the stale cache + use shared module**

- Delete `_injuryCache` and `getAllInjuries`/`getTeamInjuries` (lines 215-245). Replace with `import { fetchTeamInjuries } from "../_shared/injuries.ts"`.
- Each analyze call fetches fresh per request (no cross-request cache → "Do not cache injury data across different matchup searches" satisfied). Within one analyze, both team injuries are derived from a single league-wide fetch shared via a Promise — so Lines, Spreads, and Totals ALL see identical arrays because they're computed from the same `extras.injuries1/2`.
- The MLB and NHL delegate branches already pass their own `injuries1/2` back in the response, but we'll override with the canonical normalized arrays from the parent so the response shape is identical regardless of which delegate ran.

**3. `mlb-model/index.ts` and `nhl-model/index.ts`**

- Replace their `getTeamInjuries` (per-team endpoint) with the same shared helper using the league-wide endpoint. This eliminates the cross-source mismatch where MLB/NHL delegates disagreed with the parent moneyline-api.
- `adjustForInjuries` stays — but reads the normalized `status` enum (cleaner branching than substring matches like `s.includes("dtd")`).

**4. `nba-api/index.ts` — props tab**

- Replace `getTeamInjuries` (lines 849-882) with the shared helper. Map `{name → player_name}` for backward compat with existing UI keys (`player_injuries`, `teammate_injuries`, `opponent_injuries`).
- Result: Bam Adebayo's status in **Props** is the exact same normalized value as in **Lines/Spreads** for the same team, fetched at the same minute.

**5. Frontend — `src/components/MoneyLineSection.tsx`**

- The injury render (line 1782-1810) already reads from `results.injuries` — no logic change needed because it's already the same source for moneyline/spread/total within one response. The fix is purely backend.
- Tighten the status color/label switch to use the normalized enum exclusively (drops the case-insensitive guesses like `"Day To Day"` matching nothing).
- Add a small "as of HH:MM" timestamp under the Injury Report header from `results.injuries.fetchedAt` so users see freshness.

**6. Response contract (consistent across all sports)**

Every analyze response returns:
```json
{
  "injuries": {
    "team1": NormalizedInjury[],
    "team2": NormalizedInjury[],
    "fetchedAt": "2026-04-17T19:32:14Z",
    "source": "espn-league-injuries"
  }
}
```

### Verification (will run in default mode)

1. `supabase--deploy_edge_functions` for `moneyline-api`, `mlb-model`, `nhl-model`, `nba-api`.
2. `supabase--curl_edge_functions` POST `/moneyline-api/analyze` for `Heat vs <opp>`, `bet_type=moneyline` → grep response for `"Adebayo"`. Note status (or absence).
3. Same matchup, `bet_type=spread` → grep response. **Status MUST be byte-identical to step 2** (same normalized value or both absent).
4. Same matchup, `bet_type=total` → same check.
5. `supabase--curl_edge_functions` POST `/nba-api/analyze` for any Heat player → grep `teammate_injuries` for Adebayo. **Status MUST match the moneyline-api response from steps 2-4.**
6. Repeat steps 2-5 for an MLB matchup (Yankees vs anyone) → confirm injury array identical between `moneyline-api` (which delegates to `mlb-model`) and direct `mlb-model/analyze` calls.
7. Repeat for NHL.
8. Paste the matching JSON slices in the completion summary as proof.

### Out of scope

- No DB/schema changes (no new tables/columns).
- No changes to factor weights or scoring math — only the data feed is unified and normalized.
- No new AI prompts.
- Other tabs (Games schedule, Free Props, Daily Picks) keep their own unrelated injury references for now — this fix targets the analyze flow the user reported.

