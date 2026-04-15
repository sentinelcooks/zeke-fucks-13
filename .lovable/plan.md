

## Plan: Add MTD Column to VS Opponent Section

### What
Add a "MTD" (Month-to-Date) stat alongside the existing Season/L10/L5/VS columns in both the NbaPropsPage vision UI and ResultsPanel. Filter `game_log` to the current calendar month and compute hit rate + average.

### Changes

**`src/pages/NbaPropsPage.tsx`**
1. Compute `mtd` object from `results.game_log` filtered to current month/year, using the existing `getStatVal` pattern for the active prop type
2. **StatPill row (line ~1840)**: `grid-cols-4` → `grid-cols-5`, add `<StatPill label="MTD" value={mtd.avg ?? "--"} />`
3. **HitRateRing row (line ~1881)**: Add `<HitRateRing ... label="MTD" />` between L5 and VS

**`src/components/ResultsPanel.tsx`**
1. Compute `mtd` the same way from `data.game_log`
2. **Stat Summary grid (line ~231)**: `grid-cols-4` → `grid-cols-5`, add `{ label: "MTD Avg", val: mtd.avg }`
3. **Hit Rate Breakdown grid (line ~252)**: Add `<HitRateBar title="MTD" data={mtd} />` between L5 and Home/Away

### MTD Calculation (shared logic, inline in each file)
```ts
const now = new Date();
const mtdGames = (data.game_log || []).filter((g: any) => {
  const d = new Date(g.date);
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
});
const mtdHits = mtdGames.filter(g => {
  const val = getStatVal(g);
  return data.over_under === "over" ? val > data.line : val < data.line;
}).length;
const mtd = {
  rate: mtdGames.length > 0 ? Math.round((mtdHits / mtdGames.length) * 100) : 0,
  hits: mtdHits, total: mtdGames.length,
  avg: mtdGames.length > 0 ? +(mtdGames.reduce((s, g) => s + getStatVal(g), 0) / mtdGames.length).toFixed(1) : undefined,
};
```

### Scope
- 2 files edited, no backend changes

