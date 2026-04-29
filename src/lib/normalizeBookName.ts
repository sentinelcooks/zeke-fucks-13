const ALIASES: Record<string, string> = {
  // BetAnything variants
  betanything: "betanything",
  betany: "betanything",
  betanysports: "betanything",
  betanysport: "betanything",
  bet_any_sport: "betanything",
  betanythingcom: "betanything",

  // FanDuel
  fanduel: "fanduel",
  fan_duel: "fanduel",

  // DraftKings
  draftkings: "draftkings",
  draft_kings: "draftkings",

  // BetMGM
  betmgm: "betmgm",
  bet_mgm: "betmgm",
  mgm: "betmgm",

  // BetOnline
  betonlineag: "betonlineag",
  betonline: "betonlineag",
  bet_online: "betonlineag",
  betonlineag2: "betonlineag",
  betonline_ag: "betonlineag",

  // ESPN BET
  espnbet: "espnbet",
  espn_bet: "espnbet",

  // Fliff
  fliff: "fliff",

  // BetRivers
  betrivers: "betrivers",
  bet_rivers: "betrivers",

  // PrizePicks
  prizepicks: "prizepicks",
  prize_picks: "prizepicks",

  // Underdog
  underdog: "underdog",
  underdogfantasy: "underdog",
  underdog_fantasy: "underdog",

  // Novig
  novig: "novig",

  // Kalshi
  kalshi: "kalshi",

  // Polymarket
  polymarket: "polymarket",

  // Betr
  betr_us_dfs: "betr_us_dfs",
  betr: "betr_us_dfs",
  betrus: "betr_us_dfs",
  betr_us: "betr_us_dfs",
};

/** Converts any raw book key/title string to a canonical key. */
export function normalizeBookKey(raw: string): string {
  const cleaned = (raw || "unknown").toLowerCase().replace(/[^a-z0-9_]/g, "");
  return ALIASES[cleaned] ?? cleaned;
}
