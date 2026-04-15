

## Plan: Fix Game Log Date Display to Show Full MM/DD/YYYY

### Problem
The game log table DATE column shows only partial dates (e.g., `/2025`) because `g.date?.slice(5)` doesn't handle all ESPN date formats correctly. ESPN's `gameDate` field can vary in format.

### Solution
Replace `g.date?.slice(5)` with a robust date formatter that always shows `MM/DD/YY` (compact for the table). Create a small helper function and apply it in all three files.

### Helper (inline in each file or shared)
```ts
function fmtDate(raw: string) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}
```

### Changes

**`src/pages/NbaPropsPage.tsx`**
- Line 314: Replace `g.date?.slice(5)` → `fmtDate(g.date)`
- Line 222-223 (chart labels): Also use the formatter for consistency

**`src/pages/FreePropsPage.tsx`**
- Line 138: Replace `g.date?.slice(5)` → `fmtDate(g.date)`

**`src/components/ResultsPanel.tsx`**
- Line 165: Replace `{g.date}` → `{fmtDate(g.date)}`
- Line 89 (chart labels): Also format

### Scope
- 3 frontend files, no backend changes

