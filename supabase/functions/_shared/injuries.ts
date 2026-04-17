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

// ─────────────────────────────────────────────────────────────
// NHL-specific injury adjustments with top-6 F / top-4 D detection.
// Returns { adjustedFactors, warnings } where each warning includes the
// detection_method actually used so we can debug post-hoc.
// ─────────────────────────────────────────────────────────────

export type NHLDetectionMethod = "atoi" | "points_l10" | "gp_plus_minus" | "blanket_capped";

export interface NHLInjuryWarning {
  player: string;
  status: string;
  position: string;
  rawStatus: string;
  detail: string;
  detection_method: NHLDetectionMethod;
  applied_penalty: number;
  affected_factor: string;
}

interface RankedRoster {
  topForwards: Set<string>; // lowercased names
  topDefensemen: Set<string>;
  topPPUnit: Set<string>;
  method: NHLDetectionMethod;
}

async function rankRosterByATOI(teamId: string): Promise<RankedRoster | null> {
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/roster`,
      { headers: { "User-Agent": "PrimalAnalytics/1.0" } },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const athletes = (data.athletes || []).flat();
    const forwards: Array<{ name: string; toi: number }> = [];
    const dmen: Array<{ name: string; toi: number }> = [];
    for (const a of athletes) {
      const pos = a.position?.abbreviation || "";
      const stats: Record<string, number> = {};
      for (const s of a.statistics || []) stats[s.name] = parseFloat(s.value) || 0;
      const toi = stats.timeOnIcePerGame || stats.avgTimeOnIce || stats.toi || 0;
      if (toi <= 0) return null; // ATOI not available → bail to next strategy
      const name = (a.displayName || "").toLowerCase();
      if (["C", "LW", "RW", "F"].includes(pos)) forwards.push({ name, toi });
      else if (pos === "D") dmen.push({ name, toi });
    }
    if (forwards.length === 0 || dmen.length === 0) return null;
    forwards.sort((a, b) => b.toi - a.toi);
    dmen.sort((a, b) => b.toi - a.toi);
    return {
      topForwards: new Set(forwards.slice(0, 6).map((p) => p.name)),
      topDefensemen: new Set(dmen.slice(0, 4).map((p) => p.name)),
      topPPUnit: new Set([
        ...forwards.slice(0, 3).map((p) => p.name),
        ...dmen.slice(0, 2).map((p) => p.name),
      ]),
      method: "atoi",
    };
  } catch {
    return null;
  }
}

async function rankRosterByPointsL10(teamId: string): Promise<RankedRoster | null> {
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${teamId}/roster`,
      { headers: { "User-Agent": "PrimalAnalytics/1.0" } },
    );
    if (!r.ok) return null;
    const data = await r.json();
    const athletes = (data.athletes || []).flat();
    const forwards: Array<{ name: string; pts: number }> = [];
    const dmen: Array<{ name: string; gpPlus: number }> = [];
    for (const a of athletes) {
      const pos = a.position?.abbreviation || "";
      const stats: Record<string, number> = {};
      for (const s of a.statistics || []) stats[s.name] = parseFloat(s.value) || 0;
      const goals = stats.goals || 0;
      const assists = stats.assists || 0;
      const gp = stats.gamesPlayed || stats.games || 0;
      const pm = stats.plusMinus || stats.plus_minus || 0;
      const name = (a.displayName || "").toLowerCase();
      if (["C", "LW", "RW", "F"].includes(pos)) {
        forwards.push({ name, pts: goals + assists });
      } else if (pos === "D") {
        dmen.push({ name, gpPlus: gp + pm });
      }
    }
    if (forwards.length === 0 || dmen.length === 0) return null;
    forwards.sort((a, b) => b.pts - a.pts);
    dmen.sort((a, b) => b.gpPlus - a.gpPlus);
    return {
      topForwards: new Set(forwards.slice(0, 6).map((p) => p.name)),
      topDefensemen: new Set(dmen.slice(0, 4).map((p) => p.name)),
      topPPUnit: new Set([
        ...forwards.slice(0, 3).map((p) => p.name),
        ...dmen.slice(0, 2).map((p) => p.name),
      ]),
      method: forwards.some((f) => f.pts > 0) ? "points_l10" : "gp_plus_minus",
    };
  } catch {
    return null;
  }
}

async function getRankedRoster(teamId: string): Promise<RankedRoster | { method: "blanket_capped" }> {
  const atoi = await rankRosterByATOI(teamId);
  if (atoi) return atoi;
  const pts = await rankRosterByPointsL10(teamId);
  if (pts) return pts;
  return { method: "blanket_capped" };
}

