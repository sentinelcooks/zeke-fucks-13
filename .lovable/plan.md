

## Goal

Fix "Remember Me" on the email/password sign-in & sign-up screen so a checked box keeps the user logged in across browser closes, and an unchecked box ends the session when the tab/browser closes.

## Root cause (verified)

The contract is already wired everywhere **except the writer**:

- `src/contexts/AuthContext.tsx` lines 94–107 — on every fresh tab open, if `localStorage["primal-remember"] !== "true"`, it calls `supabase.auth.signOut()` and clears the session. This is the kill switch.
- `src/services/api.ts`, `src/services/oddsApi.ts`, `src/components/MoneyLineSection.tsx` — all read the same `primal-remember` flag to decide between `localStorage` vs `sessionStorage` for the legacy session token.
- `src/pages/LoginPage.tsx` lines 82–86 — correctly writes `localStorage.setItem("primal-remember", "true")` (or removes it) on successful key login.
- **`src/pages/AuthPage.tsx`** — has the `remember` checkbox state (line 52, default `true`) and renders it (lines 375–384), but **never writes it to localStorage** in `handleSubmit` (line 138) or in the OAuth handler (line 162). Result: every email/password and Google/Apple sign-in leaves the flag at whatever it was before (usually unset → falsy), so on the next browser open `AuthContext` immediately signs them out.

Supabase's own session is already configured to persist (`src/integrations/supabase/client.ts`: `storage: localStorage, persistSession: true, autoRefreshToken: true`), so the only thing breaking persistence is the missing flag write.

## Fix — one file

### `src/pages/AuthPage.tsx`

1. Initialize `remember` from the stored flag so the checkbox reflects the user's last choice when they return:
   ```ts
   const [remember, setRemember] = useState(
     () => localStorage.getItem("primal-remember") !== "false"  // default true
   );
   ```

2. Add a tiny helper used by every successful auth path:
   ```ts
   const persistRememberChoice = (value: boolean) => {
     if (value) {
       localStorage.setItem("primal-remember", "true");
     } else {
       localStorage.removeItem("primal-remember");
     }
   };
   ```

3. Call it in **three** spots:
   - Inside `handleSubmit` right after `result.error` is falsy (line ~150), before the `navigate("/dashboard")`.
   - Inside `handleOAuth` right before `lovable.auth.signInWithOAuth(...)` is invoked (line ~166) — must persist *before* the redirect because the callback comes back to a fresh page load.
   - Inside the `onAuthStateChange` listener (line ~126) on `SIGNED_IN`, as a final safety net so the flag is always written when a session is established (covers the OAuth return path even if the user closed/reopened the tab mid-flow).

That's the entire code change. No DB schema changes, no edge function changes, no Supabase client changes.

## Why this is sufficient

- With `remember=true`: flag is `"true"` in `localStorage`. `AuthContext` line 100 short-circuits and keeps the session. Supabase's `localStorage`-backed session is already long-lived (refresh token auto-rotates, default ~30 days, refreshed on every visit).
- With `remember=false`: flag is removed. On the next fresh tab (`isNewTab` true at line 97), `AuthContext` signs out and forces re-auth. Existing behavior, now actually reachable.

## Files changed

- `src/pages/AuthPage.tsx` — initialize `remember` from storage, persist it on submit + OAuth + `SIGNED_IN`.

## Non-goals

- No change to `LoginPage.tsx` (already correct).
- No change to `AuthContext.tsx` — its read logic is correct.
- No change to Supabase client storage settings (already `localStorage` + `persistSession`).
- No new tables or migrations. Supabase auth's own refresh tokens already provide ~30‑day persistence; we're not lengthening that further.

## Verification (will run after approval)

1. **DB query** — confirm Supabase already manages persistent sessions via `auth.refresh_tokens`:
   ```sql
   SELECT COUNT(*) AS active_refresh_tokens
   FROM auth.refresh_tokens
   WHERE revoked = false;
   ```
   Paste result. (No schema change expected — the persistence layer is Supabase-managed; this just proves it's live.)

2. **Manual test in preview**:
   - Sign in with Remember Me checked → verify `localStorage["primal-remember"] === "true"` and `localStorage["sb-opvlboxntlyvftvwdkqr-auth-token"]` is present.
   - Hard reload / close & reopen tab → land on `/dashboard` without re-auth prompt.
   - Sign out, sign back in with Remember Me **unchecked** → verify the flag is absent, close/reopen tab → forced back to `/auth`.
   - Repeat for Google OAuth path.

3. Paste a summary of all three checks (flag value, refresh-token count, manual flow result) before marking done.

