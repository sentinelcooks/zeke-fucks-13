export type ScanBatchOptions = {
  propEventOffset: number;
  propEventLimit?: number;
  includeGameLines: boolean;
  batchIndex?: number;
};

function boundedInteger(
  value: unknown,
  fallback: number | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

/**
 * Parse the optional cron/manual scan window. Requests without an explicit
 * window keep the legacy full-slate behavior.
 */
export function parseScanBatchRequest(body: Record<string, unknown>): ScanBatchOptions {
  return {
    propEventOffset: boundedInteger(body.prop_event_offset, 0, 0, 200) ?? 0,
    propEventLimit: boundedInteger(body.prop_event_limit, undefined, 1, 8),
    includeGameLines: body.include_game_lines !== false,
    batchIndex: boundedInteger(body.batch_index, undefined, 0, 99),
  };
}

export function selectEventBatch<T>(
  events: readonly T[],
  window: Pick<ScanBatchOptions, "propEventOffset" | "propEventLimit">,
): T[] {
  const offset = Math.max(0, Math.trunc(window.propEventOffset || 0));
  if (window.propEventLimit === undefined) return events.slice(offset);
  return events.slice(offset, offset + Math.max(1, Math.trunc(window.propEventLimit)));
}

type ScheduleEventLike = {
  id?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  commence_time?: unknown;
};

/** Match schedules one-to-one so MLB doubleheaders do not collapse in a Map. */
export function matchScheduledEvents<T extends ScheduleEventLike>(
  scheduled: readonly ScheduleEventLike[],
  events: readonly T[],
  normalizeTeam: (team: string) => string,
): T[] {
  const unused = new Set(events.map((_, index) => index));
  const matches: T[] = [];

  for (const game of scheduled) {
    const home = normalizeTeam(String(game.home_team ?? ""));
    const away = normalizeTeam(String(game.away_team ?? ""));
    const scheduleTime = Date.parse(String(game.commence_time ?? ""));
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const index of unused) {
      const event = events[index];
      const eventHome = normalizeTeam(String(event.home_team ?? ""));
      const eventAway = normalizeTeam(String(event.away_team ?? ""));
      if (!(
        (eventHome === home && eventAway === away) ||
        (eventHome === away && eventAway === home)
      )) continue;

      const eventTime = Date.parse(String(event.commence_time ?? ""));
      const distance = Number.isFinite(scheduleTime) && Number.isFinite(eventTime)
        ? Math.abs(scheduleTime - eventTime)
        : 0;
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }

    if (bestIndex >= 0) {
      unused.delete(bestIndex);
      matches.push(events[bestIndex]);
    }
  }

  return matches;
}

/** Run asynchronous work with a hard concurrency ceiling and stable ordering. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const workerCount = Math.min(items.length, Math.max(1, Math.trunc(concurrency)));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }));

  return results;
}
