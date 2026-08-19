import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mapWithConcurrency,
  matchScheduledEvents,
  parseScanBatchRequest,
  selectEventBatch,
} from "../../supabase/functions/_shared/scan_batches";
import {
  isTransientPoolDbError,
  rotationFailureResponse,
  withPoolQueryRetry,
} from "../../supabase/functions/_shared/oddsKeyPool";

describe("slate discovery batching", () => {
  it("parses and clamps an explicit cron batch window", () => {
    expect(parseScanBatchRequest({
      prop_event_offset: -4,
      prop_event_limit: 99,
      include_game_lines: false,
      batch_index: 2,
    })).toEqual({
      propEventOffset: 0,
      propEventLimit: 8,
      includeGameLines: false,
      batchIndex: 2,
    });
  });

  it("preserves the full-slate behavior for an unbatched manual request", () => {
    expect(parseScanBatchRequest({})).toEqual({
      propEventOffset: 0,
      propEventLimit: undefined,
      includeGameLines: true,
      batchIndex: undefined,
    });
  });

  it("selects a deterministic event window without dropping later batches", () => {
    const events = Array.from({ length: 14 }, (_, id) => ({ id }));
    expect(selectEventBatch(events, { propEventOffset: 6, propEventLimit: 3 }).map((e) => e.id))
      .toEqual([6, 7, 8]);
    expect(selectEventBatch(events, { propEventOffset: 12, propEventLimit: 3 }).map((e) => e.id))
      .toEqual([12, 13]);
  });

  it("matches both games of an MLB doubleheader one-to-one", () => {
    const scheduled = [
      { home_team: "Chicago Cubs", away_team: "St. Louis Cardinals", commence_time: "2026-08-19T17:00:00Z" },
      { home_team: "Chicago Cubs", away_team: "St. Louis Cardinals", commence_time: "2026-08-19T21:00:00Z" },
    ];
    const events = [
      { id: "late", home_team: "Chicago Cubs", away_team: "St. Louis Cardinals", commence_time: "2026-08-19T21:05:00Z" },
      { id: "early", home_team: "Chicago Cubs", away_team: "St. Louis Cardinals", commence_time: "2026-08-19T17:05:00Z" },
    ];

    expect(matchScheduledEvents(scheduled, events, (team) => team.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .map((event) => event.id)).toEqual(["early", "late"]);
  });

  it("bounds concurrent market work and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency(
      Array.from({ length: 9 }, (_, index) => index),
      3,
      async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return value * 2;
      },
    );

    expect(maxActive).toBeLessThanOrEqual(3);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16]);
  });
});

describe("Odds API key-pool reliability", () => {
  it("recognizes schema-cache/database availability errors as transient", () => {
    expect(isTransientPoolDbError({
      code: "PGRST002",
      message: "Could not query the database for the schema cache. Retrying.",
    })).toBe(true);
    expect(isTransientPoolDbError({ code: "23505", message: "duplicate key" })).toBe(false);
  });

  it("retries a transient pool query instead of treating it as an empty pool", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempt = 0;
    const data = await withPoolQueryRetry(
      async () => {
        attempt += 1;
        if (attempt < 3) {
          return {
            data: null,
            error: {
              code: "PGRST002",
              message: "Could not query the database for the schema cache. Retrying.",
            },
          };
        }
        return { data: { id: "key-1" }, error: null };
      },
      { label: "test", sleep },
    );

    expect(data).toEqual({ id: "key-1" });
    expect(attempt).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("reports a pool outage differently from legitimately unavailable keys", () => {
    expect(rotationFailureResponse({ kind: "key_pool_unavailable", retryAfterMs: 2_000 }))
      .toMatchObject({
        status: 503,
        body: { code: "key_pool_unavailable", retryAfterMs: 2_000 },
      });
    expect(rotationFailureResponse({ kind: "no_usable_keys" }))
      .toMatchObject({
        status: 503,
        body: { code: "no_usable_keys" },
      });
  });

  it("keeps the uploaded pool and atomically claims its least-recently-used key", () => {
    const poolSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/oddsKeyPool.ts"),
      "utf8",
    );
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260826000000_reliable_batched_daily_edge_scans.sql"),
      "utf8",
    );

    expect(poolSource).toContain('rpc("claim_available_odds_api_key")');
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.claim_available_odds_api_key()");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("schedules five bounded MLB and WNBA event windows", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260826000000_reliable_batched_daily_edge_scans.sql"),
      "utf8",
    );

    expect(migration).toContain("'10,12,14,16,18 4 * * *'");
    expect(migration).toContain("'25,27,29,31,33 4 * * *'");
    expect(migration).toContain("'prop_event_limit', 4");
    expect(migration).toContain("'include_game_lines', v_batch = 0");
  });

  it("uses ESPN's current scoreboard host before the legacy failover", () => {
    const scheduleSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/games-schedule/index.ts"),
      "utf8",
    );

    const currentHost = scheduleSource.indexOf("https://site.web.api.espn.com/apis/site/v2");
    const legacyHost = scheduleSource.indexOf("https://site.api.espn.com/apis/site/v2");
    expect(currentHost).toBeGreaterThanOrEqual(0);
    expect(legacyHost).toBeGreaterThan(currentHost);
    expect(scheduleSource).toContain("fetchEspnScoreboard(mapping, dateStr)");
  });

  it("falls back to verified Odds API events instead of emptying the slate", () => {
    const scanSource = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/sport_scan.ts"),
      "utf8",
    );

    expect(scanSource).toContain('stats.game_line_schedule_source = "odds_api_fallback"');
    expect(scanSource).toContain('stats.player_prop_schedule_source = "odds_api_fallback"');
    expect(scanSource).toContain("new Date(ev.commence_time).getTime() > Date.now()");
  });
});
