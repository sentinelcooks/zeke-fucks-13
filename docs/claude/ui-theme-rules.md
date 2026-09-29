# UI Theme Rules (Playbook)

Sentinel's front end uses the **Playbook** design: SF Pro (system font), Apple
system colors, an emerald accent, and Light / Dark / System appearance chosen in
Settings → Appearance (`next-themes`, storage key `sentinel-theme`).

Read this before changing any screen or component in `src/`.

## Colors: tokens only

- All colors come from the tokens in `src/index.css`. Light values live on `:root`,
  dark values on `.dark`. Tailwind exposes them (`bg-card`, `text-muted-foreground`,
  `text-success`, `bg-primary/10`, `border-border`, `bg-fill/15`, `bg-pill`, …).
- **Never hardcode hex, `rgb()` or `hsl()` literals** in components, and never use
  Tailwind palette classes (`text-green-500`, `bg-purple-600`). Semantic mapping:
  | Meaning | Token |
  |---|---|
  | Brand / interactive | `primary` (emerald, `155 78% 34%` light / `155 70% 40%` dark) |
  | Hit, win, positive | `success` |
  | Miss, loss, destructive | `danger` / `destructive` |
  | Caution | `warning` (or `nba-yellow` for yellow data states) |
  | Surfaces | `background`, `card`, `secondary`, `fill` (with alpha), `pill` |
  | Text | `foreground`, `muted-foreground` |
  | Outlines | `border`, `hairline` |
- In inline styles use `hsl(var(--token))` or `hsl(var(--token) / 0.2)`.
  Inside a Tailwind arbitrary class, alpha needs underscores:
  `shadow-[0_0_12px_hsl(var(--primary)_/_0.1)]` (spaces split the class).
- To add alpha to a token color held in a variable, use `withAlpha()` from
  `src/lib/themeColor.ts`. Never concatenate hex alpha (`${color}33`) — it only
  works for hex strings.
- Exceptions: team, league and sportsbook brand colors stay as their real hex values.
- `text-white` only on filled brand/semantic backgrounds; prefer
  `text-primary-foreground` / `text-success-foreground`.

## Charts

- Chart.js draws on a canvas, which cannot read CSS variables. Always import
  `ThemedBar` from `src/components/charts/ThemedBar` instead of `Bar` from
  `react-chartjs-2`; it resolves token colors and redraws on theme change.
- SVG and Recharts can use `hsl(var(--token))` directly.

## Playbook controls (`src/components/playbook/`)

| Component | Use for |
|---|---|
| `CircleButton` | Round 44pt icon buttons (back, share, favorite, delete). Always pass `aria-label`. |
| `PillTabs` | Every segmented control, tab strip and filter row (`scroll` for long lists). |
| `StatKV` | Uppercase label over a value, optional ▲/▼ trend. |
| `GradeRing` | Letter grade from a 0–100 score (model score / probability). |
| `HitBars` | Game-by-game bars vs a line (green hit, red miss). |
| `PropAnalysisHero` / `GameLogSheet` | Prop analysis header and per-game sheet. |

Brand mark: `BrandMark` / `BrandGlyph` in `src/components/brand/BrandMark.tsx`.

## Type and layout

- **Minimum text size is 11px** (Apple's Caption 2). Scale in use: 11 / 12 / 13 /
  15 / 17 / 20 / 22 / 28 px.
- Uppercase labels: `text-[11px] font-semibold uppercase tracking-[0.03em]`;
  avoid wide tracking (≥ 0.1em).
- Tap targets at least 44pt. Capsule (`rounded-full`) primary buttons, 44–52pt tall.
- No glows, glow orbs, gradient text, animated gradient borders, or emoji used as
  icons. Cards are flat `bg-card` with a hairline (`vision-card` does this).
- Mobile-first, 320–430px; the bottom tab bar floats, so screens need `pb-28`.

## Labels that are guarded by tests

- Fallback Today's Edge plays must keep the `MODEL SCORE` label
  (`src/test/todays_edge_visibility.test.ts`).
- Model score vs validated probability labelling follows `VerdictBadge`.

## Previewing without signing in

`/dev/playbook` (dev server only, excluded from production builds) renders the
Playbook components with sample data. Append `?theme=light` or `?theme=dark`.
Do not render screens that call production jobs on mount (Today calls
`grade-picks`; Games spends Odds API quota) from preview pages.
