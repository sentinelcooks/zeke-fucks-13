// Shared helpers for resolving the actual game date of a pick and deciding
// whether it should appear in today's public display. The app's slate
// timezone is America/New_York — all "today" comparisons happen there.

export const APP_TZ = "America/New_York";

const ymdFmtCache = new Map<string, Intl.DateTimeFormat>();
function ymdFmt(tz: string): Intl.DateTimeFormat {
  let f = ymdFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    ymdFmtCache.set(tz, f);
  }
  return f;
}

export function todayInTZ(tz: string = APP_TZ): string {
  return ymdFmt(tz).format(new Date());
}

export function toETDate(
  iso: string | null | undefined,
  tz: string = APP_TZ,
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return ymdFmt(tz).format(d);
}

export type GameDateLike = {
  game_date?: string | null;
  commence_time?: string | null;
};

export function getGameDate(p: GameDateLike): string | null {
  if (p.game_date) return String(p.game_date).slice(0, 10);
  return toETDate(p.commence_time ?? null);
}

export function isTodayGamePick(p: GameDateLike): boolean {
  const gd = getGameDate(p);
  if (!gd) return false;
  return gd === todayInTZ();
}

const FINAL_RESULTS = new Set(["hit", "miss", "push", "win", "loss"]);
export function isResultFinal(r?: string | null): boolean {
  if (!r) return false;
  return FINAL_RESULTS.has(String(r).toLowerCase());
}
