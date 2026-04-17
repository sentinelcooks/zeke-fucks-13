
## Paywall Refactor Plan

Single-file refactor of `src/pages/PaywallPage.tsx`. No new dependencies.

### 1. Header
- Replace H1 → **"Start Winning With Data"**
- Replace subtext → **"AI-powered props. Real edge. Proven results."**
- Reduce `mt-6` → `mt-4` (~15% tighter above cards)

### 2. Trial Pill (replaces CountdownBanner)
- Remove `CountdownBanner` import + usage
- Inline centered pill directly under header:
  `7-Day Free Trial • No charge today` — small rounded-full pill, green text on subtle green bg, not full-width

### 3. Move social proof up
- Relocate the avatar + "10,000+ bettors using our AI daily" row to **directly under the trial pill**, before pricing cards
- Slightly bolder font weight

### 4. Monthly card (primary)
- Scale wrapper to ~1.04x (since already full-width; emphasize via padding + glow), increase `py-4` → `py-6`, padding +20%
- Border radius: `rounded-2xl` → `rounded-[20px]`
- Keep green border + soft shadow (tone glow down ~25%)
- Shrink "MOST POPULAR" badge text/padding by ~20%
- Remove inner `7-DAY FREE TRIAL` chip
- Remove `$59.99` strikethrough
- Price: `$39.99` with `/month` suffix smaller; subtext **"$1.33/day"**
- Add value stack:
  - ✔ Full AI prop access
  - ✔ Daily top-rated plays
  - ✔ Real-time updates
- Replace saving line with **"Save 60% vs Weekly"**

### 5. Yearly card (secondary)
- Remove green glow box-shadow entirely; subtle `border-[#2A2A2A]` only (green border only on selection)
- Slightly smaller scale than monthly (already is in 2-col grid)
- Badge: `BEST VALUE` → **"Best Long-Term Value"** (neutral styling, no green border)
- Remove inner trial chip
- Price `$219/year`, subtext **"$18.25/month"**
- Add lines: **"2 months free"** and **"Save $260 vs weekly"**

### 6. Weekly card (anchor)
- Reduce visual brightness: text `text-white/70`, no glow, no badge
- Remove inner trial chip
- Remove `$1.43/day` perDay; replace subtext with **"Good for trying it out"**

### 7. Features accordion
- Already collapsed by default ✓
- Reduce button padding `py-3` → `py-2.5` (~15% shorter)
- Add inline 2–3 bullet preview (small muted text) under label when collapsed:
  - Live odds tracking · Top EV plays · Instant updates (only on first feature per spec; apply per-feature short bullets)

### 8. CTA
- Increase height `py-4` → `py-[18px]` (~10% taller)
- Reduce glow shadow opacity from 0.4 → 0.25; soften pulse keyframes
- Dynamic label:
  - weekly → "Start Free Trial"
  - monthly → "Start Monthly Trial"
  - yearly → "Start Yearly Trial"
- Replace subtext with **"No charge today • Cancel anytime"**

### 9. Remove "Maybe later"
- Delete the `handleSkip` button + paragraph entirely (keep function unused or remove)

### 10. Data model
Update `PLANS` array:
- Drop `trialText`, drop unused `perMonthText`
- Repurpose `perDay` as flexible subtext line per card
- Keep `saving` semantics but values updated per spec

### Visual hierarchy result
Monthly (large, glowing, value stack) → CTA → Yearly (subtle) → Weekly (dimmed) → Features → Trust row.

### Files touched
- `src/pages/PaywallPage.tsx` (only)
