/**
 * Thin ESPN fetch layer for WNBA team-market analysis.
 *
 * Exists so `wnba-game-model` can stand on its own without importing anything
 * from `moneyline-api`. It deliberately fetches ONLY what the 25-factor model
 * consumes — schedule, team statistics, injuries — and hands the raw payloads
 * to the builders that already live in `_shared/wnba_model.ts`
 * (`buildWnbaTeamMetrics`, `deriveWnbaEfficiency`, `buildWnbaAvailability`).
 * No scoring happens here.
 *
 * Staged-refactor note (docs/claude/sentinel-backend-rules.md, "Minimize unsafe
 * rewrites"): `moneyline-api` still has its own copies of the ESPN helpers.
 * They are not touched here. New code uses this module; the old path can be
 * migrated onto it separately, with its own verification, rather than
 * rewriting a 2,300-line working function as a side effect of adding a feature.
 */

import {
  buildWnbaTeamMetrics,
  deriveWnbaEfficiency,
  type WnbaEfficiency,
  type WnbaTeamMetrics,
} from "./wnba_model.ts";

const ESPN_WNBA_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba";
const ESPN_WNBA_CORE = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";
const FETCH_TIMEOUT_MS = 8000;

export interface WnbaTeamRef {
  id: string;
  name: string;
  abbreviation: string;
}

/**
 * ESPN began 403ing the legacy `site.api` host in August 2026 while
 * `site.web.api` kept serving the same schema — the same failure that silently
 * killed grade-picks for 24 days. Both hosts are tried, and a non-OK response
 * is always logged rather than collapsing into an empty result.
 */
