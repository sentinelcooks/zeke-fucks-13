const TEMPORARILY_HIDDEN_SPORTS = new Set(["nba", "nhl"]);

export function isSportTemporarilyHidden(sport: unknown): boolean {
  return typeof sport === "string"
    && TEMPORARILY_HIDDEN_SPORTS.has(sport.trim().toLowerCase());
}
