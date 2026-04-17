
## Plan: Sentinel visual polish pass (sparklines, paywall sticky CTA, welcome scene, progress bar)

Apply the 4 fixes from the spec exactly as written. No pricing/routing/feature changes.

### Fix 1 — Upgraded `Sparkline` component (`src/pages/OnboardingPage.tsx`)
Replace the current plain-path `Sparkline` with the spec version: subtle grid lines, gradient fill under the line, glowing animated `motion.polyline` stroke (drop-shadow filter), small dot nodes at each data point with stagger animation, and a larger glowing endpoint circle. Keeps existing `color` / `down` / `className` props so all 4 call sites (Screen 1, Screen 2, Screen 4 ×2) work unchanged.

### Fix 2 — Paywall vertical cards + sticky bottom CTA (`src/pages/PaywallPage.tsx`)
- Cards already render `space-y-3` vertical — leave as-is.
- Change scroll container `pb-12` → `pb-32` so content clears the sticky footer.
- Remove the inline CTA block (Start Free Trial button, "Cancel anytime", "Maybe later", security row).
- Add `fixed bottom-0 left-0 right-0 z-50` footer with top-fading gradient (`linear-gradient(to top, #0A0A0A 60%, transparent)`), pulsing CTA button (`max-w-md mx-auto`), "Cancel anytime. No hidden fees.", "Maybe later" underlined link, and the "Secure & Encrypted / 18+ Bet Responsibly" row.

### Fix 3 — Rich layered Welcome background + fixed toast (`src/pages/WelcomeConfirmationPage.tsx`)
- Replace WaveImage-only background with a layered scene: deep `#050508` base, central purple radial glow, green ambient glow behind logo, bottom dark fade, subtle green grid overlay (4% opacity), 6 floating animated green particles. Keep `WaveImage` rendered at 30% opacity as an additional layer (graceful fallback preserved).
- Bump watermark "SENTINEL" text opacity to `0.04` per spec.
- Replace bottom toast with spec version: `fixed bottom-8 left-5 right-5 max-w-md mx-auto z-50`, glassmorphism card (`rgba(20,20,20,0.95)`, green border + glow shadow, `backdrop-blur`), 12×12 rounded icon tile with trophy, bold title + subtitle. Tap-to-dashboard preserved.

### Fix 4 — Glowing `ProgressDots` (`OnboardingPage.tsx` + `PaywallPage.tsx`)
Replace both `ProgressDots` with `motion.div` per pill:
- Active step: width 28px, full `#00FF6A`, multi-layer green glow shadow
- Completed: width 14px, `#00FF6A` @ 70% opacity, subtle glow
- Upcoming: width 14px, `#2A2A2A`, no glow
- Smooth 0.25s width/color/shadow transition

### Verification (will run after edits)
1. Visual: `/onboarding` Screens 1, 2, 4 sparklines + glowing progress dots; `/paywall` sticky footer pinned at 390px viewport; `/welcome` layered bg + glass toast.
2. `tsc --noEmit` clean.
3. No DB or edge function changes in this task — verification is purely visual + type-check (will note this explicitly in the final summary).

### Out of scope
Pricing values, routing, sport icons, ESPN avatars, CountdownBanner, AuthPage, backend.
