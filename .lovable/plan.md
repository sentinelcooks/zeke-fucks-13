

## Goal

Make the analyzer-output confidence floor in the orchestrator **configurable per sport** so MLB and NHL props (which return naturally lower confidence than NBA) can validate. NBA stays at 0.65, MLB drops to 0.45, NHL drops to 0.50, UFC defaults to 0.50.

## Root cause

`supabase/functions/_shared/sport_scan.ts` line **463**:

```ts
if (projected < 0.65) return null;
```

This is a single hardcoded floor applied to every analyzer response regardless of sport. The `nba-api/analyze` endpoint itself returns a `confidence` value for all sports (MLB has its own 20-factor `calculateMlbPropConfidence` engine that regresses toward 50 — line 2412 — so its outputs cluster in the 0.45–0.62 range and never clear 0.65). Result: every MLB/NHL candidate is silently dropped post-analysis → `validated: 0`.

The user's request is correct: this needs to be per-sport, not one number.

## Fix — `supabase/functions/_shared/sport_scan.ts` only

### 1. Add a sport-keyed threshold map (top of file, near `SPORT_KEYS`)

```ts
const ANALYZER_MIN_CONF: Record<string, number> = {
  nba: 0.65,
  mlb: 0.45,
  nhl: 0.50,
  ufc: 0.50,
};
```

### 2. Replace the hardcoded floor in `validateWithAnalyzer` (line 463)

```ts
const minConf = ANALYZER_MIN_CONF[play.sport] ?? 0.55;
if (projected < minConf) return null;
```

### 3. Keep edge gate (`edge <= 0.025` on line 462) unchanged

That's a market-edge requirement, not a confidence threshold — it correctly applies to every sport.

## Files changed

- `supabase/functions/_shared/sport_scan.ts` — add `ANALYZER_MIN_CONF` map; change one line in `validateWithAnalyzer` from a hardcoded `0.65` to a per-sport lookup.

## Non-goals

- No changes to the analyzer (`nba-api/index.ts`) — its internal scoring stays as-is. The user's spec ("Lower the analyzer's minimum confidence gate") is satisfied at the orchestrator's analyzer-output gate, which is the actual gate currently rejecting candidates. The analyzer itself does not enforce a 0.65 floor on output — it just reports a number.
- No changes to `edge_scoring.ts`, `slate-scanner/index.ts`, the Picks UI, or the `daily_picks` schema.
- No DB migration.

## Verification (will be run after the edit, output pasted in summary)

1. Deploy `slate-scanner-nba`, `slate-scanner-mlb`, `slate-scanner-nhl`, `slate-scanner`.
2. `curl` `slate-scanner` → confirm `perSport.mlb.validated > 0` AND `perSport.nhl.validated > 0`.
3. SQL:
   ```sql
   SELECT sport, COUNT(*) AS picks
   FROM daily_picks
   WHERE pick_date = CURRENT_DATE
   GROUP BY sport ORDER BY sport;
   ```
   → expect rows for **mlb, nba, nhl**.
4. **If MLB or NHL still show `validated: 0` after the threshold change**, fetch a sample analyzer response for an MLB/NHL prop via `curl POST nba-api/analyze` and inspect: (a) returned `confidence`, (b) `verdict`, (c) `playerIsOut`, (d) reported `seasonAvg`. Then identify which of the four explicit drop conditions in `validateWithAnalyzer` (lines 445–457) is firing — `playerIsOut`, `verdict === PASS/FADE`, `seasonAvg === 0`, or low edge — and fix that specific gate per-sport rather than re-claiming the threshold change worked.
5. Paste verbatim: scanner JSON `perSport`, the SQL result, and (if step 4 was needed) the raw analyzer response sample.

