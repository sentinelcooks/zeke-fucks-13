

## Goal

Fix system-UI collisions (iOS notch/Dynamic Island/status bar, Android status bar) globally so no screen has content overlapping the device status bar.

## Important note on stack

This is a **Vite + React + Capacitor** project, not React Native, so `react-native-safe-area-context` and `SafeAreaView` do not apply. The web equivalent — and the correct fix for Capacitor — is CSS `env(safe-area-inset-*)` plus the Capacitor `StatusBar` plugin so the WebView reports real insets and the status bar overlays consistently.

## Diagnosis

- `index.html` already has `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style=black-translucent` ✓
- `MobileHeader` already pads `env(safe-area-inset-top)` but the status bar (e.g. iOS clock) visually touches the title because:
  1. No Capacitor `StatusBar` plugin is installed/configured, so on native iOS/Android the WebView either hides the status bar or insets are reported as `0`.
  2. Several full-screen pages (`AuthPage`, `OnboardingPage`, `PaywallPage`, `WelcomeConfirmationPage`, `LegalPage`, `AdminPage`, `Dashboard`, `LoginPage`) use `min-h-screen` with no top safe-area padding — content at the top collides with the status bar on these pages.
  3. The `MobileHeader` content row has no extra top breathing room beyond the inset itself.

## Fix

### 1. Add Capacitor StatusBar plugin
- Install `@capacitor/status-bar`.
- In `src/main.tsx` (or a small `setupNative.ts` imported once), on app boot when `Capacitor.isNativePlatform()`:
  - `StatusBar.setOverlaysWebView({ overlay: true })` — makes the webview render under the status bar so `env(safe-area-inset-top)` returns a real value on Android.
  - `StatusBar.setStyle({ style: Style.Dark })` for light icons on the dark theme.
- iOS already overlays via `apple-mobile-web-app-status-bar-style=black-translucent`; this call ensures Android matches.
- User will need to `npx cap sync` after pulling — note this in the chat reply.

### 2. Add global safe-area CSS utilities in `src/index.css`
- Already has `--safe-top` / `--safe-bottom` tokens. Add reusable utility classes:
  - `.pt-safe { padding-top: max(env(safe-area-inset-top), 0px); }`
  - `.pt-safe-plus-2 { padding-top: calc(env(safe-area-inset-top) + 0.5rem); }`
  - `.pb-safe { padding-bottom: max(env(safe-area-inset-bottom), 0px); }`
  - `.min-h-screen-safe { min-height: 100dvh; }` (use `dvh` instead of `vh` to avoid mobile-browser address-bar issues)

### 3. `src/components/mobile/MobileHeader.tsx`
- Replace inline `paddingTop: env(safe-area-inset-top)` with the new `pt-safe` class.
- Add a small extra `pt-1` on the inner content row so the title sits a few pixels below the status bar instead of flush against it.

### 4. Patch full-screen page wrappers to respect the top inset
Add `pt-safe` (or `style={{ paddingTop: 'env(safe-area-inset-top)' }}`) to the root container of each non-dashboard page so their headers/content clear the status bar:

- `src/pages/AuthPage.tsx`
- `src/pages/OnboardingPage.tsx` (`SectionContainer`)
- `src/pages/PaywallPage.tsx`
- `src/pages/WelcomeConfirmationPage.tsx`
- `src/pages/LegalPage.tsx`
- `src/pages/AdminPage.tsx` (both authed and unauthed wrappers)
- `src/pages/LoginPage.tsx`
- `src/pages/Dashboard.tsx`

For pages with custom hero/background that must paint edge-to-edge (Onboarding, Paywall, Welcome), keep the background full-bleed and instead apply `pt-safe` only to the inner content wrapper so visuals still extend behind the notch but text/buttons clear it.

### 5. Bottom inset (already handled, verify)
- `BottomTabBar` already uses `env(safe-area-inset-bottom)` ✓.
- `DashboardLayout`'s `<main>` uses `pb-20` — fine, no change.

## Files to update

- `package.json` (add `@capacitor/status-bar`)
- `src/main.tsx` — initialize StatusBar plugin on native
- `src/index.css` — add safe-area utility classes
- `src/components/mobile/MobileHeader.tsx`
- `src/pages/AuthPage.tsx`
- `src/pages/OnboardingPage.tsx`
- `src/pages/PaywallPage.tsx`
- `src/pages/WelcomeConfirmationPage.tsx`
- `src/pages/LegalPage.tsx`
- `src/pages/AdminPage.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/Dashboard.tsx`
- `capacitor.config.ts` — add `Plugins: { StatusBar: { overlaysWebView: true, style: 'DARK' } }` for native default

## Verification

- In the in-browser preview at 430px, header and full-screen pages still look unchanged (insets resolve to 0).
- After user runs `npx cap sync` and rebuilds the iOS app, status bar clock no longer overlaps "Sentinel Dashboard" title or any other screen's top content.
- On Android, the status bar overlays the gradient background but text/buttons are pushed below it.
- No screen shows a visible blank/white gap above the header — backgrounds extend behind the notch.

