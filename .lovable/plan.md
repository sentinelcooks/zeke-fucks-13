

## Goal

Spacing-only audit pass: every bottom-fixed element clears the iOS home indicator using `env(safe-area-inset-bottom)`, and every top-anchored title/header has confirmed status-bar clearance. No visual redesign — only padding/margin corrections.

## Findings

### Bottom-fixed elements MISSING home-indicator clearance

| Element | File | Current | Issue |
|---|---|---|---|
| Paywall sticky CTA footer | `src/pages/PaywallPage.tsx` (~L416) | `pb-6 px-5` | Sits flush over home indicator |
| Welcome glass toast button | `src/pages/WelcomeConfirmationPage.tsx` (~L152) | `fixed bottom-8` | `bottom-8` does not adapt to inset |
| Onboarding Continue/Next/Back rows | `src/pages/OnboardingPage.tsx` (4 screens, end of `SectionContainer`) | inline, container has only `pb-12` | Last button can sit on the home indicator on tall pages |
| Floating parlay slip | `src/components/FloatingParlaySlip.tsx` (~L24) | `fixed bottom-24` | Constant `24` ignores inset; on big-indicator devices it overlaps |
| Settings "Saved" toast | `src/pages/SettingsPage.tsx` (~L416) | `fixed bottom-24` | Same as above — adequate today but should follow the pattern |

### Bottom-fixed elements ALREADY safe (no change)

- `BottomTabBar` — uses `paddingBottom: env(safe-area-inset-bottom)` ✓
- `NbaPropsPage` Analyze button — `sticky bottom-20` inside scroll container, sits above tab bar which already insets ✓

### Top-anchored headers / titles to verify

| Element | File | Status |
|---|---|---|
| Dashboard `MobileHeader` | `src/components/mobile/MobileHeader.tsx` | `pt-safe` ✓ |
| Onboarding `SectionContainer` | `src/pages/OnboardingPage.tsx` (~L133) | `pt-safe-plus-4` ✓ |
| Paywall hero | `src/pages/PaywallPage.tsx` (~L197) | `pt-safe` on root ✓ |
| Welcome page hero | `src/pages/WelcomeConfirmationPage.tsx` (~L24) | `pt-safe` on root ✓ |
| **Legal page header** | `src/pages/LegalPage.tsx` (~L227–229) | Root has `pt-safe`, but inner header uses `pt-6` extra. Screenshot shows status-bar overlap with title ("Terms of U…" clipped). The inner `px-5 pt-6 pb-4` row needs to start AFTER the safe inset, not add `pt-6` on top of `pt-safe` only on the wrapper — this works in browser but on real device the title still hugs the status bar. Add `pt-safe-plus-2` on the inner header row OR change root from `pt-safe` to `pt-safe-plus-2`. |
| AdminPage authed | `src/pages/AdminPage.tsx` (~L339) | `pt-safe-plus-4` ✓ |
| Auth page | `src/pages/AuthPage.tsx` (~L188) | `pt-safe-plus-4` ✓ |
| Login page | `src/pages/LoginPage.tsx` (~L108) | `pt-safe pb-safe` ✓ |
| Dashboard route shell | `src/pages/Dashboard.tsx` (~L105) | `pt-safe pb-safe` ✓ |

## Fix

### 1. Add a "plus" bottom utility in `src/index.css`
Mirror the existing top utilities so bottom-fixed components can clear the home indicator AND keep their own visual bottom spacing:

```css
.pb-safe-plus-2 { padding-bottom: calc(env(safe-area-inset-bottom) + 0.5rem); }
.pb-safe-plus-4 { padding-bottom: calc(env(safe-area-inset-bottom) + 1rem); }
```

(`.pb-safe` already exists.)

### 2. `src/pages/PaywallPage.tsx` — sticky CTA footer (~L416–423)
Replace `pt-8 pb-6 px-5` with `pt-8 px-5 pb-safe-plus-4`. Background gradient and pointer-events stay identical.

### 3. `src/pages/WelcomeConfirmationPage.tsx` — fixed CTA toast (~L152)
Replace `fixed bottom-8 left-5 right-5` with `fixed left-5 right-5` and add inline `style={{ bottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }}` (preserves the existing 2rem visual gap on devices without an indicator). All other styles untouched.

### 4. `src/pages/OnboardingPage.tsx` — `SectionContainer` content wrapper (~L133)
Change `pb-12` on the inner content div to `pb-safe-plus-4` (still gives ~1rem visual padding plus the indicator clearance). Last button row will then sit above the home indicator on every onboarding screen.

### 5. `src/components/FloatingParlaySlip.tsx` (~L24)
Change `fixed bottom-24 right-4` to `fixed right-4` plus inline `style={{ bottom: 'calc(env(safe-area-inset-bottom) + 6rem)' }}` so it stays above the tab bar (which already has its own inset) regardless of indicator size.

### 6. `src/pages/SettingsPage.tsx` (~L416)
Same pattern as the parlay slip: replace `bottom-24` with inline `style={{ bottom: 'calc(env(safe-area-inset-bottom) + 6rem)' }}`. Keeps "Saved" toast above tab bar consistently.

### 7. `src/pages/LegalPage.tsx` (~L227)
Change root from `min-h-screen pb-28 pt-safe` to `min-h-screen pb-safe-plus-4 pt-safe-plus-2`. This adds a small breathing buffer below the status bar (fixes the title clipping in the uploaded screenshot) and replaces the static `pb-28` with proper home-indicator clearance for the bottom of the scroll content.

## Non-goals

- No layout, color, font, animation, icon, or copy changes.
- `BottomTabBar`, `MobileHeader`, `NbaPropsPage` Analyze button, `Dashboard.tsx`, `AdminPage`, `AuthPage`, `LoginPage`, `OnboardingPage` `SectionContainer` top inset, `PaywallPage` top inset, `WelcomeConfirmationPage` top inset — all already correct, untouched.
- No changes to in-flow (non-fixed/sticky) bottom content on regular dashboard pages — `<main className="pb-20">` in `DashboardLayout` already sits above the safely-inset tab bar.

## Files to update

- `src/index.css`
- `src/pages/PaywallPage.tsx`
- `src/pages/WelcomeConfirmationPage.tsx`
- `src/pages/OnboardingPage.tsx`
- `src/components/FloatingParlaySlip.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/LegalPage.tsx`

## Verification (post-`npx cap sync` rebuild)

1. **Paywall**: green "Start Free Trial" button sits visibly above the home indicator on iPhone 14/15.
2. **Welcome**: glass toast button has clear gap from home indicator.
3. **Onboarding** (all 4 screens): Continue/Next button rows are not overlapped by the home indicator after scrolling to bottom.
4. **Floating parlay slip**: clears tab bar AND home indicator on devices with large indicators.
5. **Settings "Saved" toast**: appears above tab bar consistently.
6. **Legal**: page title and back button are no longer touching the iOS clock; bottom of scroll list clears the home indicator.
7. **Browser preview at 390×844**: nothing visually regresses (insets resolve to 0; spacing matches today).

