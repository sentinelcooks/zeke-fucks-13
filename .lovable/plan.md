

## Plan: Pin Header to the Top of the Viewport

### Problem
The `MobileHeader` is currently inside the scrollable `<main>` element in `DashboardLayout.tsx` with `sticky top-0`. This means it's part of the scroll flow. The user wants it fixed at the absolute top of the screen.

### Changes

**`src/pages/DashboardLayout.tsx`**
- Extract `MobileHeader` out of the `<Outlet />` flow and render it **above** the scrollable `<main>` in the layout, so it's always pinned at the top without being part of the scroll container.
- The header will be rendered conditionally based on a title derived from the current route (using `useLocation`).
- Add top padding to `<main>` to account for the fixed header height (~44px).

**Route-to-title mapping** (in DashboardLayout):
```
/dashboard/home → "Sentinel Dashboard"
/dashboard/games → "Games"
/dashboard/nba → "NBA Props" (or "Analyze")
/dashboard/moneyline → "Lines"
/dashboard/picks → "Picks"
/dashboard/free-props → "Free Props"
/dashboard/tracker → "Tracker"
/dashboard/parlay → "Parlay"
/dashboard/settings → "Settings"
/dashboard/arbitrage → "Arbitrage"
/dashboard/ufc → "UFC"
/dashboard/mlb-predictions → "MLB Predictions"
/dashboard/trends → "Trends"
/dashboard/legal → "Legal"
```

**Individual page files** (NbaPropsPage, GamesPage, SettingsPage, MoneyLinePage, HomePage, etc.)
- Remove the `<MobileHeader />` call from each page since it's now handled at the layout level.

**`src/components/mobile/MobileHeader.tsx`**
- No changes needed to the component itself.

### What Won't Change
- Header appearance and styling stays identical
- Bottom tab bar unaffected
- No backend changes

