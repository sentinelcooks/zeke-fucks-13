# Sentinel Backend Rules

## Core Mission

When working on Sentinel, optimize in this order:

1. Correctness of backend behavior
2. Reliability of model and scoring outputs
3. Deterministic and explainable logic
4. Safe refactors with minimal regression risk
5. Production-ready architecture
6. Performance where it materially affects UX or throughput
7. Clear separation between UI, orchestration, domain logic, and data access

## Non-Negotiable Engineering Rules

### 1. Never optimize blindly
Before changing any logic, identify:
- current behavior
- desired behavior
- failure mode
- risk of regression
- test surface

Inspect the code and infer the contract from surrounding usage before editing.

### 2. Protect predictive integrity
Do not make changes that improve code aesthetics while degrading model quality. Preserve or improve:
- ranking quality
- calibration
- consistency
- edge-case handling
- input validation
- reproducibility

### 3. Prefer deterministic logic
- Make scoring formulas explicit
- Name intermediate values clearly
- Isolate thresholds and weights as constants/config in `supabase/functions/_shared/thresholds.ts`
- Document why a rule exists

### 4. Reduce false confidence
If a model output is weak, noisy, or based on incomplete input, handle it explicitly in code rather than letting the system imply unjustified certainty.

### 5. Separate concerns
Move toward this structure:
- **Routes/controllers** — orchestrate only
- **Services** — business logic
- **Model/scoring modules** — prediction logic (see `_shared/edge_scoring.ts`, `_shared/prob_math.ts`)
- **Repositories/data clients** — persistence
- **Validators** — input contracts
- **Shared utils** — small and generic (`supabase/functions/_shared/`)

Do not leave critical business logic buried in route handlers or random utility files.

### 6. Minimize unsafe rewrites
Prefer staged refactors over full rewrites unless the existing implementation is clearly unsalvageable. When refactoring: preserve external behavior first, then improve internals.

---

## Workflow for Every Sentinel Task

### Phase 1 — Understand the task
Identify the exact subsystem, inspect surrounding files, trace data flow from input to output. Determine whether the task is: bug fix / refactor / feature addition / model improvement / performance optimization / reliability hardening.

### Phase 2 — Map the execution path
Trace: entry point → validation → transformation → scoring/rules → persistence → response formatting.

Look for:
- duplicated logic
- hidden coupling
- dead code
- inconsistent naming
- threshold drift
- state leaks
- silent fallbacks
- over-broad try/catch
- missing telemetry
- missing tests

### Phase 3 — Improve with discipline
- Explain root cause
- Explain why the change fixes it
- Keep edits localized
- Preserve compatibility unless explicitly asked to break it

### Phase 4 — Verify
After changes, verify: types, imports, call sites, edge cases, error paths, output shape, performance implications, test coverage.

---

## Backend Standards

### API and service design
Prefer: thin handlers, explicit DTOs/schemas, explicit error handling, stable response shapes, idempotent mutation paths.

Avoid: hidden side effects in helpers, route-level business logic, inconsistent response contracts, swallowing exceptions, returning success with partial failure unless clearly modeled.

### Validation
Validate at every boundary: query params, request body, webhook payloads, env vars, third-party API responses, database records that may be null or stale.

### Error handling
Errors must be: actionable, bounded, non-leaky, logged with enough context for debugging.

Do not: throw vague strings, catch and ignore, convert all failures into generic success states.

### Data access
Prefer: service abstraction when complexity exists, batched reads, indexed query awareness, explicit null handling, cache usage only when consistency risk is acceptable.

Flag: N+1 query patterns, duplicate fetches, stale cache risks, inconsistent transaction boundaries.

---

## Model and Scoring Standards

### Core principle
Sentinel's value comes from output quality. When working on predictions, rankings, confidence, or analysis logic: make the scoring path explicit, isolate each feature contribution, avoid accidental double-counting, prevent leakage from future information.

### Scoring audit checklist
When analyzing model logic, always check for:

1. **Feature leakage** — any variable that indirectly contains outcome information, data from the wrong time window, post-event information contaminating pre-event prediction
2. **Weighting problems** — one feature dominating without justification, overlapping features effectively counted twice, stale weights, arbitrary thresholds with no calibration
3. **Confidence inflation** — confidence derived from score magnitude without calibration, confidence boosted by sparse inputs, confidence disconnected from historical hit rate
4. **Inconsistent preprocessing** — mismatched normalization between code paths, null handling changing score semantics, different scaling in training-like vs inference paths
5. **Ranking instability** — tiny input changes causing large order shifts, ties handled inconsistently, sort logic dependent on undefined/null values
6. **Output ambiguity** — score means one thing in one module and another elsewhere, labels not aligned with actual logic

For each issue found, include: file, function, exact risk, suggested fix, regression risk.

### Preferred model-logic patterns
- Pure functions for scoring where possible
- Named intermediate metrics
- Config-driven thresholds (see `_shared/thresholds.ts`)
- Explicit feature contribution logging
- Comparison harnesses between old and new logic

### If asked to improve model results
Do not immediately change weights. First: inspect inputs, normalization, missing data handling, ranking and filtering, historical evaluation path. Identify whether the issue is data quality, business rules, or scoring logic. Only then change formulas or weights.

---

## Refactor Policy

### Safe refactor sequence
1. Identify existing contract
2. Add or outline tests
3. Extract pure logic from mixed files
4. Rename for clarity
5. Simplify branching
6. Remove dead code
7. Harden validation and error handling
8. Optimize only after correctness

### Large refactors
Propose target module boundaries first, then move code in small steps. Keep public interfaces stable. Avoid rewriting logic and architecture simultaneously.

---

## File-Specific Behavior

### Route handlers
Move business logic out unless the task is trivial.

### Model/scoring files (`_shared/edge_scoring.ts`, `_shared/prob_math.ts`, etc.)
Add comments for: score inputs, transformations, thresholds, confidence semantics.

### Database/schema logic (`supabase/migrations/`)
Check: backward compatibility, migrations, null/default behavior, query performance, existing call sites.

### Caching (`_shared/calibration_cache.ts`)
Check: invalidation, stale reads, user-specific vs global cache keys, consistency after writes.

### Cron/ingestion jobs
Check: idempotency, retries, partial failures, rate limits, duplicate inserts, observability.

---

## Output Structure for Sentinel Tasks

For every non-trivial task, structure response in this order:

### A. Diagnosis
- What the subsystem does
- What is wrong
- Root cause
- Risk level

### B. Plan
- Minimal change path
- Better long-term path
- Patch vs refactor recommendation

### C. Implementation
- Exact code edits, file by file
- Migration notes if needed

### D. Verification
- Test cases
- Edge cases
- Manual checks
- Regression risks
