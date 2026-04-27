# Deployment Safety Rules

## Pre-Edit Rules

1. **Inspect before editing.** Always read the current file contents before writing or editing. Never overwrite based on assumption.
2. **List all files that will change** before making any change. State the list explicitly in your response.
3. **Preserve existing request/response schemas** unless the user has explicitly asked to change them. Frontend callers depend on stable shapes.
4. **Avoid broad rewrites.** Prefer targeted, minimal edits. One logical change per edit session.

---

## Design-First Gate

For any change that touches more than 2 files, or affects shared utilities, migrations, auth, AI routing, or scoring logic:

1. Propose the plan first (use Plan Mode)
2. List all files that will change
3. Explain what will break if the change is wrong
4. Get explicit user approval before implementing

"I'll just refactor this quickly" is not an acceptable approach for Sentinel backend changes.

---

## Development Methodology

### Root cause before fix (Iron Law)
Never propose a fix for a symptom. Always:
1. Reproduce or confirm the issue
2. Identify the root cause in the code
3. Explain why the root cause causes the symptom
4. Then propose the fix

Symptom fixes create new bugs. Root cause fixes eliminate the class of problem.

### Test-driven when feasible
For new Edge Function logic or scoring changes:
1. Write the test case or validation harness first
2. Confirm it fails against current behavior
3. Implement the fix
4. Confirm it passes

Vitest is configured (`vitest.config.ts`) for frontend. For Edge Functions, use manual endpoint tests or Deno test files where present (e.g., `nhl-model/weights_test.ts`).

### Two-stage review before declaring done
1. **Spec compliance:** Does the implementation match what was planned/requested?
2. **Code quality:** Are there obvious bugs, type errors, unhandled edge cases, or security issues?

Never skip or merge these stages.

---

## After Changes: Manual Steps

After every change that requires deployment, explicitly list the commands:

```bash
# For Edge Function changes
supabase functions deploy <function-name>
supabase functions logs <function-name> --tail

# For migration changes
supabase db push
# or via MCP: apply_migration

# For frontend changes
npm run build
# Vercel auto-deploys on push to main if configured
```

Always state these steps in your response. Never assume auto-deployment happened.

---

## Git and Deploy Hygiene

- Verify `git config user.email` matches the GitHub account associated with the repo before pushing
- Verify the same email is used in Vercel project settings if deploying to Vercel
- Do not force-push to main/master without explicit user instruction
- Do not amend published commits — create new ones
- Do not skip pre-commit hooks (`--no-verify`) unless user explicitly requests it

---

## Environment Variables

| Variable type | Safe location | Unsafe locations |
|--------------|---------------|-----------------|
| Service role key | Supabase Edge Function secrets | Anywhere else |
| AI provider API keys | Supabase Edge Function secrets | Anywhere else |
| Supabase anon key | `.env` / Vite env (`VITE_*`) | Committed to public git |
| Supabase URL | `.env` / Vite env (`VITE_*`) | n/a |
| Any secret | Server-side only | `localStorage`, `sessionStorage`, frontend JS bundles |

**Rule:** If a variable is prefixed `VITE_`, it will be embedded in the browser JS bundle and is visible to end users. Never put secrets there.

---

## Regression Prevention

Before completing any change:
- Confirm TypeScript types still compile (`npm run build` or `tsc --noEmit`)
- Confirm ESLint passes (`npm run lint`)
- Confirm no imports were broken
- Confirm the response shape from any modified Edge Function is unchanged (or document what changed)
- If scoring/model logic changed: explain what the output difference will be and why it's an improvement
