// ─────────────────────────────────────────────────────────────
// Shared Injury Data Module — Single Source of Truth
// Used by: moneyline-api, mlb-model, nhl-model, nba-api
// Fetches league-wide injuries from ESPN ONCE per analyze invocation,
// normalizes statuses, returns identical data shape to all callers.
// ─────────────────────────────────────────────────────────────

export type NormalizedStatus = "out" | "doubtful" | "questionable" | "day-to-day" | "probable";

export interface NormalizedInjury {
  name: string;          // canonical display name
  player_name: string;   // alias for nba-api callers
  position: string;
  status: NormalizedStatus;
  rawStatus: string;     // original ESPN string (debug)
  detail: string;
  source: "espn-league-injuries";
  fetchedAt: string;
}

export interface InjuryReport {
  team1: NormalizedInjury[];
  team2: NormalizedInjury[];
  fetchedAt: string;
  source: "espn-league-injuries";
}

const ESPN_BASES: Record<string, string> = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba",
  ncaab: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball",
  mlb: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb",
  nhl: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl",
};

// Normalize ESPN status strings into a strict enum.
// Returns null if the status isn't a confirmed injury status (→ player treated as available).
export function normalizeStatus(raw: string | undefined | null): NormalizedStatus | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim().replace(/\s+/g, "-");

  // Out variants
  if (
    s === "out" ||
    s.includes("injured-list") || s.includes("injured-reserve") ||
    s === "ir" || s === "il" || s === "10-day-il" || s === "15-day-il" || s === "60-day-il" ||
    s.includes("suspended")
  ) return "out";

  // Doubtful
  if (s === "doubtful") return "doubtful";

  // Questionable
  if (s === "questionable" || s === "gtd" || s === "game-time-decision") return "questionable";

  // Day-to-day
  if (s === "day-to-day" || s === "dtd") return "day-to-day";

  // Probable
  if (s === "probable") return "probable";

  return null;
}

// Fetches league-wide injury data ONCE per call. NO module-level cache.
async function fetchLeagueInjuries(sport: string): Promise<any[]> {
  const base = ESPN_BASES[sport] || ESPN_BASES.nba;
  try {
    const resp = await fetch(`${base}/injuries`, {
      headers: { "User-Agent": "PrimalAnalytics/1.0" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data?.injuries || [];
  } catch {
    return [];
  }
}

function normalizeTeamInjuries(
  teamEntry: any,
  fetchedAt: string,
): NormalizedInjury[] {
  const items = teamEntry?.injuries || [];
  const seen = new Set<string>();
  const out: NormalizedInjury[] = [];
  for (const inj of items) {
    const athlete = inj.athlete || {};
    const name: string = athlete.displayName || "";
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const normalized = normalizeStatus(inj.status);
    if (!normalized) continue; // default to available — never guess
    seen.add(key);
    out.push({
      name,
      player_name: name,
      position: athlete.position?.abbreviation || "",
      status: normalized,
      rawStatus: String(inj.status || ""),
      detail: inj.longComment || inj.shortComment || inj.type?.description || "",
      source: "espn-league-injuries",
      fetchedAt,
    });
  }
  return out;
}

function matchTeamEntry(allTeams: any[], opts: { teamId?: string; teamAbbr?: string; teamName?: string }): any | null {
  const id = opts.teamId ? String(opts.teamId) : "";
  const abbr = (opts.teamAbbr || "").toUpperCase();
  const name = (opts.teamName || "").toLowerCase();
  for (const t of allTeams) {
    if (id && String(t.id || t.team?.id || "") === id) return t;
    const tAbbr = (t.team?.abbreviation || t.abbreviation || "").toUpperCase();
    if (abbr && tAbbr && tAbbr === abbr) return t;
    const tName = (t.displayName || t.team?.displayName || "").toLowerCase();
    if (name && tName && (tName === name || tName.includes(name) || name.includes(tName))) return t;
  }
  return null;
}

// Main entry: fetch ONCE, return normalized injuries for both teams + metadata.
export async function fetchMatchupInjuries(
  sport: string,
  team1: { id?: string; abbr?: string; name?: string },
  team2: { id?: string; abbr?: string; name?: string },
): Promise<InjuryReport> {
  const fetchedAt = new Date().toISOString();
  const allTeams = await fetchLeagueInjuries(sport);
  const t1Entry = matchTeamEntry(allTeams, { teamId: team1.id, teamAbbr: team1.abbr, teamName: team1.name });
  const t2Entry = matchTeamEntry(allTeams, { teamId: team2.id, teamAbbr: team2.abbr, teamName: team2.name });
  return {
    team1: t1Entry ? normalizeTeamInjuries(t1Entry, fetchedAt) : [],
    team2: t2Entry ? normalizeTeamInjuries(t2Entry, fetchedAt) : [],
    fetchedAt,
    source: "espn-league-injuries",
  };
}

// Convenience for single-team callers (nba-api props tab).
export async function fetchTeamInjuries(
  sport: string,
  team: { id?: string; abbr?: string; name?: string },
): Promise<NormalizedInjury[]> {
  const report = await fetchMatchupInjuries(sport, team, {});
  return report.team1;
}
