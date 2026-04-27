# Supabase Edge Function Rules

## Cardinal Rules

1. **Never overwrite a working Edge Function with a stub, placeholder, or skeleton.** If you need to add to a function, read its full current contents first, then make targeted edits.
2. **Every Edge Function must validate the authorization header** before doing any meaningful work.
3. **Service role key never goes to frontend.** It must only live in Edge Function secrets or server-side env vars.
4. **Migrations must include RLS** when tables store sensitive config, user data, picks, or API keys.
5. **Deploy shared utilities (`_shared/`) carefully** — changes there affect every function that imports them.
6. **Verify after every deploy** — test the endpoint and check the Supabase function logs.

---

## Authorization Pattern

Every Edge Function should include this check near the top:

```typescript
const authHeader = req.headers.get('Authorization')
if (!authHeader) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  })
}
```

For admin functions, additionally verify against the service role or a known admin JWT — never trust just any bearer token for privileged operations.

---

## Secret Management

| Secret | Env var name | Scope |
|--------|-------------|-------|
| Supabase service role key | `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only |
| Supabase anon key | `SUPABASE_ANON_KEY` | Frontend (safe — no admin access) |
| Gemini API key | `GEMINI_API_KEY` | Edge Functions only |
| Grok API key | `GROK_API_KEY` | Edge Functions only |
| OpenAI API key | `OPENAI_API_KEY` | Edge Functions only |
| Odds API key | `ODDS_API_KEY` | Edge Functions only |

Access secrets via `Deno.env.get('SECRET_NAME')`. Never hardcode. Never pass them in response bodies.

---

## Migrations

- Always run `supabase migration new <descriptive_name>` to generate a timestamped file
- Include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + appropriate policies for any table storing sensitive data
- Test migrations on a branch before applying to production
- Never edit an already-applied migration file — create a new one to amend

---

## Shared Utilities (`supabase/functions/_shared/`)

| File | Purpose |
|------|---------|
| `ai-provider.ts` | AI provider routing (Gemini → Grok → OpenAI fallback) |
| `advanced_stats.ts` | Player/team advanced stat calculations |
| `calibration_cache.ts` | Model calibration caching layer |
| `correlation.ts` | Prop correlation utilities |
| `edge_scoring.ts` | Core edge scoring engine |
| `factor_log.ts` | Factor contribution logging |
| `injuries.ts` | Injury report processing |
| `odds_intelligence.ts` | Odds movement and sharp-money analysis |
| `prob_math.ts` | Probability math utilities |
| `sport_scan.ts` | Sport-specific slate scanning |
| `thresholds.ts` | Scoring thresholds and config constants |

**Rule:** If you need new shared logic, add it to the appropriate existing file or create a new `_shared/` module. Do not copy-paste the same logic into multiple individual functions.

---

## Edge Function Inventory

| Function | Purpose |
|----------|---------|
| `admin-onboarding` | Admin user setup |
| `ai-analysis` | AI-powered prop/game analysis |
| `calibrate-model` | Model calibration runs |
| `correlated-props` | Correlated prop detection |
| `daily-picks` | Daily picks generation pipeline |
| `free-props` | Free tier props endpoint |
| `games-schedule` | Schedule fetching |
| `generate-image` | AI image generation for picks |
| `grade-picks` | Outcome grading |
| `key-admin` | API key management (admin) |
| `key-auth` | API key authentication |
| `log-outcome` | Pick outcome logging |
| `mlb-model` | MLB prediction model |
| `moneyline-api` | Moneyline data endpoint |
| `nba-api` | NBA data endpoint |
| `nba-odds` | NBA odds fetching |
| `nhl-model` | NHL prediction model |
| `odds-snapshot` | Odds snapshot storage |
| `personalize` | User personalization |
| `prop-explainer` | Prop explanation generation |
| `revenuecat-entitlements` | RevenueCat subscription verification |
| `rotating-tip` | Rotating tip/insight generation |
| `save-config` | User config persistence |
| `session-cleanup` | Session cleanup cron |
| `slate-scanner` | Main slate scanner |
| `slate-scanner-mlb` | MLB slate scanner |
| `slate-scanner-nba` | NBA slate scanner |
| `slate-scanner-nhl` | NHL slate scanner |
| `slate-scanner-ufc` | UFC slate scanner |
| `slate-validate` | Slate validation |
| `trends-api` | Trends data endpoint |
| `ufc-api` | UFC data endpoint |

---

## Deploy Procedure

After editing any Edge Function:

```bash
# Deploy a single function
supabase functions deploy <function-name>

# Deploy a shared utility change (redeploy all affected functions)
supabase functions deploy --no-verify-jwt <function-name>

# Check logs after deploy
supabase functions logs <function-name> --tail
```

**Always list the manual deploy commands in your response** after making Edge Function changes — do not assume auto-deployment.

---

## CORS

Include CORS headers in every Edge Function that is called from the browser:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

if (req.method === 'OPTIONS') {
  return new Response('ok', { headers: corsHeaders })
}
```
