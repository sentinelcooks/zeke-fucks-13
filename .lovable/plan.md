

## Goal

Replace the hardcoded "AI Daily Tip" card on the Home tab with a personalized, AI-generated tip that:
1. Reads each user's onboarding answers (`referral`, `sports`, `betting_style`)
2. Returns sharp, useful advice tailored to *that* user
3. Rotates automatically every 12–13 hours (so each user sees a fresh tip twice a day)
4. Is unique per user

## Diagnosis

`src/components/home/ModernHomeLayout.tsx` (lines 930–943) hardcodes:
> "Prime-time props with 65%+ hit rates are today's strongest edges…"

It never reads `onboarding_responses` for that card. There's already a `personalize` edge function and an `ai_recommendations.daily_tip` field, but that one is generated **once** at onboarding and never rotates.

## Plan

### 1. Database — add a rotating tip cache column

Add to `onboarding_responses`:
- `daily_tip_text text` — current rotating tip
- `daily_tip_generated_at timestamptz` — last refresh timestamp
- `daily_tip_seed int` — rotation counter (used to push variety into the prompt)

Migration only adds nullable columns, no RLS changes (existing user-scoped policies cover them).

### 2. New edge function — `rotating-tip`

`supabase/functions/rotating-tip/index.ts` (verify_jwt = true)

Logic:
- Read caller's `user_id` from JWT
- Fetch their `onboarding_responses` row (`referral`, `sports`, `betting_style`, `daily_tip_text`, `daily_tip_generated_at`, `daily_tip_seed`)
- If `daily_tip_generated_at` is within the last 12h → return cached `daily_tip_text` (no AI call, no cost)
- Otherwise:
  - Increment `daily_tip_seed`
  - Call Lovable AI (`google/gemini-3-flash-preview`) with their profile + the seed (seed nudges the model toward a different angle each rotation: bankroll, line shopping, prop correlation, injury news, closing line value, hedging, etc.)
  - Use **tool calling** for structured output: `{ tip: string, focus_area: string }`
  - Tip rules: 1–2 complete sentences, references their sports + style, no generic "bet responsibly" filler, follows the existing `personalize` tone
  - Persist new `daily_tip_text`, `daily_tip_generated_at = now()`, new seed
  - Return the tip
- Cache window is randomized per user between 12h and 13h (using `user_id` hash) so tips don't all refresh at once

### 3. Wire the Home card to the new function

`src/components/home/ModernHomeLayout.tsx`:
- Add `useEffect` that calls `supabase.functions.invoke('rotating-tip')` on mount when user is signed in
- Replace the hardcoded `<p>` with the returned tip
- Add a tiny skeleton/shimmer while loading
- Fallback: if the function fails (rate limit, no onboarding), keep existing text so the card is never empty
- Also surface a 1-line `focus_area` chip ("Bankroll" / "Line shopping" / "Correlation" / etc.) above the tip for visual variety as it rotates

### 4. New-user safety

If a user has no `onboarding_responses` row yet (signed up before onboarding finished), the function returns a generic-but-decent default tip and skips DB write.

## Files touched

- New migration: add 3 columns to `onboarding_responses`
- New: `supabase/functions/rotating-tip/index.ts`
- Edit: `src/components/home/ModernHomeLayout.tsx` (replace hardcoded tip block)

## Out of scope

- Existing onboarding `personalize` flow stays as-is (still powers the smaller "AI Tip" card on `HomePage.tsx` welcome state).
- No paywall changes, no new tabs.

## Verification

After build:
1. `psql` SELECT to confirm the 3 new columns exist on `onboarding_responses`
2. `curl` the deployed `rotating-tip` endpoint with a real session JWT and confirm response shape `{ tip, focus_area, generated_at }`
3. Open `/dashboard` Home tab and confirm the AI Daily Tip card now shows a tip referencing the user's onboarding sports/style instead of the hardcoded line
4. Manually update `daily_tip_generated_at` to >13h ago, reload, confirm a new tip generates and `daily_tip_seed` increments