export interface NHLInjuryAdjustResult {
  adjustedFactors: Record<string, number>;
  warnings: NHLInjuryWarning[];
}

export async function nhlInjuryAdjustments(
  teamId: string,
  injuries: NormalizedInjury[],
  factors: Record<string, number>,
  startingGoalieName?: string,
  backupSvPct?: number,
): Promise<NHLInjuryAdjustResult> {
  const adjusted = { ...factors };
  const warnings: NHLInjuryWarning[] = [];

  const out = injuries.filter((i) => i.status === "out" || i.status === "doubtful");
  const ranked = await getRankedRoster(teamId);
  const method = ranked.method;

  // ── Goalie handling ───────────────────────────────────
  const goaliesOut = out.filter((i) => (i.position || "").toUpperCase() === "G");
  const startingGoalieDown =
    startingGoalieName &&
    goaliesOut.some((g) =>
      g.name.toLowerCase().includes(startingGoalieName.toLowerCase()),
    );
  if (startingGoalieDown) {
    const penalty = (backupSvPct ?? 0) > 0.910 ? 12 : 15;
    adjusted.goalie_sv = Math.max(0, (adjusted.goalie_sv ?? 50) - penalty);
    adjusted.goalie_gaa = Math.max(0, (adjusted.goalie_gaa ?? 50) - penalty);
    adjusted.goalie_l10 = Math.max(0, (adjusted.goalie_l10 ?? 50) - penalty);
    for (const g of goaliesOut) {
      warnings.push({
        player: g.name,
        status: g.status,
        position: g.position,
        rawStatus: g.rawStatus,
        detail: g.detail,
        detection_method: method,
        applied_penalty: penalty,
        affected_factor: "goalie_sv/goalie_gaa/goalie_l10",
      });
    }
  }

  // ── Skater handling ───────────────────────────────────
  const skatersOut = out.filter((i) => (i.position || "").toUpperCase() !== "G");

  if (method === "blanket_capped" || !("topForwards" in ranked)) {
    // Final fallback: blanket -4/F, -5/D, capped -16 combined to scoring factors.
    const fOut = skatersOut.filter((i) => ["C", "LW", "RW", "F"].includes((i.position || "").toUpperCase()));
    const dOut = skatersOut.filter((i) => (i.position || "").toUpperCase() === "D");
    const totalPenalty = Math.min(16, fOut.length * 4 + dOut.length * 5);
    if (totalPenalty > 0) {
      adjusted.goals_game = Math.max(0, (adjusted.goals_game ?? 50) - totalPenalty * 0.6);
      adjusted.goals_blend = Math.max(0, (adjusted.goals_blend ?? 50) - totalPenalty * 0.6);
      adjusted.goals_allowed = Math.max(0, (adjusted.goals_allowed ?? 50) - totalPenalty * 0.4);
      for (const p of skatersOut) {
        warnings.push({
          player: p.name,
          status: p.status,
          position: p.position,
          rawStatus: p.rawStatus,
          detail: p.detail,
          detection_method: "blanket_capped",
          applied_penalty: ["D"].includes(p.position) ? 5 : 4,
          affected_factor: "goals_game/goals_allowed",
        });
      }
    }
  } else {
    const r = ranked;
    for (const p of skatersOut) {
      const lower = p.name.toLowerCase();
      const pos = (p.position || "").toUpperCase();
      let penalty = 0;
      let affected = "";
      if (pos === "D" && r.topDefensemen.has(lower)) {
        penalty = 5;
        affected = "goals_allowed";
        adjusted.goals_allowed = Math.max(0, (adjusted.goals_allowed ?? 50) - 5);
      } else if (["C", "LW", "RW", "F"].includes(pos) && r.topForwards.has(lower)) {
        penalty = 4;
        affected = "goals_game";
        adjusted.goals_game = Math.max(0, (adjusted.goals_game ?? 50) - 4);
        adjusted.goals_blend = Math.max(0, (adjusted.goals_blend ?? 50) - 4);
      }
      if (r.topPPUnit.has(lower)) {
        adjusted.st_diff = Math.max(0, (adjusted.st_diff ?? 50) - 3);
        affected += affected ? "+st_diff" : "st_diff";
        penalty = penalty + 3;
      }
      if (penalty > 0) {
        warnings.push({
          player: p.name,
          status: p.status,
          position: p.position,
          rawStatus: p.rawStatus,
          detail: p.detail,
          detection_method: method,
          applied_penalty: penalty,
          affected_factor: affected,
        });
      }
    }
  }

  return { adjustedFactors: adjusted, warnings };
}
