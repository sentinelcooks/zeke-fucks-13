export interface MlbScheduleTeam {
  name?: string | null;
  abbreviation?: string | null;
  teamName?: string | null;
  clubName?: string | null;
}

export interface MlbScheduleGame {
  gamePk?: number | string | null;
  gameDate?: string | null;
  teams?: {
    home?: { team?: MlbScheduleTeam | null } | null;
    away?: { team?: MlbScheduleTeam | null } | null;
  } | null;
}

export interface MlbRequestedTeam {
  name: string;
  abbr?: string | null;
}

export interface MatchedMlbScheduleGame {
  gameId: string;
  gameDate: string;
  team1IsHome: boolean;
}

function normalizeTeam(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Abbreviations that disagree across the feeds Sentinel reads, mapped onto the
 * MLB StatsAPI spelling (the schedule we match against).
 *
 * Checked against all 30 clubs: ESPN and StatsAPI differ on exactly two —
 * ESPN says CHW/ARI where StatsAPI says CWS/AZ. The remaining entries are the
 * long forms that odds and stats feeds commonly use, kept here so a feed swap
 * does not silently reintroduce the same class of unmatched game.
 */
const MLB_ABBR_ALIASES: Record<string, string> = {
  chw: "cws",
  ari: "az",
  oak: "ath",
  sfg: "sf",
  tbr: "tb",
  kcr: "kc",
  sdp: "sd",
  wsn: "wsh",
  was: "wsh",
  nyn: "nym",
  nya: "nyy",
};

/** Normalizes an abbreviation and folds known cross-feed spellings onto one form. */
export function canonicalMlbAbbr(value: string | null | undefined) {
  const normalized = normalizeTeam(value);
  return MLB_ABBR_ALIASES[normalized] ?? normalized;
}

/**
 * Matches a schedule team against a single free-form identifier.
 *
 * Callers hand over whatever their upstream feed gave them, and those feeds do
 * not agree: the odds feed sends full names ("Cleveland Guardians"), the ESPN
 * paths send abbreviations, and the two abbreviation sets differ on CWS and AZ.
 * Comparing against only one of those identities is what left every MLB
 * moneyline and spread request unmatched, so all of them are checked.
 */
export function mlbScheduleTeamMatchesIdentifier(
  scheduleTeam: MlbScheduleTeam | null | undefined,
  identifier: string | null | undefined,
) {
  const wanted = normalizeTeam(identifier);
  if (!wanted) return false;

  const abbr = canonicalMlbAbbr(scheduleTeam?.abbreviation);
  if (abbr && abbr === canonicalMlbAbbr(identifier)) return true;

  const names = [scheduleTeam?.name, scheduleTeam?.teamName, scheduleTeam?.clubName]
    .map(normalizeTeam)
    .filter(Boolean);
  if (names.includes(wanted)) return true;

  // A nickname-only identifier still has to resolve: feeds disagree on the city
  // ("Athletics" vs "Oakland Athletics"), never on the nickname. Guarded on
  // length so a two- or three-letter club name cannot match by coincidence.
  const nickname = normalizeTeam(scheduleTeam?.teamName ?? scheduleTeam?.clubName);
  return Boolean(nickname && nickname.length >= 4 && wanted.endsWith(nickname));
}

function teamMatches(scheduleTeam: MlbScheduleTeam | null | undefined, requestedTeam: MlbRequestedTeam) {
  const scheduleName = normalizeTeam(scheduleTeam?.name);
  const requestedName = normalizeTeam(requestedTeam.name);
  const scheduleAbbr = canonicalMlbAbbr(scheduleTeam?.abbreviation);
  const requestedAbbr = canonicalMlbAbbr(requestedTeam.abbr);

  return Boolean(
    (scheduleName && scheduleName === requestedName) ||
    (scheduleAbbr && requestedAbbr && scheduleAbbr === requestedAbbr),
  );
}

export function startsAtSameMlbScheduledEvent(first: string | null | undefined, second: string | null | undefined) {
  const firstTime = Date.parse(String(first || ""));
  const secondTime = Date.parse(String(second || ""));
  return Number.isFinite(firstTime) && Number.isFinite(secondTime) && Math.abs(firstTime - secondTime) <= 90 * 60 * 1_000;
}

export function mlbScheduleDatesForExpectedEvent(expectedCommenceTime: string | null | undefined): string[] {
  const start = new Date(String(expectedCommenceTime || ""));
  if (!Number.isFinite(start.getTime())) return [];

  const dates = new Set<string>([start.toISOString().slice(0, 10)]);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(start);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year && month && day) dates.add(`${year}-${month}-${day}`);

  return [...dates];
}

export function findExactMlbScheduledGame(input: {
  games: MlbScheduleGame[];
  team1: MlbRequestedTeam;
  team2: MlbRequestedTeam;
  expectedCommenceTime: string;
}): MatchedMlbScheduleGame | null {
  for (const game of input.games) {
    const home = game.teams?.home?.team;
    const away = game.teams?.away?.team;
    const gamePk = game.gamePk;
    const gameDate = game.gameDate;
    if (!home || !away || gamePk === null || gamePk === undefined || !gameDate) continue;
    if (!startsAtSameMlbScheduledEvent(gameDate, input.expectedCommenceTime)) continue;

    const team1IsHome = teamMatches(home, input.team1) && teamMatches(away, input.team2);
    const team1IsAway = teamMatches(away, input.team1) && teamMatches(home, input.team2);
    if (!team1IsHome && !team1IsAway) continue;

    return {
      gameId: String(gamePk),
      gameDate,
      team1IsHome,
    };
  }

  return null;
}
