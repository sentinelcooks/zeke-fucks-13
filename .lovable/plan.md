
## Plan: Replace AI-generated images with reliable CDN sources

### Scope
Onboarding avatars/icons are blank because WaveSpeed calls aren't returning usable images for small assets. Switch all small assets (player headshots, team logos, social proof, testimonial, sport icons) to ESPN CDN / pravatar / inline SVGs. Reserve WaveSpeed for Screen 6 stadium background only.

### Changes

**1. `src/pages/OnboardingPage.tsx`**
- Add constants:
  - `ESPN_HEADSHOTS` (Luka, Tatum, Matthews) and `ESPN_TEAM_LOGOS` (Rockies)
  - `SCREEN2_PICKS` data array with `img` field per pick
  - `SPORT_ICONS` map of inline SVG components keyed by sport id (nba/mlb/nhl/ufc), each accepting a color prop
- Screen 1: replace Luka `<WaveImage>` with `<img>` using ESPN headshot, 44px circular, `onError` hides
- Screen 2:
  - Replace 3 pick rows with mapped `SCREEN2_PICKS` using `<img>` tags (ESPN headshots + Rockies logo)
  - Replace 3 social proof `<WaveImage>` with `pravatar.cc` `<img>` tags (img=11/12/13), `-space-x-2` overlap
- Screen 3: replace 4 sport `<WaveImage>` tiles with inline `SPORT_ICONS[s.id](iconColor)` — green `#00FF6A` when selected, gray `#666666` otherwise
- Screen 4: replace Mike R. `<WaveImage>` with pravatar `<img>` (img=11)
- Reduce `ASSETS` to just `stadiumBg` (keep KREA model constant); preload only that
- Remove unused imports: `WaveImage`, `WaveModel`, NANO/FAST constants, individual avatar/icon ASSET entries

**2. `src/pages/WelcomeConfirmationPage.tsx`** — no changes (already uses `WaveImage` with KREA model and graceful fallback for stadium bg)

**3. `supabase/functions/generate-image/index.ts`** — already correctly reads `WAVESPEED_API_KEY`, accepts `{ prompt, model }`, hits `https://api.wavespeed.ai/api/v3/${model}`, polls. No changes needed; will verify via curl after edits.

### Verification
1. Reload `/onboarding` Screen 1 → Luka headshot visible in pick card
2. Continue → Screen 2 → Tatum, Matthews headshots + Rockies logo visible; 3 overlapping social-proof avatars from pravatar render
3. Continue → Screen 3 → 4 sport tiles show clean inline SVG icons; tapping turns icon + label green with checkmark
4. Continue → Screen 4 → Mike R. pravatar shows in testimonial
5. Continue → `/paywall` → unchanged
6. Tap Start Free Trial → `/welcome` → stadium bg loads via WaveSpeed (or dark gradient fallback)
7. Run `tsc --noEmit` to confirm no unused-import / type errors
8. `curl` the generate-image edge function with a test prompt + KREA model to confirm it returns an `imageUrl`

### Out of scope
- Changes to WaveImage component, edge function, or WelcomeConfirmationPage
- Replacing pravatar with project-hosted avatars
- Real player/team data wiring (these are static onboarding mockups)
