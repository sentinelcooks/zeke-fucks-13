
## Goal

Make the onboarding odds choice truly stick on the very first app session, so a user who selects Decimal lands in the app already seeing decimal odds everywhere, with Settings reflecting the same saved choice.

## Diagnosis

The backend write is happening, but the app still shows American because the client state is racing:

- A new profile is first created with the default `odds_format = "american"`.
- Onboarding later patches the profile to `"decimal"`.
- The app redirects/render path can happen before the updated profile is re-fetched into client state.
- `useOddsFormat()` falls back to `"american"` whenever `profile` is still stale or not ready.
- There are also a few remaining UI spots that still render raw American odds text instead of the shared formatter.

The network trace already shows the profile update request sending:
```text
PATCH profiles
{"onboarding_complete":true,"odds_format":"decimal"}
```
So the main issue is sync/read timing in the app, not the onboarding button itself.

## Implementation

### 1. Fix the first-session profile sync in `src/pages/AuthPage.tsx`
Update the onboarding save flow so it does not rely on a context refresh that may run before auth/profile state is ready.

Changes:
- Keep `saveOnboardingToDb(userId)` using the explicit `userId`.
- After the `profiles` update succeeds, immediately read the fresh profile row back with:
  - `select("id, odds_format, onboarding_complete, ...").eq("id", userId).single()`
- Use that fresh read to guarantee the updated value exists before redirecting.
- Stop navigating to `/dashboard` until onboarding persistence is finished.
- Guard against duplicate saves from both `handleSubmit` and `onAuthStateChange`.

Result:
- New users won’t land on the dashboard with a stale `"american"` profile loaded from the initial profile upsert.

### 2. Make auth/profile readiness explicit in `src/contexts/AuthContext.tsx`
Tighten the profile-loading flow so odds-dependent screens don’t assume American while the real profile is still loading.

Changes:
- Make `fetchProfile(userId)` return the fetched profile object in addition to setting state.
- Add a profile-ready concept (or equivalent) so authenticated users are distinguishable from “profile not loaded yet”.
- Update `refreshProfile` so it can refresh by explicit `userId` when needed, instead of only depending on `user` already being present in context.
- Avoid using stale default profile data after signup/signin.

Result:
- The app won’t silently default to American during the exact window where the profile is still being synchronized.

### 3. Add a safe first-load fallback in `src/hooks/useOddsFormat.ts`
Make the odds formatter resilient during the short onboarding-to-dashboard handoff.

Changes:
- If the user is authenticated but `profile` is not ready yet, temporarily read `sentinel_onboarding_odds_format` from localStorage as a fallback.
- Once the real profile loads, profile data becomes the source of truth.
- Keep the fallback narrowly scoped to this transition period so Settings/backend remain authoritative.

Result:
- Even if the profile fetch is a beat late, the first paint still matches the user’s onboarding choice.

### 4. Finish the app-wide render audit for raw American odds
Replace any remaining raw odds labels with the shared formatter so the display is consistent everywhere.

Priority files already identified:
- `src/components/AddToSlipSheet.tsx` — currently builds `+/-` American text manually.
- Re-check any remaining renderers that output odds strings directly instead of `useOddsFormat().fmt(...)`.

Files already mostly correct and should stay on the shared formatter:
- `src/pages/GamesPage.tsx`
- `src/pages/FreePicksPage.tsx`
- `src/pages/FreePropsPage.tsx`
- `src/pages/TrendsPage.tsx`
- `src/components/mobile/OddsProjection.tsx`
- `src/components/home/ModernHomeLayout.tsx`
- `src/components/parlay/ParlayAnalysisResults.tsx`
- `src/pages/ParlayPage.tsx`

## Files to update

- `src/pages/AuthPage.tsx`
- `src/contexts/AuthContext.tsx`
- `src/hooks/useOddsFormat.ts`
- `src/components/AddToSlipSheet.tsx`
- Any additional odds renderer found in the final audit

## Verification

### Database verification
Run a read query confirming the saved profile value for the new test user:
```sql
select id, odds_format, onboarding_complete
from profiles
where id = '<new-user-id>';
```
Expected:
```text
odds_format = decimal
onboarding_complete = true
```

### End-to-end verification
1. Create a brand-new account.
2. Choose Decimal in onboarding.
3. Complete account creation and land in the app.
4. Confirm these show decimal immediately on first load:
   - Home picks
   - Games
   - Free Picks / Free Props
   - Trends
   - Slip / Add to Slip where applicable
5. Open Settings and confirm Decimal is selected.
6. Refresh the app and confirm it still stays Decimal.

### Summary output after implementation
Paste:
- the SELECT result showing `odds_format = decimal`
- the exact screens verified in the live app
- any remaining odds locations found and fixed
