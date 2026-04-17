
## Plan: Paywall conversion redesign + accordion click fix

Apply the 4 fixes from the spec exactly to `src/pages/PaywallPage.tsx` and `src/components/onboarding/CountdownBanner.tsx`.

### Fix 1 — Sticky footer click pass-through (`PaywallPage.tsx`)
- Set `pointerEvents: "none"` on the fixed gradient wrapper so the gradient area no longer intercepts taps on the accordion behind it.
- Wrap the button + microcopy in an inner div with `pointerEvents: "auto"` so only the actual interactive elements capture clicks.
- Bump scroll container padding from `pb-32` → `pb-36`.

### Fix 2 — Pricing hierarchy redesign (`PaywallPage.tsx`)
Replace the 3-column grid with:
- **Monthly card**: full-width hero, green border + double-glow shadow, MOST POPULAR tab badge anchored top-center, $39.99 in 28px green on right, radio indicator top-right, "7-DAY FREE TRIAL" pill inline with label, "Save $19.97 vs Weekly" with check.
- **Weekly + Yearly**: 2-column grid below, compact cards with BEST VALUE badge on Yearly, radio indicators, smaller price treatment.
- Keep `PLANS` data and `selectedPlan` state untouched — only JSX changes.

### Fix 3 — Conversion psychology
- **3a** Social proof row (3 pravatar avatars + "10,000+ bettors already winning") between pricing and features accordion.
- **3b** Trust signal row (Lock + Secure & Encrypted · 18+ Bet Responsibly · Cancel Anytime) appended at the bottom of the scroll content, above the sticky footer area. Remove the duplicate trust row currently inside the sticky footer.
- **3c** Pulsing red dot in `CountdownBanner.tsx` next to "LIMITED TIME" label.

### Fix 4 — Accordion accessibility
- Wrap each feature row in `<div className="relative z-10">` so they sit above any stray overlays.
- Confirmed `pb-36` from Fix 1 prevents the last row being hidden.

### Verification (after switching to default mode)
1. Visual at 390×844: Monthly hero card dominant, Weekly/Yearly side-by-side below, social proof row visible, accordion rows fully tappable when scrolled near the sticky footer (the gradient area no longer blocks touches), pulsing red dot animating on countdown.
2. `npx tsc --noEmit` clean.
3. No DB or edge function changes — purely client-side JSX/Tailwind. I will state this explicitly in the final summary in lieu of SELECT/curl output, since there is nothing backend-side to verify.

### Out of scope
Pricing values, routing, sparklines, comparison charts, onboarding, auth, welcome screen, ESPN avatars, sport icons.
