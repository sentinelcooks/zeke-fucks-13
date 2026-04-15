

## Plan: Add Rate-Limit Retry Logic to Daily Picks Generation

### Problem
The `daily-picks` edge function calls the AI gateway for each game analysis but hits rate limits immediately. All calls fail with `RateLimitError`, producing 0 picks. The function has no retry/backoff logic.

### Root Cause
The function fires all game bet analyses in parallel batches. The AI gateway enforces per-trace rate limits (~5s cooldown). With 12+ games analyzed simultaneously, every call after the first few gets rate-limited.

### Changes

**1. `supabase/functions/daily-picks/index.ts`** — Add retry with exponential backoff

- Create a `retryWithBackoff(fn, maxRetries=3)` wrapper that catches `RateLimitError` (or HTTP 429) and waits `retryAfterMs` (or 2^attempt seconds) before retrying
- Apply it to `analyzeGameBets()` calls and `analyzePlayerProp()` calls
- Reduce parallelism: process games in smaller sequential batches (3-4 at a time instead of all at once) with a small delay between batches to stay under rate limits

**2. Add sequential throttling for AI gateway calls**

- Between each AI gateway fetch, add a ~1-2 second delay to avoid triggering the per-trace rate limit
- This trades speed for reliability — the function may take longer but will actually produce picks

**3. Fallback: show latest available picks when today has none**

In `ModernHomeLayout.tsx`, if today's picks are empty after loading, fall back to showing the most recent picks from the last 3 days (with a "From [date]" label) so the carousel is never empty.

### Scope
- 1 edge function updated + redeployed
- 1 frontend component updated (fallback display)

