

## Plan: Full Onboarding Redesign — 6 Screens, Match Reference Designs Exactly

### Scope
Complete visual + flow rewrite of `OnboardingPage.tsx` and `PaywallPage.tsx` to match the 6 uploaded screenshots. Add post-purchase confirmation (Screen 6). Upgrade WaveSpeed integration to use 3 different models contextually. Replace purple gradient look with the new black + neon-green system shown in the references.

### New flow
```
Screen 1: Hero/Welcome (1/5)        → app preview card w/ Luka pick
Screen 2: Value Prop (2/5)          → dashboard preview + social proof
Screen 3: Personalize (3/5)         → odds format + sports grid
Screen 4: Without vs With (4/6)     → red/green comparison cards + testimonial
Screen 5: Paywall (5/6)             → yellow timer banner + 3 vertical pricing cards
Screen 6: Confirmation (6/6)        → stadium silhouette bg + welcome toast → /dashboard
```
Note: progress denominator switches from `5` to `6` starting Screen 4 (matches screenshots).

### Design system updates
- **Background**: `#0A0A0A` (replace purple ambient orb with subtle violet glow only in corners)
- **Primary green**: `#00FF6A` for CTAs, accents, win color
- **Negative red**: `#FF3B3B`
- **Cards**: `#141414`, 1px border `#2A2A2A`
- **CTA buttons**: full-width green pill (`border-radius: 50px`), black text, bold
- **Progress indicator**: top-left text `"1 / 5"` + horizontal pill dots (active green, inactive dark gray) — replaces current gradient progress bar
- Font already SF Pro / Inter compatible via Tailwind defaults — no font change needed

### WaveSpeed integration upgrade

**1. Update `supabase/functions/generate-image/index.ts`**
- Accept `{ prompt, model }` body (default `wavespeed-ai/flux-dev`)
- Whitelist 3 models: `wavespeed-ai/nano-banana-pro`, `wavespeed-ai/flux-dev/lora/krea`, `wavespeed-ai/flux-dev/image-to-image/ultra-fast`
- Submit URL becomes `https://api.wavespeed.ai/api/v3/${model}`
- Existing polling logic stays

**2. Update `src/utils/generateImage.ts`** — add optional `model` param
**3. Update `src/hooks/useGeneratedImage.ts`** — pass `model` through; cache key includes model implicitly via caller

**4. New helper `src/hooks/useBatchPreloadImages.ts`** — fires all avatar generations in parallel on Onboarding mount; pre-generates Screen 6 stadium bg (slowest model) early.

**Model assignments per asset:**
| Asset | Model | Cache key |
|---|---|---|
| Luka Doncic avatar (S1) | nano-banana-pro | `avatar-luka` |
| J. Tatum avatar (S2) | nano-banana-pro | `avatar-tatum` |
| A. Matthews avatar (S2) | nano-banana-pro | `avatar-matthews` |
| 3 social-proof avatars (S2) | nano-banana-pro | `social-1/2/3` |
| Mike R. testimonial avatar (S4) | nano-banana-pro | `testimonial-miker` |
| 4 sport icons (S3) | flux-dev/image-to-image/ultra-fast | `sport-nba/mlb/nhl/ufc` |
| Stadium silhouette bg (S6) | flux-dev/lora/krea | `stadium-bg` |

All WaveSpeed-loaded images render via `<OnboardingHero>` (skeleton → fade-in → dark gradient fallback). Existing component already handles this — only needs to accept `model` and a `rounded`/aspect prop for non-hero use cases (avatars are circular, sport icons are square).

**Generalized image component**: extend `OnboardingHero` → rename usage as `WaveImage` with props `{ prompt, cacheKey, model, className, fallbackClassName }`. Keep export of `OnboardingHero` as a thin wrapper for backwards compat.

### Screen-by-screen build (`OnboardingPage.tsx` — full rewrite)

**Screen 1 — Hero**
- Top: `1 / 5` + dot pills
- Sentinel hex logo (centered, green glow), "SENTINEL" tracking text
- Headline: "Stop guessing." (white) / "Start winning." (green)
- Sub: "AI-powered props, data-backed decisions, real edge."
- **App preview card** (dark, rounded):
  - Header: "TODAY'S PICKS" + "View All"
  - Pick row: WaveImage(Luka avatar) + name + game/time + "OVER 32.5 Points" + green "HIGH CONFIDENCE 64% +EV: 7.2%" badge
  - Stats row: YTD ROI `+18.47%` (green), WIN RATE `58.3%` (white), inline mini SVG green sparkline
  - Locked footer: 🔒 "Advanced Analytics — Unlock Premium"