async function espnJson(path: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<any | null> {
  for (const base of [ESPN_WNBA_BASE, ESPN_WNBA_CORE]) {
    const url = `${base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: controller.signal,
      });
      if (!resp.ok) {
        console.error(`[wnba-context] espn not ok | status=${resp.status} | url=${url}`);
        continue;
      }
      return await resp.json();
    } catch (error) {
      console.error(`[wnba-context] espn fetch failed | url=${url}`, error);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export function wnbaSeasonFor(date = new Date()): number {
  return date.getFullYear();
}

/** Regular season (type 2) plus postseason (type 3), de-duplicated by event id. */
export async function fetchWnbaTeamSchedule(teamId: string, season: number): Promise<any[]> {
  const merged = new Map<string, any>();
  for (const seasonType of [2, 3]) {
    const data = await espnJson(`/teams/${teamId}/schedule?season=${season}&seasontype=${seasonType}`);
    for (const event of data?.events ?? []) {
      const id = String(event?.id ?? event?.uid ?? `${event?.date}-${event?.name}`);
      if (!merged.has(id)) merged.set(id, event);
    }
  }
  return [...merged.values()];
}

/** Flattens ESPN's nested stat categories into a single name -> value map. */
export async function fetchWnbaTeamStats(teamId: string): Promise<Record<string, number>> {
  const data = await espnJson(`/teams/${teamId}/statistics`);
  const stats: Record<string, number> = {};
  const categories = data?.results?.stats?.categories ?? data?.statistics?.splits?.categories ?? [];
  for (const category of categories) {
    for (const stat of category?.stats ?? []) {
      const name = stat?.name;
      const value = Number(stat?.value);
      if (name && Number.isFinite(value)) stats[name] = value;
    }
  }
  return stats;
}

export async function fetchWnbaTeams(): Promise<WnbaTeamRef[]> {
  const data = await espnJson("/teams");
  const entries = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return entries
    .map((entry: any) => entry?.team)
    .filter(Boolean)
    .map((team: any) => ({
      id: String(team.id),
      name: String(team.displayName ?? team.name ?? ""),
      abbreviation: String(team.abbreviation ?? ""),
    }))
    .filter((t: WnbaTeamRef) => t.id && t.name);
}

function normalizeName(value: string): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Matches on abbreviation, full name, or either containing the other. */
export function matchWnbaTeam(teams: WnbaTeamRef[], query: string): WnbaTeamRef | null {
  const q = normalizeName(query);
  if (!q) return null;
  return (
    teams.find((t) => normalizeName(t.abbreviation) === q) ??
    teams.find((t) => normalizeName(t.name) === q) ??
    teams.find((t) => {
      const n = normalizeName(t.name);
      return n.includes(q) || q.includes(n);
    }) ??
    null
  );
}

export interface WnbaVenueSplit {
  games: number;
  wins: number;
  pointsFor: number | null;
  pointsAgainst: number | null;
  netPoints: number | null;
  winRate: number | null;
}

/**
 * Home or away split from a team's completed games. Kept here rather than in the
 * model so the model stays pure and free of ESPN's payload shape.
 */
export function computeWnbaVenueSplit(
  events: any[],
  teamId: string,
  wantHome: boolean,
): WnbaVenueSplit {
  let games = 0, wins = 0, pf = 0, pa = 0;
  const id = String(teamId);

  for (const event of events ?? []) {
    const competition = event?.competitions?.[0];
    if (!competition) continue;
    if (competition?.status?.type?.completed !== true) continue;

    const competitors = competition?.competitors ?? [];
    const self = competitors.find((c: any) => String(c?.team?.id) === id);
    const other = competitors.find((c: any) => String(c?.team?.id) !== id);
    if (!self || !other) continue;

    const isHome = self?.homeAway === "home";
    if (isHome !== wantHome) continue;

    const selfScore = Number(self?.score?.value ?? self?.score);
    const otherScore = Number(other?.score?.value ?? other?.score);
    if (!Number.isFinite(selfScore) || !Number.isFinite(otherScore)) continue;

    games += 1;
    pf += selfScore;
    pa += otherScore;
    if (selfScore > otherScore) wins += 1;
  }

  if (games === 0) {
    return { games: 0, wins: 0, pointsFor: null, pointsAgainst: null, netPoints: null, winRate: null };
  }
  const pointsFor = pf / games;
  const pointsAgainst = pa / games;
  return {
    games,
    wins,
    pointsFor: Math.round(pointsFor * 10) / 10,
    pointsAgainst: Math.round(pointsAgainst * 10) / 10,
    netPoints: Math.round((pointsFor - pointsAgainst) * 10) / 10,
    winRate: Math.round((wins / games) * 1000) / 1000,
  };
}

/**
 * True when the team's most recent completed game was in a different city than
 * this game's venue. Null when either city is unknown — an unknown is reported
 * as unknown rather than assumed to be "no travel".
 */
export function detectWnbaTravel(
  lastVenueCity: string | null | undefined,
  currentVenueCity: string | null | undefined,
): boolean | null {
  const last = normalizeName(lastVenueCity ?? "");
  const current = normalizeName(currentVenueCity ?? "");
  if (!last || !current) return null;
  return last !== current;
}

/**
 * Team form and efficiency for one club, keyed by ESPN abbreviation.
 *
 * The prop model needs both halves: `metrics` carries schedule-derived form
 * (rest, travel, last venue) and `efficiency` carries the season rate stats the
 * matchup factors score against.
 *
 * Staged-refactor note, as above: `nba-api` has a local twin of this helper for
 * its WNBA path. New code uses this one; that path migrates separately.
 */
export async function fetchWnbaTeamContext(
  teamAbbr: string,
  targetDate: string,
): Promise<{ metrics: WnbaTeamMetrics; efficiency: WnbaEfficiency }> {
  const season = new Date(targetDate || Date.now()).getFullYear();
  const [scheduleResponse, statsResponse] = await Promise.all([
    fetch(`${ESPN_WNBA_CORE}/teams/${encodeURIComponent(teamAbbr)}/schedule?season=${season}`).catch(() => null),
    fetch(`${ESPN_WNBA_CORE}/teams/${encodeURIComponent(teamAbbr)}/statistics`).catch(() => null),
  ]);
  const schedule = scheduleResponse?.ok ? await scheduleResponse.json().catch(() => ({})) : {};
  const statsPayload = statsResponse?.ok ? await statsResponse.json().catch(() => ({})) : {};

  const stats: Record<string, number> = {};
  const categories = statsPayload?.results?.stats?.categories ?? statsPayload?.statistics?.splits?.categories ?? [];
  for (const category of categories) {
    for (const stat of category?.stats ?? []) {
      const value = Number(stat?.value ?? stat?.displayValue);
      if (stat?.name && Number.isFinite(value)) stats[stat.name] = value;
    }
  }

  const metrics = buildWnbaTeamMetrics(schedule?.events ?? [], teamAbbr, targetDate);
  return { metrics, efficiency: deriveWnbaEfficiency(stats, metrics) };
}
