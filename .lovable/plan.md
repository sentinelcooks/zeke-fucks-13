

## Goal
Replace the locked "Advanced Analytics / Unlock Premium" footer on Screen 1 with a compact **AI Analysis preview** tailored to the Luka OVER 32.5 Points pick (mirrors the in-app Written Analysis style from screenshot 2).

## Change — single file: `src/pages/OnboardingPage.tsx`

Remove lines 287–292 (the locked footer) and insert a new "AI Analysis Preview" block in its place, still inside the same card. Keep the card, header, headshot, stats row, and CTA untouched.

### New block content (Luka-tailored, concise)

Header pill: green "IN-DEPTH ANALYSIS" tag (matches inspo).

Three labeled mini-sections, each = colored icon + label + 2 short sentences:

1. **STATISTICAL EDGE** (blue, BarChart icon)  
   "Luka is averaging 34.1 PPG over his last 10 games, comfortably above the 32.5 line. Per-36 projection of 35.8 reinforces the over."

2. **MATCHUP & PACE** (green, Swords icon)  
   "Denver allows the 6th-most points to opposing guards. Projected pace of 101.4 favors volume scoring."

3. **VERDICT & RISK** (purple/accent, TrendingUp icon)  
   "Strong lean OVER 32.5. Wager 1.5 units with 64% model confidence. Key risk: early blowout limiting minutes."

Bottom verdict box (mirrors "TAKE THIS PICK" panel from inspo):
- Green check + bold "TAKE THIS PICK" + small "OVERALL VERDICT — ALL FACTORS COMBINED"
- 1-line summary: "Strong play. Luka OVER 32.5 Points checks the boxes. L10 avg 34.1, +EV 7.2%. Recommended sizing: 1.5–2 units."
- Footer line: "AI CONFIDENCE: 64%   POWERED BY SENTINEL AI"

### Visual spec (match existing onboarding palette, not the in-app dark teal)
- Use existing `#00FF6A` neon green for accents/checks (consistent with rest of onboarding screen).
- Section labels: tiny uppercase tracking-wider; colors: blue `text-[#3B82F6]`, green `text-[#00FF6A]`, accent purple `text-[#A78BFA]`.
- Body text: `text-[10px] text-white/70 leading-snug`.
- Verdict box: subtle green tint background `bg-[#00FF6A]/8` with `border-[#00FF6A]/25` rounded-lg, padding 2.5.
- Whole preview block sits inside the existing card; tighten spacing so total card height grows by ~140px max (still fits 1-screen mobile).

### Imports to add
`Sword as Swords` (already may exist), `BarChart3`, `TrendingUp`, `CheckCircle2` from `lucide-react` (Brain/BarChart3 already imported on this page).

## Out of scope
- No logic changes, no data fetch, no other onboarding screens, no in-app `WrittenAnalysis.tsx` edits.
- Hardcoded preview content only — this is a marketing illustration, not a live AI call.

## Files touched
1. `src/pages/OnboardingPage.tsx` — replace lines 287–292 with the new AI Analysis preview block.

