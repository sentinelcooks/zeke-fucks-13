

## Plan: Fix Wrong Team Resolution + Percentage Layout

### Bug 1: Wrong Team (Kings instead of Spurs)

**Root cause:** `resolveTeam()` in `moneyline-api/index.ts` (line 339) checks `t.name.toLowerCase().includes(q)` first. When the Spurs abbreviation `"SA"` is passed, `"sacramento kings".includes("sa")` matches **before** `"san antonio spurs"` because Sacramento appears earlier in ESPN's team list. The exact abbreviation check (`t.abbr.toLowerCase() === q`) runs last due to the `||` short-circuit.

**Fix in `supabase/functions/moneyline-api/index.ts`** — Rewrite `resolveTeam` to prioritize exact abbreviation matches:

```typescript
function resolveTeam(teams: any[], input: string) {
  const q = input.toLowerCase().trim();
  // 1. Exact abbreviation match first
  const exactAbbr = teams.find((t: any) => t.abbr.toLowerCase() === q);
  if (exactAbbr) return exactAbbr;
  // 2. Exact name/shortName match
  const exactName = teams.find((t: any) => 
    t.name.toLowerCase() === q || t.shortName.toLowerCase() === q
  );
  if (exactName) return exactName;
  // 3. Fuzzy includes match (fallback)
  return teams.find((t: any) =>
    t.name.toLowerCase().includes(q) ||
    t.shortName.toLowerCase().includes(q)
  );
}
```

### Bug 2: "%" Wrapping Below the Number

**Root cause:** In the matchup hero card (line 1608), `{results.team1_pct}%` is rendered with `text-2xl font-black`. On a 390px screen, the middle column is 40% width (~156px). With two large numbers, the Swords icon, and flex gap, text can wrap.

**Fix in `src/components/MoneyLineSection.tsx`** (line 1607-1611) — Add `whitespace-nowrap` to the percentage spans:

```tsx
<span className="text-2xl font-black text-nba-green whitespace-nowrap">{results.team1_pct}<span className="text-base">%</span></span>
<Swords className="w-4 h-4 text-muted-foreground/55" />
<span className="text-2xl font-black text-nba-red whitespace-nowrap">{results.team2_pct}<span className="text-base">%</span></span>
```

### Scope
- `supabase/functions/moneyline-api/index.ts` — Fix team resolution priority
- `src/components/MoneyLineSection.tsx` — Fix percentage layout wrapping

