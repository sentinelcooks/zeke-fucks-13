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

/**
 * Hour (ET) at which the daily slate rolls over.
 *
 * Midnight was the wrong boundary: West-coast games start as late as ~10 PM ET
 * and run past midnight, so at 12:00 AM a still-live pick jumped into
 * Yesterday's Edge and sat there as PENDING. By 4 AM ET no North American game
 * is in progress. The slate scanners are scheduled for the same hour (see the
 * `slate_scanners_4am_et` migration) so the new lineup and yesterday's results
 * appear together.
 */
export const SLATE_ROLLOVER_HOUR_ET = 4;

/**
 * The slate date the app is currently showing: the ET calendar date, except
 * that from midnight until 4 AM ET it is still the previous day.
 *
 * Use this for "today's picks" and derive "yesterday" from it. Keep
 * `todayInTZ()` for things that genuinely mean the calendar date.
 */
export function currentSlateDate(now: Date = new Date(), tz: string = APP_TZ): string {
  const shifted = new Date(now.getTime() - SLATE_ROLLOVER_HOUR_ET * 60 * 60 * 1000);
  return ymdFmt(tz).format(shifted);
}

export function shiftYmd(date: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !Number.isInteger(days)) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }

  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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
  return gd === currentSlateDate();
}

// "void" = the pick was withdrawn (e.g. it was published against the wrong
// side of a market); it is settled, stakes returned, and never re-graded.
const FINAL_RESULTS = new Set(["hit", "miss", "push", "win", "loss", "void"]);
export function isResultFinal(r?: string | null): boolean {
  if (!r) return false;
  return FINAL_RESULTS.has(String(r).toLowerCase());
}
