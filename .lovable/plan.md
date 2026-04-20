

## Performance Optimization Pass — No UI/Logic Changes

Goal: Reduce initial bundle size, defer heavy code, and trim re-renders. Zero changes to UI, copy, queries, edge functions, or auth.

## What's slow today

- `src/App.tsx` eagerly imports **every dashboard page** (NbaProps, Ufc, Parlay, ProfitTracker, MoneyLine, FreePicks, FreeProps, Home, Games, Settings, Arbitrage, Legal, Landing, NotFound). All of these — plus their heavy deps (chart.js, recharts, react-chartjs-2, embla, html-to-image, react-day-picker) — land in the initial bundle even on `/` (LandingPage).
- `LandingPage` (the entry route) ships everything above it needs nothing of.
- Only Auth/Admin/Onboarding/Paywall/WelcomeConfirmation are currently lazy.
- `vite.config.ts` has no `build.rollupOptions.output.manualChunks`, so vendor libs (framer-motion, recharts, chart.js, radix-ui set, supabase, react-query) are not split — one giant vendor chunk.
- No `cssCodeSplit` tuning, no `chunkSizeWarningLimit`, no terser drop_console.

## Plan (frontend-only, behavior-preserving)

### 1. Lazy-load every route in `src/App.tsx`
Convert the eager imports to `React.lazy`:
- `LandingPage`, `DashboardLayout`, `HomePage`, `NbaPropsPage`, `UfcPage`, `ParlayPage`, `ProfitTrackerPage`, `MoneyLinePage`, `FreePicksPage`, `FreePropsPage`, `GamesPage`, `SettingsPage`, `ArbitragePage`, `LegalPage`, `NotFound`
- Wrap `<Routes>` in a single `<Suspense fallback={<LoadingSpinner/>}>` instead of per-route Suspense boilerplate (same visual fallback that already exists)
- Keep already-lazy ones as-is

Result: `/` only downloads LandingPage + shared chunks. Each dashboard tab loads on demand.

### 2. Vite `manualChunks` split in `vite.config.ts`
Add `build.rollupOptions.output.manualChunks` to break the vendor blob into cacheable groups:
- `react-vendor`: react, react-dom, react-router-dom
- `radix-vendor`: all `@radix-ui/*`
- `charts-vendor`: recharts, chart.js, react-chartjs-2
- `motion-vendor`: framer-motion
- `supabase-vendor`: @supabase/supabase-js, @lovable.dev/cloud-auth-js
- `query-vendor`: @tanstack/react-query
- `utils-vendor`: date-fns, clsx, tailwind-merge, class-variance-authority, zod
- `image-vendor`: html-to-image
- Everything else stays in default chunks

Also set:
- `build.cssCodeSplit: true` (default but explicit)
- `build.chunkSizeWarningLimit: 800`
- `build.target: 'es2020'` for smaller transpile output
- Keep `minify: true` (esbuild default — already minifying JS + CSS)

### 3. Tune `QueryClient` defaults (perf only, no behavior change for existing queries that pass their own options)
In `App.tsx`:
```
new QueryClient({ defaultOptions: { queries: {
  refetchOnWindowFocus: false,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  retry: 1,
}}})
```
This reduces unnecessary refetches on tab focus across the app. Existing queries that override these keep their behavior.

### 4. Memoize hot leaf components (no UI change)
Wrap render-heavy, prop-stable presentational components in `React.memo`:
- `src/components/mobile/BottomTabBar.tsx`
- `src/components/mobile/MobileHeader.tsx`
- `src/components/AppFooter.tsx`
- `src/components/mobile/StatPill.tsx`, `HitRateRing.tsx`, `VerdictBadge.tsx`, `InjuryStatusBadge.tsx`
- `src/components/NavLink.tsx`

These render on nearly every route change and don't depend on changing parent state.

### 5. `useCallback` / `useMemo` in `DashboardLayout.tsx`
The visibility-change scroll snapshot handler and the `routeTitles` lookup can be memoized. `routeTitles` lifted to module scope already; only add `useCallback` for the visibility handler so the `useEffect` doesn't recreate it.

### 6. Image lazy-loading sweep
Add `loading="lazy"` and `decoding="async"` to `<img>` tags that aren't above-the-fold:
- All sportsbook logos in `OddsComparison.tsx`, `MoneyLineSection.tsx`, `ResultsPanel.tsx`
- Team logos wherever rendered in lists (`GamesPage`, `FreePicksPage`, `FreePropsPage`, `MoneyLinePage`)
- Player headshots in `PlayerCard.tsx`, `mobile/*`
- Skip the splash logo and onboarding hero (above the fold / animated)

### 7. Defer non-critical work
- `RateAppDialog` import in `DashboardLayout.tsx` → `lazy()` and only mount the lazy chunk when `showRate` is true
- `PnLCalendar`, `ProfitCharts`, `ShareProfitCard` in ProfitTrackerPage → `React.lazy` with Suspense fallback (charts are huge)
- `ShotChart` in NBA props detail → `React.lazy`

### 8. Dead-import sweep
Run a pass through `src/pages/**` and `src/components/**` removing unused imports flagged by tsc/eslint. Remove leftover commented imports in `App.tsx`. No symbol behavior changes, only import-line removals.

### 9. Audit `console.log` in production build
Add `esbuild: { drop: ['console', 'debugger'] }` in `vite.config.ts` so production builds strip logs. (Dev mode unaffected.)

## Out of scope (explicitly NOT touching)

- Any Supabase query, RLS, edge function, auth flow, or RevenueCat call
- Any visible UI: colors, copy, layout, spacing, animations, components' JSX structure
- Any feature behavior or routing destinations
- `src/integrations/supabase/*` (auto-generated)
- Backend / SQL

## Files touched

- `src/App.tsx` — lazify all routes, single Suspense boundary, QueryClient defaults
- `src/pages/DashboardLayout.tsx` — lazy `RateAppDialog`, memoize handler
- `vite.config.ts` — manualChunks, esbuild drop console, target, chunk size limit
- `src/components/mobile/{BottomTabBar,MobileHeader,StatPill,HitRateRing,VerdictBadge,InjuryStatusBadge,PlayerCard}.tsx` — `React.memo`
- `src/components/{AppFooter,NavLink}.tsx` — `React.memo`
- `src/pages/ProfitTrackerPage.tsx` — lazy `PnLCalendar`, `ProfitCharts`, `ShareProfitCard`
- `src/components/OddsComparison.tsx`, `MoneyLineSection.tsx`, `ResultsPanel.tsx`, `mobile/PlayerCard.tsx`, list pages — add `loading="lazy" decoding="async"` to non-hero `<img>` tags
- Targeted unused-import removals across pages/components

## Verification (after switch to default mode)

1. `npm run build` → record before/after total `dist/assets/*.js` size and main entry chunk size, paste sizes in summary
2. Confirm route-level chunks exist in `dist/assets/` (one per lazy page)
3. Open `/` and `/dashboard/home` in the preview, confirm UI is visually identical and tabs still navigate
4. Confirm no new console errors in `code--read_console_logs`
5. Sanity-check that no Supabase/edge function file under `supabase/` was modified

