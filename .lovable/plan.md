

## Goal

Replace the "Lovable" name shown on the Google and Apple sign-in sheets with **"Sentinel"** so users see your brand during OAuth.

## Why this is a config task, not a code change

The provider name on the consent screen ("Continue to Lovable") comes from the **OAuth client registered with Google/Apple**, not from your app's code. Right now your project uses Lovable Cloud's managed/shared OAuth client, which is registered as "Lovable". To show "Sentinel", you need to register your own OAuth clients under your own Google Cloud + Apple Developer accounts, then plug those credentials into Lovable Cloud's Auth settings.

The existing `lovable.auth.signInWithOAuth("google" | "apple", …)` code in `AuthPage.tsx` keeps working unchanged — it automatically uses your credentials once they're configured.

## Steps you'll perform (I cannot do these — they require your Google + Apple developer accounts)

### A. Google — register a Sentinel OAuth client

1. Go to https://console.cloud.google.com/ → create/select a project named **Sentinel**.
2. **APIs & Services → OAuth consent screen**:
   - App name: **Sentinel**
   - User support email + logo (this is what users will see)
   - Authorized domains: `lovable.app` (and your custom domain if any)
   - Scopes: `openid`, `userinfo.email`, `userinfo.profile`
3. **Credentials → Create credentials → OAuth client ID** → Web application:
   - Authorized redirect URI: `https://opvlboxntlyvftvwdkqr.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client Secret**.
5. In Lovable: open **Cloud Dashboard → Users → Authentication Settings → Sign In Methods → Google** → switch to "Use your own credentials" → paste Client ID + Secret → Save.

### B. Apple — register a Sentinel Services ID

1. https://developer.apple.com/account → **Identifiers → +** → **Services IDs**:
   - Description: **Sentinel**
   - Identifier: e.g. `com.sentinel.web`
   - Enable **Sign In with Apple** → Configure:
     - Primary App ID: your Sentinel App ID (create one if needed)
     - Domains: `auth-key-portal.lovable.app` (+ custom domain if any)
     - Return URLs: `https://opvlboxntlyvftvwdkqr.supabase.co/auth/v1/callback`
2. **Keys → +** → enable **Sign In with Apple** → download the `.p8` file → note the **Key ID**.
3. Note your **Team ID** (top right of Apple Developer console).
4. In Lovable: **Cloud Dashboard → Users → Authentication Settings → Sign In Methods → Apple** → "Use your own credentials" → click **Generate Secret** → fill Team ID, Key ID, Client ID (the Services ID = `com.sentinel.web`), and paste the `.p8` contents → it produces a JWT (valid 6 months) → Save.
   - Set a calendar reminder to regenerate the JWT before expiry.

### C. Verify

1. Sign out, click "Continue with Google" → consent sheet now reads **"Sign in to continue to Sentinel"** with your logo.
2. Same for Apple → sheet shows **Sentinel**.
3. Confirm sign-in still completes and lands on `/dashboard`.

## Files changed

None. No code, no migrations, no edge functions. Pure dashboard configuration on Google, Apple, and Lovable Cloud.

## Action button I'll give you

After approval, I'll surface a button to open the Cloud dashboard so you can paste the credentials directly.

