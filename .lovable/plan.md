
## Plan: Redesign AuthPage in Sentinel premium style

### Reference takeaways (from uploaded mockup)
- Tall rounded card with soft inner glow + subtle vignette
- Wordmark at top, 3-segment progress bar (last segment glowing teal/green) — we'll adapt this as a Sentinel motif
- Big two-line headline with second line in brand accent color
- Small muted subheadline
- Uppercase tiny labels above inputs ("EMAIL ADDRESS", "PASSWORD")
- Soft dark inputs with subtle inner shadow, no harsh border
- "or sign up with" hairline divider
- Two full-width social buttons (Google, Apple) in dark pill cards
- Fine-print legal line with brand-color links
- Sticky giant gradient CTA pill at bottom ("Launch Sentinel 🚀")
- Back link + dot indicator below CTA

### Sentinel brand reinterpretation
- Replace the teal/blue mockup palette with **Sentinel green `#00FF6A` accent + dark purple ambient** (matches onboarding/paywall we just polished)
- Keep glassmorphism + Inter font + purple atmosphere orbs already established
- Keep existing star-field background for continuity

### Changes — single file: `src/pages/AuthPage.tsx`

**Structure (top → bottom inside the card):**
1. **Wordmark header** — "SENTINEL" in green `#00FF6A` with subtle glow + small lock/shield mark on the left. Underneath: 3-segment progress bar (1st & 2nd dim, 3rd glowing green gradient — visual cue this is the "final step")
2. **Headline block** — "Create your" (white) / "free account" (green accent) for signup; "Welcome" / "back to Sentinel" for login. Subhead: "Unlock your personalized AI picks in seconds." / "Sign in to access today's edge."
3. **Mode toggle** — keep the segmented Sign In / Sign Up pill but restyle: thinner, cleaner, green active fill instead of purple
4. **Inputs** — uppercase tracked labels (`text-[10px] tracking-[0.15em] text-white/50`), softer dark fields (`bg-white/[0.03]`, `border-white/[0.06]`, inset shadow), no left-icon clutter — keep eye toggle on password
5. **"or continue with" divider** — hairline `bg-white/[0.06]` with centered tiny muted label
6. **Social buttons** — two full-width dark pill buttons (Google + Apple) using `lovable.auth.signInWithOAuth("google" | "apple")` per Lovable Cloud OAuth knowledge. Brand glyphs inline (Google multi-color G SVG, Apple monochrome). On click → standard redirect flow.
7. **Legal microcopy** — "By creating an account you agree to our Terms and Privacy Policy. Must be 18+. Gamble responsibly." with green underline links to `/legal`
8. **Sticky CTA** — large rounded-full button, gradient `linear-gradient(90deg, #00FF6A, #00C853)`, black text, soft green glow `0 8px 32px rgba(0,255,106,0.35)`. Label: "Launch Sentinel 🚀" (signup) / "Sign In →" (login)
9. **Footer** — "← Back" link (routes to `/onboarding`) + 3-dot progress indicator (last dot green)

**Visual polish:**
- Card: `bg-[hsla(260,20%,10%,0.7)]`, `border border-white/[0.06]`, `backdrop-blur-2xl`, `rounded-[28px]`, soft inner top-light gradient overlay
- Add green ambient orb top-right inside card (matches reference glow)
- Keep purple atmosphere orbs in page background
- Remove the existing `TypeGlowInput` purple glow → swap for cleaner subtle green focus ring (`focus:ring-1 focus:ring-[#00FF6A]/40`)
- Remove "Secured Access" divider + "Sentinel Analytics" footer (replaced by legal + back link)

**Functional preserved:**
- `signIn` / `signUp` from `useAuth`, error handling, loading spinner, remember-me persistence (kept as a small inline checkbox above CTA), `saveOnboardingToDb` flow, redirect to `/dashboard`
- Mode-from-location-state still respected

**OAuth wiring:**
- Add `import { lovable } from "@/integrations/lovable"` (file already auto-managed if Google/Apple was previously set up — if not, the buttons will call it and Lovable Cloud will prompt). Handler:
  ```ts
  const handleOAuth = async (provider: "google" | "apple") => {
    const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin + "/dashboard" });
    if (result.error) setError(result.error.message);
  };
  ```
- If `@/integrations/lovable` isn't yet present in the project, fall back to `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + "/dashboard" } })` so the buttons never break.

### Out of scope
- Backend changes, new routes, password reset flow, email template changes
- Onboarding/Paywall pages (already polished)
- Logo asset swap

### Verification
1. Visit `/auth` (or login button from onboarding) → premium card renders, green accent headline, tracked uppercase labels
2. Toggle Sign In ↔ Sign Up → headline + CTA label swap smoothly, name field animates in for signup
3. Type in inputs → soft green focus ring, no purple glow
4. Click Google / Apple → redirects to OAuth (or shows graceful error if provider not configured)
5. Submit valid creds → routes to `/dashboard`
6. Mobile viewport (390px) → card fills nicely, sticky CTA stays prominent, no overflow
7. `tsc --noEmit` clean
