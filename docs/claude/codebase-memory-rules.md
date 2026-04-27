# Codebase Memory and Session Efficiency Rules

## Architecture Documentation Rules

- Document recurring architecture decisions in `docs/claude/` — not in conversation context
- When a new permanent rule is established (a pattern Zeke wants Claude to always follow), add it to the appropriate `docs/claude/` file and update `CLAUDE.md`
- Prefer small reusable utilities over repeated logic — check `supabase/functions/_shared/` before writing new utility code
- Preserve Sentinel-specific decisions: the 20-factor scoring engine, the Gemini→Grok→OpenAI fallback chain, the mobile-first (320–430px) viewport target, and the Capacitor iOS/Android shell

---

## Token Efficiency Rules (Dubi's 11 Rules)

These rules reduce Claude Code token consumption and session cost:

| # | Rule | How to apply |
|---|------|-------------|
| 1 | Don't pile corrections on a broken thread | Use `/clear` + re-prompt when a conversation goes wrong |
| 2 | Fresh chat every 15–20 turns | Use `/compact` to summarize or `/clear` + paste a brief context summary |
| 3 | Batch related questions | Combine related asks into one message instead of chaining follow-ups |
| 4 | Reuse recurring context | Store in `CLAUDE.md` and `docs/claude/` — don't paste the same context every session |
| 5 | Turn off unused MCP tools | Don't keep MCP servers active if not needed for this session's task |
| 6 | Use a smaller model for simple tasks | Haiku for formatting/renaming/boilerplate; Sonnet/Opus for design and model logic |
| 7 | Inspect only relevant files first | Don't dump the entire `src/` tree — start with the 2-3 files most likely to be relevant |
| 8 | Summarize before editing | State what you found in the files before writing changes |
| 9 | Modify minimal necessary files | One logical change per session where possible |
| 10 | Don't re-read unchanged files | If a file was already read this session and hasn't changed, don't read it again |
| 11 | Work off-peak | Avoid 5–11am PT / 8am–2pm ET weekdays for heavy sessions |

---

## Workflow Rules (Superpowers Methodology)

### Think before patching
Before writing any code:
1. State the root cause in plain language
2. Verify the assumption against the actual file — don't assume from memory
3. Identify what the minimal fix looks like
4. Only then write code

### No placeholder fixes
Never write code like:
```typescript
// TODO: implement this
return null
```
...and declare the task done. If a function isn't implemented, say so explicitly and ask what the actual implementation should be.

### Use targeted edits
- Edit the specific lines that need to change
- Don't reformat or reorganize surrounding code unless asked
- Don't rename variables unless asked

### Always produce verification steps
After every change, provide at minimum:
- The command to build/deploy
- One manual test to confirm the change works
- One edge case to check

---

## Graph-First Code Exploration

If the `codebase-memory-mcp` MCP server is available in the session:

- **Prefer graph queries over grep/glob/Read** for structural exploration — 99% token reduction vs file-by-file reading
- `get_architecture` — use first for an overview of the repo structure
- `search_graph` — find a function/class/symbol by name before reading its file
- `trace_call_path` — determine who calls a function and what it calls (blast radius analysis)
- `detect_changes` — map uncommitted git changes to affected symbols before deploying
- `query_graph` — Cypher-like structural queries for complex dependency questions

When not available, fall back to Glob + Grep before Read — read only the files that are confirmed relevant.

---

## Sentinel Architecture Decisions to Preserve

These are established decisions that should not be reversed without explicit discussion:

| Decision | Rationale |
|----------|-----------|
| Gemini Flash as primary AI provider | Cost-efficient, fast, good reasoning for sports analysis |
| Grok as backup (grok-4-1-fast-reasoning → grok-3-mini) | xAI API reliability as secondary |
| OpenAI optional only | No hard dependency; avoids quota failures blocking all analysis |
| Supabase Edge Functions for all backend logic | No separate backend server; serverless at the edge |
| Deno runtime for Edge Functions | Supabase platform standard |
| `_shared/` for cross-function utilities | Single source of truth for scoring, AI routing, prob math |
| RLS on all sensitive tables | Security by default; service role bypasses only in Edge Functions |
| Mobile-first at 320–430px | Primary user base is mobile sports bettors |
| Capacitor shell for iOS/Android | Native app distribution without React Native complexity |
| RevenueCat for subscription management | Handles App Store / Play Store billing abstraction |
