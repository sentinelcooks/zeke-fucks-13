

## Plan: Rework "Add to Parlay" as Bottom Sheet Experience

### Overview
Create a reusable `AddToSlipSheet` bottom sheet component. Instead of immediately adding to the slip, tapping "Add to Parlay" or "+ Add to Slip" opens a styled bottom sheet where the user confirms the pick, enters a stake, and sees a live payout calculation.

### New Component: `src/components/AddToSlipSheet.tsx`

A Drawer-based bottom sheet that receives pick details and renders:
- **Handle bar** at top (existing Drawer pattern)
- **Player name + prop + direction + line + odds** summary
- **Stake input** with `$` prefix, numeric, live payout = stake × decimal odds
- **"Add to Slip" confirm button** with `linear-gradient(135deg, #7c6ff7, #22d3ee)`
- **"Cancel" ghost button** below
- Background `#111327`, border-radius `20px 20px 0 0`
- On confirm: calls `addLeg()` from `ParlaySlipContext`, closes sheet, shows toast

### Changes to `src/pages/NbaPropsPage.tsx` (~line 1789-1833)
- Instead of directly calling `globalSlip.addLeg(...)`, set state to open the sheet with pick details
- Render `<AddToSlipSheet>` at the bottom of the component
- Keep the "REMOVE FROM PARLAY" inline behavior (no sheet needed for removal)

### Changes to `src/components/home/ModernHomeLayout.tsx` (~line 708-729)
- Instead of directly calling `addLeg(...)` and navigating, open the same sheet
- Remove the immediate `navigate("/dashboard/parlay")` — user stays on current page after adding

### Technical Details
- Uses existing `vaul` Drawer primitive (already in project)
- Custom styling via inline styles for `#111327` background and `20px` radius
- Payout calculation: `americanToDecimal(odds) × stake` using existing `americanToDecimal` util
- Sheet state: `{ open, player, propType, line, overUnder, odds, sport, opponent, confidence }`

### Scope
- 1 new file: `src/components/AddToSlipSheet.tsx`
- 2 edited files: `NbaPropsPage.tsx`, `ModernHomeLayout.tsx`
- No database or backend changes

