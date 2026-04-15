

## Plan: Fix Logo Spacing & Soccer Text Wrapping

### Changes in `src/pages/OnboardingPage.tsx`

**1. Logo too close to dynamic island (hero step)**
The hero content area has no extra top padding, so the logo sits right under the safe area. Add `pt-4` to the hero `motion.div` (line 444) to push the logo down from the progress bar / dynamic island area.

**2. Soccer text wrapping**
The sport tiles use `w-11 h-11` for the logo container and `w-10 h-10` for the image inside. In a 2-column grid, this leaves too little room for the label "Soccer", causing it to wrap. Fix by:
- Reducing sport logo container from `w-11 h-11` to `w-9 h-9` (line 152)
- Reducing sport logo image from `w-10 h-10` to `w-8 h-8` (line 155)
- Adding `whitespace-nowrap` to the label text (line 163) to prevent wrapping

### Files Modified
- `src/pages/OnboardingPage.tsx` — 3 small edits

