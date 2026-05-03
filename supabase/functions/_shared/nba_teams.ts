// Canonical 3-letter NBA team abbreviations and a normalizer that accepts
// full names, nicknames, common alternates, and current/legacy codes.

const CANON: Record<string, string> = {
  ATL: "ATL",
  BOS: "BOS",
  BKN: "BKN", BRK: "BKN",
  CHA: "CHA", CHO: "CHA",
  CHI: "CHI",
  CLE: "CLE",
  DAL: "DAL",
  DEN: "DEN",
  DET: "DET",
  GSW: "GSW", GS: "GSW",
  HOU: "HOU",
  IND: "IND",
  LAC: "LAC",
  LAL: "LAL",
  MEM: "MEM",
  MIA: "MIA",
  MIL: "MIL",
  MIN: "MIN",
  NOP: "NOP", NO: "NOP", NOH: "NOP",
  NYK: "NYK", NY: "NYK",
  OKC: "OKC",
  ORL: "ORL",
  PHI: "PHI",
  PHX: "PHX", PHO: "PHX",
  POR: "POR",
  SAC: "SAC",
  SAS: "SAS", SA: "SAS",
  TOR: "TOR",
  UTA: "UTA", UTAH: "UTA",
  WAS: "WAS", WSH: "WAS",
};

const NAME_TO_ABBR: Record<string, string> = {
  "atlanta hawks": "ATL", "hawks": "ATL",
  "boston celtics": "BOS", "celtics": "BOS",
  "brooklyn nets": "BKN", "nets": "BKN",
  "charlotte hornets": "CHA", "hornets": "CHA",
  "chicago bulls": "CHI", "bulls": "CHI",
  "cleveland cavaliers": "CLE", "cavaliers": "CLE", "cavs": "CLE",
  "dallas mavericks": "DAL", "mavericks": "DAL", "mavs": "DAL",
  "denver nuggets": "DEN", "nuggets": "DEN",
  "detroit pistons": "DET", "pistons": "DET",
  "golden state warriors": "GSW", "warriors": "GSW",
  "houston rockets": "HOU", "rockets": "HOU",
  "indiana pacers": "IND", "pacers": "IND",
  "la clippers": "LAC", "los angeles clippers": "LAC", "clippers": "LAC",
  "los angeles lakers": "LAL", "lakers": "LAL",
  "memphis grizzlies": "MEM", "grizzlies": "MEM",
  "miami heat": "MIA", "heat": "MIA",
  "milwaukee bucks": "MIL", "bucks": "MIL",
  "minnesota timberwolves": "MIN", "timberwolves": "MIN", "wolves": "MIN",
  "new orleans pelicans": "NOP", "pelicans": "NOP",
  "new york knicks": "NYK", "knicks": "NYK",
  "oklahoma city thunder": "OKC", "thunder": "OKC",
  "orlando magic": "ORL", "magic": "ORL",
  "philadelphia 76ers": "PHI", "76ers": "PHI", "sixers": "PHI",
  "phoenix suns": "PHX", "suns": "PHX",
  "portland trail blazers": "POR", "trail blazers": "POR", "blazers": "POR",
  "sacramento kings": "SAC", "kings": "SAC",
  "san antonio spurs": "SAS", "spurs": "SAS",
  "toronto raptors": "TOR", "raptors": "TOR",
  "utah jazz": "UTA", "jazz": "UTA",
  "washington wizards": "WAS", "wizards": "WAS",
};

export function normalizeNbaTeam(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (CANON[upper]) return CANON[upper];

  const lower = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (NAME_TO_ABBR[lower]) return NAME_TO_ABBR[lower];

  // Strip leading "@" or "vs" prefixes from gamelog matchup strings.
  const stripped = lower.replace(/^(@|vs\.?)\s+/, "").trim();
  if (stripped !== lower) {
    const stripUpper = stripped.toUpperCase();
    if (CANON[stripUpper]) return CANON[stripUpper];
    if (NAME_TO_ABBR[stripped]) return NAME_TO_ABBR[stripped];
  }

  return null;
}
