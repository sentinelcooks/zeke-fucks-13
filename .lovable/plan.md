

## Plan: Rebuild onboarding into 5-screen high-conversion flow + paywall polish

### Scope
Full rewrite of `src/pages/OnboardingPage.tsx` to match the spec'd 5-screen + Welcome flow. Light tweaks to `PaywallPage.tsx` to add the missing weekly-trial pill and testimonials list. No backend, DB, or auth changes — onboarding remains pre-auth and persists answers to localStorage (already wired in `saveOnboardingData`).

### Screen-by-screen build (`OnboardingPage.tsx`)

**Screen 1 — Welcome (no progress bar)**
- Centered Sentinel lock logo with pulsing purple glow (CSS keyframe).
- "Sentinel" headline 40px bold + tagline.
- 4 feature pills, vertical, fade-in stagger: Smart Props, Daily High-EV Picks, Profit Tracker + Slip Builder, Live Game Schedules.
- Primary CTA "Get Started" (purple gradient + glow).
- "Already have an account? Sign in" → `/auth`.

**Screen 2 — The Edge / FOMO (Step 1 of 5)**
- Headline "Stop guessing. Start winning."
- Two stacked comparison cards:
  - Red card: "GOING WITH YOUR GUT" −$1,340 / −67% ROI, animated red downward sparkline (inline SVG `<polyline>` with `pathLength` stroke-dashoffset reveal).
  - Green card (glow border): "USING SENTINEL" +$2,847 / +142% ROI, green upward sparkline.
- Microcopy "Hypothetical · Based on +EV strategy".
- CTA "Show me the edge →".

**Screen 3 — Odds Format (Step 2 of 5)** 🎲
- Two side-by-side cards: AMERICAN (-110/+150) and DECIMAL (1.91/2.50).
- Auto-advance 400ms after tap. Persist to local state (key `oddsFormat`). Already wired into profile save downstream.

**Screen 4 — Sports (Step 3 of 5)** 🎯
- 2x2 grid (NBA, MLB, UFC, NHL) using existing logo PNGs. Multi-select with bounce checkmark.
- "Other sport" input + Add button (chips below).
- Persistent "Continue" button, disabled until ≥1 selection. Reuses existing `sports` state.

**Screen 5 — Experience Level (Step 4 of 5)** 🎓
- 4 vertical cards: Beginner / Intermediate / Knowledgeable / Expert with icon + subtitle. Auto-advance on tap. Reuses existing `style` state.

**Screen 6 — Personalized Value Proof (Step 5 of 5)** ⚡ NEW
- Headline "Here's what you've been missing".
- Sample pick card mimicking real app (Jokić O10.5 Rebounds):
  - Player avatar (ESPN headshot URL), name, team, position.
  - Glowing green "72% STRONG PICK" badge.
  - Stat row pills: SEASON 12.4 · L10 13.1 · L5 14.2 · vs LAL 13.8.
  - Mini bar chart "Game Log" (10 inline divs).
  - 4 hit-rate progress bars.
  - Line shopping mini-table (4 books, best odds highlighted green).
  - Blurred "In-Depth Analysis" preview with lock overlay.
- CTA "Unlock Sentinel →" (purple gradient, scale-pulse).
- Below CTA: green text "💰 Most users recover their subscription in 1–3 days".
- On click → `navigate("/paywall")`. Preload via dynamic import on Screen 5 mount.

### Shared chrome
- Top progress bar: gradient purple→cyan, fills `(step / 5) * 100%`, hidden on Welcome and after Screen 6.
- Top-left back chevron (hidden on Welcome).
- Top-right subtle "Skip all" link (gray) → jumps to paywall, persists empty answers.
- 300ms ease-out slide transitions (already using framer-motion `AnimatePresence` with x-axis transforms).
- Haptic feedback helper: `if (navigator.vibrate) navigator.vibrate(8)` on every selection tap.

### Paywall tweaks (`PaywallPage.tsx`)
- Add the "7-DAY FREE TRIAL" pill rendering for the **weekly** plan (currently has `trialText` but is dimmed at 70% opacity — restore opacity and ensure pill renders).
- Replace existing 8 reviews with the 6 testimonials from the spec (JM, Big Rob, CJ, J-Money, Dame, Kev) keeping the auto-scroll marquee.
- Trust row: keep "1,200+ 5-Star Ratings" (already present).
- No structural changes — pricing, trial copy, and collapsible features already match spec.

### State & persistence
- Add `oddsFormat: "american" | "decimal"` to onboarding state.
- Extend `saveOnboardingData()` to include `oddsFormat`. The existing post-auth profile sync (already in `AuthContext`) picks up these localStorage keys.

### Files changed
1. `src/pages/OnboardingPage.tsx` — rewrite to 6-screen flow (Welcome + 5 steps).
2. `src/pages/PaywallPage.tsx` — fix weekly trial pill opacity, swap testimonials.

### Out of scope
- Account creation / Supabase profile schema changes (already supports `odds_format`).
- A/B test / analytics drop-off events (mentioned in spec but no tracking pipeline currently wired — can add as follow-up once an analytics destination exists).
- Real ESPN headshot lookup for sample pick — uses static Jokić ESPN URL.

### Verification
1. `/` → splash → `/onboarding` → Welcome shows logo + 4 pills + Get Started.
2. Tap through all 5 steps, confirm progress bar fills, transitions are smooth, auto-advance works on Odds Format & Experience Level, multi-select works on Sports.
3. Sample pick on Screen 6 renders with stats, chart, hit rates, blurred analysis preview.
4. CTA → `/paywall`. Weekly pill visible, testimonials scroll, monthly default selected.
5. Skip-all jumps directly to paywall.
6. localStorage contains `sentinel_onboarding_referral` (defaulted to `Direct`), `sentinel_onboarding_sports`, `sentinel_onboarding_style`, `sentinel_onboarding_odds_format`.

