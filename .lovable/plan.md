
## Plan: Onboarding polish + paywall pricing correction

### Scope
Apply the previously-approved visual polish (purple glow orbs, Inter font, logo halo) but keep the **existing vertical 3-card pricing layout** with the **original pricing** ($9.99 / $39.99 / $219.99) — most of which is already in place. Only fix the countdown banner copy/icon and ensure all visual polish items land.

### Changes

**1. `index.html`** — add Inter Google Font preconnect + stylesheet link

**2. `src/index.css`** — set `font-family: 'Inter', system-ui, sans-serif` as global default on `body`

**3. `src/pages/OnboardingPage.tsx`**
- Center hero logo block on Screen 1 (logo + "SENTINEL" wordmark stacked, centered)
- Add green box-shadow halo around hex logo
- Add purple atmosphere orbs to root wrapper (top-center `#7B2FFF/30%`, bottom-left `#641EDC/20%`, blurred 120px)

**4. `src/pages/PaywallPage.tsx`**
- Add same purple atmosphere orbs to root wrapper
- **Keep existing 3 vertical pricing cards as-is** — Weekly $9.99 / Monthly $39.99 (default, MOST POPULAR) / Yearly $219.99 (BEST VALUE) with current savings callouts. No pricing changes.
- Keep features accordion, CTA, footer, security row unchanged

**5. `src/components/onboarding/CountdownBanner.tsx`** — update banner copy/structure:
- Left: keep yellow price tag icon (already `Tag` from lucide). Change two-line text to:
  - Line 1: "LIMITED TIME" (yellow `#FFC93C`, bold uppercase)
  - Line 2: "7 DAY FREE TRIAL" (yellow `#FFC93C`, bold uppercase)
- Right: keep existing live `HH : MM : SS` countdown with HRS/MIN/SEC labels (already correct)
- Keep dark card bg, 1px `#2A2A2A` border, rounded

**6. `src/pages/WelcomeConfirmationPage.tsx`** — strengthen green box-shadow halo around hex logo; verify purple corner glows render

### Out of scope
- Pricing values (already correct in current code per the override spec)
- Pricing card layout (already vertical stacked per spec)
- Stripe/RevenueCat wiring
- Logo image asset replacement

### Verification
1. `/onboarding` Screens 1-4 → purple corner glows visible, Inter font applied, Screen 1 logo centered with green halo
2. `/paywall` → 3 vertical pricing cards unchanged ($9.99/$39.99/$219.99), Monthly default selected with MOST POPULAR gold badge, Yearly has BEST VALUE green badge, countdown banner shows "LIMITED TIME / 7 DAY FREE TRIAL" with yellow tag icon and live timer
3. `/welcome` → green halo around hex logo, stadium bg with purple atmosphere
4. Run `tsc --noEmit` to confirm no type errors
