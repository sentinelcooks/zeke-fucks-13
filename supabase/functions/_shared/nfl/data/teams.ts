/**
 * Static NFL team reference data (shared raw data).
 *
 * Home-stadium coordinates drive the travel factor (great-circle miles and
 * time-zone shift) and the weather forecast lookup. `utcOffset` is the
 * standard-time offset; only the DIFFERENCE between two teams is used, so DST
 * cancels out (Arizona's no-DST quirk costs at most one hour, accepted).
 */

export interface NflTeamInfo {
  abbr: string;
  name: string;
  lat: number;
  lon: number;
  utcOffset: number;
  /** Home stadium has a fixed or retractable roof. */
  roofed: boolean;
}

export const NFL_TEAMS: Record<string, NflTeamInfo> = {
  ARI: { abbr: "ARI", name: "Arizona Cardinals", lat: 33.5276, lon: -112.2626, utcOffset: -7, roofed: true },
  ATL: { abbr: "ATL", name: "Atlanta Falcons", lat: 33.7554, lon: -84.4009, utcOffset: -5, roofed: true },
  BAL: { abbr: "BAL", name: "Baltimore Ravens", lat: 39.2780, lon: -76.6227, utcOffset: -5, roofed: false },
  BUF: { abbr: "BUF", name: "Buffalo Bills", lat: 42.7738, lon: -78.7870, utcOffset: -5, roofed: false },
  CAR: { abbr: "CAR", name: "Carolina Panthers", lat: 35.2258, lon: -80.8528, utcOffset: -5, roofed: false },
  CHI: { abbr: "CHI", name: "Chicago Bears", lat: 41.8623, lon: -87.6167, utcOffset: -6, roofed: false },
  CIN: { abbr: "CIN", name: "Cincinnati Bengals", lat: 39.0955, lon: -84.5161, utcOffset: -5, roofed: false },
  CLE: { abbr: "CLE", name: "Cleveland Browns", lat: 41.5061, lon: -81.6995, utcOffset: -5, roofed: false },
  DAL: { abbr: "DAL", name: "Dallas Cowboys", lat: 32.7473, lon: -97.0945, utcOffset: -6, roofed: true },
  DEN: { abbr: "DEN", name: "Denver Broncos", lat: 39.7439, lon: -105.0201, utcOffset: -7, roofed: false },
  DET: { abbr: "DET", name: "Detroit Lions", lat: 42.3400, lon: -83.0456, utcOffset: -5, roofed: true },
  GB: { abbr: "GB", name: "Green Bay Packers", lat: 44.5013, lon: -88.0622, utcOffset: -6, roofed: false },
  HOU: { abbr: "HOU", name: "Houston Texans", lat: 29.6847, lon: -95.4107, utcOffset: -6, roofed: true },
  IND: { abbr: "IND", name: "Indianapolis Colts", lat: 39.7601, lon: -86.1639, utcOffset: -5, roofed: true },
  JAX: { abbr: "JAX", name: "Jacksonville Jaguars", lat: 30.3239, lon: -81.6373, utcOffset: -5, roofed: false },
  KC: { abbr: "KC", name: "Kansas City Chiefs", lat: 39.0489, lon: -94.4839, utcOffset: -6, roofed: false },
  LA: { abbr: "LA", name: "Los Angeles Rams", lat: 33.9535, lon: -118.3392, utcOffset: -8, roofed: true },
  LAC: { abbr: "LAC", name: "Los Angeles Chargers", lat: 33.9535, lon: -118.3392, utcOffset: -8, roofed: true },
  LV: { abbr: "LV", name: "Las Vegas Raiders", lat: 36.0909, lon: -115.1833, utcOffset: -8, roofed: true },
  MIA: { abbr: "MIA", name: "Miami Dolphins", lat: 25.9580, lon: -80.2389, utcOffset: -5, roofed: false },
  MIN: { abbr: "MIN", name: "Minnesota Vikings", lat: 44.9737, lon: -93.2581, utcOffset: -6, roofed: true },
  NE: { abbr: "NE", name: "New England Patriots", lat: 42.0909, lon: -71.2643, utcOffset: -5, roofed: false },
  NO: { abbr: "NO", name: "New Orleans Saints", lat: 29.9511, lon: -90.0812, utcOffset: -6, roofed: true },
  NYG: { abbr: "NYG", name: "New York Giants", lat: 40.8128, lon: -74.0742, utcOffset: -5, roofed: false },
  NYJ: { abbr: "NYJ", name: "New York Jets", lat: 40.8128, lon: -74.0742, utcOffset: -5, roofed: false },
  PHI: { abbr: "PHI", name: "Philadelphia Eagles", lat: 39.9008, lon: -75.1675, utcOffset: -5, roofed: false },
  PIT: { abbr: "PIT", name: "Pittsburgh Steelers", lat: 40.4468, lon: -80.0158, utcOffset: -5, roofed: false },
  SEA: { abbr: "SEA", name: "Seattle Seahawks", lat: 47.5952, lon: -122.3316, utcOffset: -8, roofed: false },
  SF: { abbr: "SF", name: "San Francisco 49ers", lat: 37.4030, lon: -121.9700, utcOffset: -8, roofed: false },
  TB: { abbr: "TB", name: "Tampa Bay Buccaneers", lat: 27.9759, lon: -82.5033, utcOffset: -5, roofed: false },
  TEN: { abbr: "TEN", name: "Tennessee Titans", lat: 36.1665, lon: -86.7713, utcOffset: -6, roofed: false },
  WAS: { abbr: "WAS", name: "Washington Commanders", lat: 38.9077, lon: -76.8645, utcOffset: -5, roofed: false },
};

/** Resolve a sportsbook / ESPN team name or abbreviation to an NFL abbreviation. */
export function resolveNflTeam(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  const aliases: Record<string, string> = { LAR: "LA", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" };
  if (NFL_TEAMS[up]) return up;
  if (aliases[up]) return aliases[up];
  const lower = raw.toLowerCase();
  for (const t of Object.values(NFL_TEAMS)) {
    const name = t.name.toLowerCase();
    if (name === lower) return t.abbr;
    const nickname = name.split(" ").pop()!;
    if (lower === nickname || lower.endsWith(` ${nickname}`)) return t.abbr;
  }
  return null;
}

/** Great-circle distance in statute miles. */
export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
