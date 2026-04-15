

## Plan: Fix "Where'd You Find Us" (Referral) Page Viewport Fit

### Problem
The referral step has 7 option tiles plus header, and the page scrolls on smaller devices because the outer container uses `min-h-[100dvh]` with `flex-1` centering — it doesn't constrain content to the viewport.

### Changes

**`src/pages/OnboardingPage.tsx`**

1. **Outer container** (line 390): Change `min-h-[100dvh]` to `h-[100dvh]` so the page is locked to viewport height, not allowed to exceed it.

2. **Content area** (line 436): Change `flex-1 flex items-center justify-center` to `flex-1 flex items-center justify-center overflow-y-auto min-h-0` — this allows scrolling only within the content area if absolutely needed on very small screens, while keeping the CTA pinned.

3. **Referral section tiles** (line 555): Reduce gap from `space-y-2` to `space-y-1.5`.

4. **Tile component padding** (line 147): Reduce padding from `px-4 py-3.5` to `px-3.5 py-2.5` to compress each card.

5. **Header bottom margin** (line 175): For the referral step specifically, reduce `mb-8` to `mb-5` on the Header component. Since Header is shared, we'll add a `compact` prop or just reduce globally to `mb-6`.

These changes ensure:
- Progress bar stays pinned at top
- Continue button stays visible at bottom without scrolling
- 7 referral tiles + header fit within the remaining space
- Works on screens as small as 320px wide / 568px tall

### Technical Details
- The outer `h-[100dvh]` prevents the page from growing beyond the viewport
- `min-h-0` on the flex child is critical for flex + overflow to work correctly
- Tile padding reduction: 14px → 10px vertical, gap 8px → 6px
- Header margin reduction keeps the content vertically compact