- 3 feature pills row (Live Games / AI Picks / Profit Tracker) — dark cards with icon + title + 2-line subtext
- Green pill CTA "Get Started"
- "Already have an account? Sign in" → `/auth`

**Screen 2 — Value Prop**
- `2 / 5` progress
- Headline: "See What You're / Missing." sub "Pros don't guess. They use data."
- **Full app preview card** (larger):
  - Sentinel header + tab row (Dashboard active green pill / Picks / Tracker / Parlay Builder)
  - "TODAY'S TOP PICKS" with 3 rows (Tatum avatar+OVER 28.5 PTS / Matthews avatar + ML / team icon Rockies +1.5) each with confidence % + EV badge
  - Right side YTD PERFORMANCE card with "+18.47%" + green sparkline
  - Locked blurred area: 🔒 "Advanced Projections & Line Movement — Upgrade to Unlock"
- Social proof banner: 3 overlapping WaveImage circular avatars + "10,000+ users joined this week / 20% Average ROI Increase"
- Green CTA "Continue"

**Screen 3 — Personalize**
- `3 / 5` progress
- Headline "Make It Yours." sub "We'll personalize your experience."
- **ODDS FORMAT** label + sub "We'll show odds the way you like them."
  - Two side-by-side toggle cards: American (`+150 -110`) and Decimal (`2.50 1.91`). Selected = green border + green text.
- **SPORTS YOU BET ON** label + "Select all that apply."
  - 2x2 grid: NBA, MLB, NHL, UFC. Each tile: WaveImage sport icon (centered) + bold name. Selected → green border + checkmark badge top-right.
- ✨ "We'll personalize picks & insights based on your preferences." note
- Bottom: "Back" text button (left) + green pill "Next" (right). Next disabled until odds format chosen and ≥1 sport selected.

**Screen 4 — Without vs With**
- `4 / 6` progress (denominator changes here)
- Headline: "Don't Bet Blind. / See The Difference." (green accent)
- Sub: "Data beats luck. Every time."
- Two side-by-side comparison cards:
  - **Without Sentinel**: red theme, `-12.34%` / "ROI After 90 Days" / red downward animated SVG line / 4 ✗ bullets (Guessing & Hope, Emotional Bets, Chasing Losses, No Real Strategy)
  - **With Sentinel**: green theme + glow, `+18.47%` / green upward animated SVG line / 4 ✓ bullets (AI-Powered Picks, High Confidence & +EV, Track & Improve, Smarter Parlays)
- Testimonial card: WaveImage(Mike R. avatar) + quote + "- Mike R." + green "VERIFIED" pill
- Green pill CTA "Continue" → `/paywall`

**Screen 5 — Paywall** (`PaywallPage.tsx` rewrite)
- `5 / 6` progress
- Headline "Unlock Your Winning Edge." sub "Join now and start winning."
- **Yellow tag countdown banner** (NEW component):
  - Dark rounded card, 1px border
  - Left: 🏷️ yellow tag SVG icon + "LIMITED TIME: 20% OFF" (yellow `#FFC93C`, bold, uppercase)
  - Right: live countdown `HH : MM : SS` in white bold + HRS/MIN/SEC labels under each
  - **Persistence**: countdown end timestamp stored in `localStorage` key `sentinel_paywall_offer_ends_at` — first visit sets it to `now + 24h`. Re-renders/visits resume from that timestamp so it doesn't reset. When 0 → reset another 24h.
- **3 vertical pricing cards** (stacked) — radio-button style, full-width:
  - Weekly: radio + "Weekly" + green "7-DAY FREE TRIAL" pill + "$1.43/day" sub + price `$9.99` right
  - Monthly (selected default, green border + glow + "MOST POPULAR" gold badge top-right): same structure + "✓ Save $19.97 vs Weekly"
  - Yearly: green "BEST VALUE" badge + price `$219.99` + "= $18.33/mo" + "✓ Save $339.49 vs Monthly"
- Features accordion list (kept as-is, content matches): Real-Time Prop Analysis, EV & Edge Calculations, Arbitrage Scanner, AI-Powered Picks, Line Shopping Across Major Books, Profit Tracker & Analytics
- Green pill CTA: "Start Free Trial" (or "Subscribe") → on tap: store selected plan in localStorage + advance to **Screen 6 confirmation** (we navigate to `/onboarding/welcome-confirmation` route OR set state to render Screen 6 inline within Paywall — see below)
- Footer: "Cancel anytime. No hidden fees." + "Maybe later" (skip → `/auth`)
- Bottom row: 🔒 Secure & Encrypted | 18+ Bet Responsibly

