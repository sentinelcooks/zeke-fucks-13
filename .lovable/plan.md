

## Plan: Rename `/dashboard/nba` Route to `/dashboard/analyze`

### Problem
The URL shows `/dashboard/nba` even when you're viewing MLB, NHL, or UFC props — confusing since that route hosts all sports, not just NBA.

### Changes

Rename the route path from `nba` to `analyze` across all references:

**`src/App.tsx`** — Change `<Route path="nba" ...>` to `<Route path="analyze" ...>`

**`src/pages/DashboardLayout.tsx`** — Update route title key from `/dashboard/nba` to `/dashboard/analyze`

**`src/components/mobile/BottomTabBar.tsx`** — Update tab path and parent-mapping entries

**`src/components/home/ModernHomeLayout.tsx`** — Update quick link path

**`src/pages/HomePage.tsx`** — Update quick link path

**`src/pages/FreePicksPage.tsx`** — Update navigation call

**`src/pages/ProfitTrackerPage.tsx`** — Update fallback route in re-analyze logic

**`src/components/AppSidebar.tsx`** — Update sidebar link URL

All changes are simple string replacements of `/dashboard/nba` → `/dashboard/analyze`. No backend or functionality changes.

