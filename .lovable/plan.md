

## Goal

When a user picks "American" or "Decimal" in onboarding, persist that choice to their profile so the entire app (Games, Props, Slip, etc.) actually renders odds in their chosen format.

## Diagnosis

- `OnboardingPage.tsx` saves the odds format to `localStorage["sentinel_onboarding_odds_format"]` only.
- `AuthPage.tsx` → `saveOnboardingToDb()` writes `referral`, `sports`, `betting_style` to `onboarding_responses`, but **never reads or persists `odds_format`**.
- The whole app reads odds format from `profile.odds_format` via `useOddsFormat()`. That column stays at its default `'american'`, so decimal users always see American.

## Fix

### 1. `src/pages/AuthPage.tsx` — persist odds format on signup/login

Inside `saveOnboardingToDb()`:
- Read `localStorage.getItem("sentinel_onboarding_odds_format")`.
- If it's `"american"` or `"decimal"`, include it in the `profiles` update:
  ```ts
  await supabase.from("profiles")
    .update({ onboarding_complete: true, odds_format: oddsFormat })
    .eq("id", userId);
  ```
- Clear `sentinel_onboarding_odds_format` from localStorage after write (alongside the other onboarding keys).

### 2. `src/contexts/AuthContext.tsx` — refresh profile after write

After `saveOnboardingToDb` runs (already triggered via `onAuthStateChange` and post-submit), the existing `fetchProfile` call on `SIGNED_IN` will pick up the new value. Add an explicit `await refreshProfile()` call inside `AuthPage.handleSubmit` after `saveOnboardingToDb` so the user lands on `/dashboard` with the correct format already loaded (no flash of American).

### 3. `src/pages/SettingsPage.tsx` — already correct, no change

Settings already calls `updateProfile({ odds_format })` which writes to `profiles`. That flow works; this fix just makes onboarding match it.

### 4. Defensive: also store odds format on `onboarding_responses` (optional column)

Not required for the fix. Skipping — `profiles.odds_format` is the single source of truth that `useOddsFormat` reads.

## Files touched

- `src/pages/AuthPage.tsx` — read `sentinel_onboarding_odds_format`, include it in the profiles update, clear localStorage key, call `refreshProfile()` after save.

## Verification

1. `psql` SELECT `id, odds_format, onboarding_complete FROM profiles WHERE id = '<test user>'` before and after a fresh signup that picks "Decimal" → confirm column flips from `american` to `decimal`.
2. Sign up with a new account, pick Decimal in onboarding, land on `/dashboard` → confirm Games tab and Props tab render odds like `1.91` instead of `-110`.
3. Sign up with another account, pick American → confirm odds render like `-110` / `+150`.
4. Open Settings → confirm the active button matches what was selected during onboarding (proves the DB value, not localStorage, is driving the UI).

