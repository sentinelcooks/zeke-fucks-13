# Sentinel — Claude Code Instructions

## Project Overview

Sentinel is a sports analytics and prediction platform:
- **Frontend:** React 18 + Vite SPA, Tailwind CSS, mobile-first (320–430px), Capacitor-wrapped for iOS/Android
- **Backend:** 30+ Supabase Deno Edge Functions, Postgres with RLS, 40+ migrations
- **Core:** Multi-sport weighted scoring engine (NBA, MLB, NHL, UFC) for player props and moneylines
- **Integrations:** RevenueCat (subscriptions), Odds API, ESPN API, Firecrawl, AI providers (Gemini, Grok, OpenAI)

## Always Read These Before Making Changes

Before touching any backend, database, or AI logic, read the relevant sub-doc:

| File | When to read |
|------|--------------|
| [docs/claude/sentinel-backend-rules.md](docs/claude/sentinel-backend-rules.md) | Any backend logic, model/scoring, Edge Functions, API routes |
| [docs/claude/ai-provider-routing.md](docs/claude/ai-provider-routing.md) | Any AI text generation, analysis output, provider routing |
| [docs/claude/supabase-edge-function-rules.md](docs/claude/supabase-edge-function-rules.md) | Any Edge Function creation, editing, or deployment |
| [docs/claude/deployment-safety-rules.md](docs/claude/deployment-safety-rules.md) | Any multi-file change, migration, deploy, or Git push |
| [docs/claude/codebase-memory-rules.md](docs/claude/codebase-memory-rules.md) | Session hygiene, token efficiency, architecture decisions |

## Use Plan Mode First For

**Never start implementing without a plan when the task involves any of:**

- Supabase database migrations
- New or modified Edge Functions
- API keys, secrets, or environment variables
- Auth, admin, or entitlement systems
- AI provider routing or analysis pipeline changes
- RLS policy changes
- Any change touching more than 2 files
- Scoring/model logic changes
- Shared utilities in `supabase/functions/_shared/`

## Critical Non-Negotiables

1. **Never overwrite a working Edge Function with a stub, placeholder, or skeleton.**
2. **Never expose secrets to frontend code.** No API keys in `src/`, Vite env vars (`VITE_*`), localStorage, or sessionStorage.
3. **Service role key stays server-side only** — Supabase Edge Functions and server env vars only.
4. **Never hard-require OpenAI.** It is optional. Gemini Flash is primary; Grok is backup.
5. **No blank or generic analysis outputs.** Every AI analysis must reference actual player/matchup/stat data passed in.
6. **Inspect before editing.** Read the current file before writing to it.
7. **List all files that will change before changing them.**

## Key Paths

```
supabase/functions/          Edge Functions (Deno)
supabase/functions/_shared/  Shared utilities — touch carefully
supabase/migrations/         SQL migrations — always include RLS for sensitive tables
src/                         React frontend — no secrets here
src/integrations/supabase/   Supabase client (anon key only)
src/services/                API call layer
```

## Adding New Permanent Rules

When you establish a new architectural rule or decision that should persist:
1. Add it to the appropriate `docs/claude/` file
2. Add a summary line to the relevant section of this `CLAUDE.md`
3. Never store permanent rules only in conversation context
