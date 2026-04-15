

## Plan: Fix Daily Picks Generation + Set Up Cron

### Root Causes

1. **NBA moneyline-api 404s**: `daily-picks` calls `moneyline-api` with `analyzePath = ""`, making the URL `/functions/v1/moneyline-api`. The handler parses `url.pathname.split("/").pop()` which yields `"moneyline-api"` — none of the route checks match (`teams`, `scoreboard`, `analyze`), so it returns 404. MLB and NHL models work because they use `/analyze` path.

2. **No cron job**: There is no `cron.job` entry to trigger `daily-picks` automatically. It only runs when manually invoked.

3. **No grade-picks cron**: Yesterday's results never get graded automatically either.

### Changes

**1. Fix NBA routing in `supabase/functions/daily-picks/index.ts` (~line 231)**

Change the `analyzePath` for `moneyline-api` from `""` to `"/analyze"`:

```typescript
// Before
const analyzePath = modelEndpoint === "moneyline-api" ? "" : "/analyze";

// After  
const analyzePath = "/analyze";
```

Also update the body payload — `moneyline-api/analyze` expects `team1`/`team2`, not `home_team`/`away_team`:

```typescript
// Before
const bodyPayload = modelEndpoint === "moneyline-api"
  ? { home_team: game.home, away_team: game.away, bet_type: betType, sport: game.sport }
  : { ... };

// After
const bodyPayload = modelEndpoint === "moneyline-api"
  ? { team1: game.home, team2: game.away, bet_type: betType, sport: game.sport }
  : { ... };
```

**2. Deploy the fixed edge function**

**3. Set up two cron jobs** (via SQL insert tool, not migrations):

- `daily-picks` at **8:00 AM ET** (12:00 UTC): `0 12 * * *`
- `grade-picks` at **10:00 AM ET** (14:00 UTC): `0 14 * * *`

This requires enabling `pg_cron` and `pg_net` extensions first (migration), then inserting the cron schedule.

**4. Trigger daily-picks now** to generate today's picks immediately after deploying the fix.

### Scope
- 1 edge function file edited (`daily-picks/index.ts`)
- 1 migration (enable extensions)
- 2 cron jobs inserted
- 1 manual invocation to populate today