**Screen 6 — Welcome Confirmation** (NEW)
- New file `src/pages/WelcomeConfirmationPage.tsx`
- New route `/welcome` added in `App.tsx`
- `6 / 6` progress (all dots green)
- **Full-bleed background**: WaveImage(stadium silhouette, model `flux-dev/lora/krea`, cacheKey `stadium-bg`) covering entire viewport with dark overlay for legibility. Subtle Ken Burns slow-zoom CSS animation.
- Center stack: Sentinel hex logo + "SENTINEL" tracking text
- Headline: "You're Ready." (white) / "Let's Win." (green)
- Sub: "Smarter bets. Bigger results."
- Faint "SENTINEL" decorative watermark (very low opacity behind content)
- Bottom welcome toast card: 🏆 trophy icon + "Welcome to Sentinel" + "Your edge starts now."
- **Auto-redirect**: `setTimeout(() => navigate("/dashboard"), 3500)` + tap toast → immediate redirect

### Files changed/added
1. `src/pages/OnboardingPage.tsx` — full rewrite (Screens 1-4, plus the existing 5-step infra). Drop the old "Edge/Odds/Sports/Experience/Value" 6-screen variant; the new 4-screen pre-paywall flow uses screens hero→value→personalize→comparison.
2. `src/pages/PaywallPage.tsx` — rewrite header/banner/pricing UI to match Screen 5; keep features accordion + reviews block (content already matches spec). Wire CTA to navigate to `/welcome`.
3. `src/pages/WelcomeConfirmationPage.tsx` — NEW (Screen 6).
4. `src/App.tsx` — add `/welcome` route.
5. `src/components/onboarding/OnboardingHero.tsx` — extend to support `model` prop + arbitrary aspect ratios + circle variant. Or split into a generalized `<WaveImage>` component used by avatars/icons/heroes.
6. `src/components/onboarding/CountdownBanner.tsx` — NEW yellow-tag countdown banner (persistent localStorage timestamp).
7. `src/utils/generateImage.ts` — add `model` param.
8. `src/hooks/useGeneratedImage.ts` — accept `model` arg.
9. `supabase/functions/generate-image/index.ts` — accept `model`, validate against allow-list, dynamic submit URL.

### State / persistence
- `sentinel_onboarding_odds_format` — "american" | "decimal"
- `sentinel_onboarding_sports` — JSON array
- `sentinel_subscription` — "trial" on Subscribe tap (already used)
- `sentinel_selected_plan` — "weekly"|"monthly"|"yearly" (NEW)
- `sentinel_paywall_offer_ends_at` — ISO timestamp (NEW, for countdown persistence)

### Animations
- 300ms ease-out slide transitions between onboarding screens (existing `AnimatePresence` pattern)
- CTA buttons: subtle idle pulse (CSS keyframe `pulse-glow`)
- SVG line charts (Screen 4): `pathLength: 0 → 1` over 1.1s (existing pattern)
- Cards stagger-fade on entry (existing `motion.div` pattern with delay)
- Screen 6 background: 12s linear `transform: scale(1) → scale(1.05)` Ken Burns
- Progress dot active state: green fill + width grow (200ms)

### Out of scope
- Real Stripe/RevenueCat purchase wiring on plan selection — CTA still flows to `/auth` w/ trial flag (existing behavior preserved). Screen 6 is shown after auth-success rather than after payment success in this iteration.
- True step-counter denominator change *visible to user* mid-flow — handled by hardcoded `1/5, 2/5, 3/5, 4/6, 5/6, 6/6` per spec (not a single dynamic counter).
- Sport icon real generation if WaveSpeed quota is low — fallback emoji (existing logos kept as fallback `<img>` if `WaveImage` fails).

### Verification
1. `/onboarding` → Screen 1 shows Luka pick card, green CTA, "1 / 5" + dot pills.
2. Tap Get Started → Screen 2, dashboard preview renders all 3 picks + YTD chart + social proof avatars (WaveSpeed).
3. Continue → Screen 3, can pick odds format + at least one sport before Next enables.
4. Continue → Screen 4, comparison cards animate in, testimonial avatar loads.
5. Continue → `/paywall` → "5 / 6" progress, yellow countdown banner ticks live, 3 pricing cards visible, Monthly default selected.
6. Tap "Start Free Trial" → routes to `/welcome` → stadium bg fades in (or fallback gradient) → trophy toast → auto-redirect to `/dashboard` after ~3.5s.
7. Reload `/paywall` → countdown resumes from persisted timestamp, doesn't reset.
8. Network tab: only one `generate-image` invoke per unique cacheKey across the entire flow.
9. Force WaveSpeed failure (break key) → all images fall back to dark gradient — flow never breaks.

