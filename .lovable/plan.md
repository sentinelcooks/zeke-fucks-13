
## Plan: Paywall contrast, hierarchy & glow polish

Apply the spec across `PaywallPage.tsx` and `CountdownBanner.tsx`. Pure visual changes — no logic, routing, or pricing touched.

### Changes

**1. `PaywallPage.tsx` — color hierarchy**
- Trial pills (Monthly hero + Weekly/Yearly): swap `bg-[#00FF6A]/20 text-[#00FF6A]` → `bg-[#1F1F1F] text-white` so green stops competing with itself.
- Social proof "10,000+" already white — keep, but ensure surrounding text stays muted.
- Unselected card prices: already white ✓. Selected stays `#00FF6A` ✓.
- Yearly `BEST VALUE` badge: change from solid green block to `text-[#00FF6A]` on dark bg, smaller.

**2. `PaywallPage.tsx` — Weekly/Yearly card sizing & spacing**
- Card padding: `px-3 py-3.5` → `px-4 py-4`.
- Label: `text-[11px]` → `text-[14px]`, add `space-y-2` rhythm.
- Trial pill: `text-[7px]` → `text-[9px]`.
- Price: `text-[20px]` → `text-[24px]`.
- perDay: `text-[9px]` → `text-[10px]`.
- Saving: `text-[8px]` → `text-[10px]`.

**3. `PaywallPage.tsx` — Monthly hero price emphasis**
- Bump `$39.99` from `text-[28px]` → `text-[34px]`.
- Add struck-through anchor `$59.99` in muted gray above/beside savings line.

**4. `PaywallPage.tsx` — badge collision fix**
- Move `BEST VALUE` from `right-2` → top-CENTER (`left-1/2 -translate-x-1/2`), matching MOST POPULAR.
- Move radio indicator from `top-3 right-3` → `top-2 left-2`.
- Add `pl-9` to Weekly/Yearly card content to clear the radio.

**5. `PaywallPage.tsx` — value-tiered glow**
- Monthly selected: stronger pulse glow w/ new `card-pulse` keyframe (added to existing `<style>` block).
- Yearly selected: medium glow.
- Weekly: neutral border only.

**6. `CountdownBanner.tsx` — breathing room**
- Increase outer gap: `gap-3`, padding `px-4 py-3` (already there ✓ — verify and bump if needed).
- Add `whitespace-nowrap` to LIMITED TIME / 7-DAY FREE TRIAL lines so they never wrap into the icon.
- Slightly larger tag icon container.

### Out of scope
Pricing values, routing logic, features accordion, sticky footer CTA, sparklines, ESPN avatars, sport icons.

### Verification
- Visual check at `/paywall`: no green trial pills, BEST VALUE centered with no radio overlap, Monthly price visibly larger and pulsing, Weekly/Yearly cards no longer cramped, countdown banner reads cleanly.
