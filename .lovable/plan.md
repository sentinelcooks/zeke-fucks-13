

## Plan: Paywall contrast, hierarchy & glow polish

Pure visual refactor of `src/pages/PaywallPage.tsx` and `src/components/onboarding/CountdownBanner.tsx`. No logic, pricing, routing, or accordion changes.

### Changes

**1. `PaywallPage.tsx` — color hierarchy**
- Monthly trial pill (line 231–233): swap `bg-[#00FF6A]/20 text-[#00FF6A]` → `bg-[#1F1F1F] text-white`.
- Weekly/Yearly trial pill (line 282–284): same swap, bump text from `[7px]` → `[9px]`.
- Social proof "10,000+" already white ✓ (keep).

**2. `PaywallPage.tsx` — Weekly/Yearly card sizing & spacing**
- Card padding `px-3 py-3.5` → `px-4 py-4 pl-9` (pl-9 to clear top-left radio).
- Label `text-[11px]` → `text-[14px]`.
- Price `text-[20px]` → `text-[24px]`.
- perDay `text-[9px]` → `text-[10px]`.
- Saving text `text-[8px]` → `text-[10px]`, icon `w-2.5 h-2.5` → `w-3 h-3`.
- perMonthText `text-[8px]` → `text-[10px]`.
- Add `space-y-2` rhythm between blocks.

**3. `PaywallPage.tsx` — Monthly hero price emphasis**
- Bump `$39.99` from `text-[28px]` → `text-[34px]`, remove `pr-7` (radio moves left).
- Add struck-through `$59.99` anchor in muted gray above price.

**4. `PaywallPage.tsx` — badge & radio collision fix**
- Yearly `BEST VALUE` badge (line 273–277): move from `right-2` → `left-1/2 -translate-x-1/2`, change to `bg-[#1F1F1F] text-[#00FF6A]` (smaller, less aggressive). Match MOST POPULAR centered position.
- Weekly/Yearly radio indicator: move from `top-3 right-3` → `top-2 left-2`.
- Monthly radio: move from `top-3.5 right-3` → `top-3 left-3`, adjust card to `pl-10`.

**5. `PaywallPage.tsx` — value-tiered glow**
- Monthly selected: stronger pulsing glow via new `card-pulse` keyframe (added to the existing inline `<style>` block at line 182).
- Yearly selected: medium green glow via inline `style.boxShadow`.
- Weekly: neutral border only, no glow.

**6. `CountdownBanner.tsx` — breathing room**
- Outer container: `gap-3` (already ✓), padding stays `px-4 py-3` ✓.
- Add `whitespace-nowrap` to "LIMITED TIME" and "7 Day Free Trial" lines so they never wrap into the icon.
- Bump tag icon container from `w-8 h-8` → `w-9 h-9` for visual weight balance.

### Out of scope
Pricing values, routing, features accordion, sticky footer CTA, sparklines, ESPN avatars, sport icons, sport tab logic.

### Verification
Visual check at `/paywall` on mobile viewport: green appears only on selected price + savings + CTA; trial pills are neutral; BEST VALUE centered with no radio overlap; Monthly price visibly larger and pulsing; Weekly/Yearly cards breathe; countdown banner reads cleanly with no cramping.

