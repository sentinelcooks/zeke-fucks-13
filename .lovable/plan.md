

## Plan: Show HOME/AWAY Labels Based on Real Scheduled Game

### Root cause
The backend (`moneyline-api/index.ts`) never resolves which team is hosting tonight. `team1`/`team2` are just whatever the user typed — no `is_home` flag is attached, so the frontend has no way to label them. ESPN's scoreboard (already fetched via `getScoreboard`) is the source of truth: each event's `competitions[0].competitors[*].homeAway` reliably says "home" or "away".

### Backend change — `supabase/functions/moneyline-api/index.ts` (analyze handler, ~line 1043)

Add ONE helper that, given `team1.id` and `team2.id`, scans the next 3 days of ESPN scoreboard events for the requested sport and finds a competition containing both team IDs. If found, return `{ team1IsHome: boolean, gameDate: string }`. If not found → return `null` (no labels shown — per requirement, never guess).

```ts
async function resolveMatchupVenue(team1Id: string, team2Id: string, sport: string) {
  const base = getEspnBase(sport);
  const t1 = String(team1Id), t2 = String(team2Id);
  for (let d = 0; d < 3; d++) {
    const date = new Date(); date.setDate(date.getDate() + d);
    const ymd = date.toISOString().slice(0,10).replace(/-/g, "");
    const data = await fetchJSON(`${base}/scoreboard?dates=${ymd}`).catch(() => null);
    for (const ev of data?.events || []) {
      const comp = ev?.competitions?.[0]; if (!comp) continue;
      const ids = (comp.competitors || []).map((c: any) => String(c.id || c.team?.id));
      if (ids.includes(t1) && ids.includes(t2)) {
        const home = comp.competitors.find((c: any) => c.homeAway === "home");
        const homeId = String(home?.id || home?.team?.id);
        return { team1IsHome: homeId === t1, gameDate: ev.date };
      }
    }
  }
  return null;
}
```

Call it once in the analyze handler (right after `team1`/`team2` are resolved at line 1041), and surface on the response in BOTH success branches (generic, MLB delegate, NHL delegate) by adding to the team objects:

```ts
const venue = await resolveMatchupVenue(team1.id, team2.id, sport);
const team1HomeAway = venue ? (venue.team1IsHome ? "home" : "away") : null;
const team2HomeAway = venue ? (venue.team1IsHome ? "away" : "home") : null;
// ...
team1: { ...team1, stats: team1Stats, homeAway: team1HomeAway },
team2: { ...team2, stats: team2Stats, homeAway: team2HomeAway },
matchup: { gameDate: venue?.gameDate || null, confirmed: !!venue },
```

This is sport-agnostic — works for NBA/MLB/NHL/NFL/NCAAB since `getEspnBase(sport)` already maps all five.

No DB changes. No changes to model/scoring logic, splits computation, or B2B logic — only metadata.

### Frontend change — `src/components/MoneyLineSection.tsx`

Define a small `<HomeAwayBadge>` helper:
```tsx
const HomeAwayBadge = ({ value }: { value: "home" | "away" | null }) => {
  if (!value) return null;
  const isHome = value === "home";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${isHome ? "bg-nba-green/15 text-nba-green" : "bg-nba-blue/15 text-nba-blue"}`}>
      {isHome ? <Home className="w-2 h-2" /> : <Plane className="w-2 h-2" />}
      {value}
    </span>
  );
};
```

**1. Matchup Hero Card (line 1606-1629)** — add badge under each team's record:
```tsx
<span className="text-[10px] text-muted-foreground/65">{results.team1?.record}</span>
<HomeAwayBadge value={results.team1?.homeAway} />
```
(same for team2)

**2. Home/Away Splits card (line 1800-1805)** — add badge next to the team name in the row header:
```tsx
<span className="text-xs font-bold text-foreground">{team.shortName}</span>
<HomeAwayBadge value={team.homeAway} />
```

That's it. When `homeAway` is `null` (no scheduled game found), the badge silently renders nothing — exactly per the "never guess" requirement.

### Verification (mandatory, will run in default mode)

1. `supabase--deploy_edge_functions ["moneyline-api"]`
2. `supabase--curl_edge_functions` POST `/moneyline-api/analyze` for an NBA matchup scheduled today (e.g. Hornets vs Magic) → confirm response contains `team1.homeAway` and `team2.homeAway` with the correct "home"/"away" values cross-checked against ESPN.
3. Repeat for MLB, NHL matchups → confirm same field present and correct.
4. Test a non-scheduled matchup (two teams not playing each other tonight) → confirm `homeAway: null` on both teams.
5. Paste curl output slices in completion summary.

### Out of scope
- No DB/schema changes
- No changes to splits math, B2B math, or model scoring
- No changes to other tabs (Props, Slip, Games)
- No fallback "guess" logic — strictly null when ESPN doesn't confirm

