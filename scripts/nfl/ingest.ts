/**
 * NFL feature-store ingest (nflverse → local cache → Supabase `nfl_*` tables).
 *
 * Runs in Node (not an Edge Function): play-by-play is ~200 MB/season and
 * Edge Functions have a ~2 s CPU budget. Scheduled by
 * `.github/workflows/nfl-ingest.yml`; can be run locally:
 *
 *   node scripts/nfl/ingest.ts                       # current season, cache only unless env set
 *   node scripts/nfl/ingest.ts --seasons 2017-2026   # backfill (backtests need 2017 as a prior)
 *   node scripts/nfl/ingest.ts --no-upload           # never write to Supabase
 *
 * Upload requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
 * (server-side only — CI secrets or a local shell, never a VITE_* var).
 *
 * Idempotent: every table is upserted on its natural key.
 */

import { createGunzip } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import {
  CsvStreamReader,
  PbpAggregator,
  PBP_COLUMNS,
  buildSnapIndex,
  parseCsv,
  toGameRow,
  toInjuryRow,
  toPlayerWeekRow,
  type CsvRecord,
} from "../../supabase/functions/_shared/nfl/data/aggregate.ts";
import type {
  NflGameRow,
  NflInjuryRow,
  NflPlayerWeekRow,
  NflTeamWeekRow,
} from "../../supabase/functions/_shared/nfl/data/types.ts";
import { resolveServiceCredentials } from "./credentials.ts";

const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";
const URLS = {
  games: `${RELEASES}/schedules/games.csv`,
  pbp: (s: number) => `${RELEASES}/pbp/play_by_play_${s}.csv.gz`,
  stats: (s: number) => `${RELEASES}/stats_player/stats_player_week_${s}.csv`,
  snaps: (s: number) => `${RELEASES}/snap_counts/snap_counts_${s}.csv`,
  injuries: (s: number) => `${RELEASES}/injuries/injuries_${s}.csv`,
};

interface Args {
  seasons: number[];
  upload: boolean;
  cacheDir: string;
}

export function currentNflSeason(now = new Date()): number {
  // The league year rolls in March; Jan/Feb games belong to the prior season.
  return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function parseArgs(argv: string[]): Args {
  let seasons = [currentNflSeason()];
  let upload = true;
  let cacheDir = ".cache/nfl";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seasons") {
      const v = argv[++i] ?? "";
      const m = v.match(/^(\d{4})(?:-(\d{4}))?$/);
      if (!m) throw new Error(`--seasons expects YYYY or YYYY-YYYY, got "${v}"`);
      const from = Number(m[1]);
      const to = Number(m[2] ?? m[1]);
      seasons = [];
      for (let s = from; s <= to; s++) seasons.push(s);
    } else if (a === "--no-upload") {
      upload = false;
    } else if (a === "--cache-dir") {
      cacheDir = argv[++i];
    }
  }
  return { seasons, upload, cacheDir };
}

async function fetchOk(url: string): Promise<Response> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    if (res.ok && res.body) return res;
    if (res.status === 404) throw new Error(`not found: ${url}`);
    console.warn(`[nfl-ingest] ${res.status} ${url} (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`fetch failed: ${url}`);
}

/** Stream a (optionally gzipped) CSV and hand each record to `onRecord`. */
async function streamCsv(
  url: string,
  onRecord: (r: CsvRecord) => void,
  columns?: readonly string[],
): Promise<number> {
  const res = await fetchOk(url);
  let stream: NodeJS.ReadableStream = Readable.fromWeb(res.body as any);
  if (url.endsWith(".gz")) stream = stream.pipe(createGunzip());
  stream.setEncoding("utf8");
  const reader = new CsvStreamReader(columns);
  let n = 0;
  for await (const chunk of stream as AsyncIterable<string>) {
    for (const rec of reader.push(chunk)) { onRecord(rec); n++; }
  }
  for (const rec of reader.end()) { onRecord(rec); n++; }
  return n;
}

async function fetchCsv(url: string): Promise<CsvRecord[]> {
  const res = await fetchOk(url);
  return parseCsv(await res.text());
}

async function ingestSeason(season: number, games: NflGameRow[]): Promise<{
  teamWeeks: NflTeamWeekRow[];
  playerWeeks: NflPlayerWeekRow[];
  injuries: NflInjuryRow[];
}> {
  const t0 = Date.now();
  const agg = new PbpAggregator();
  const plays = await streamCsv(URLS.pbp(season), (r) => agg.add(r), PBP_COLUMNS);
  const { teamWeeks, playerExtras, teamCounts } = agg.finish();
  console.log(`[nfl-ingest] ${season} pbp: ${plays} plays → ${teamWeeks.length} team-games (${Date.now() - t0} ms)`);

  const homeByGame = new Map(games.filter((g) => g.season === season).map((g) => [g.game_id, g.home_team]));

  let snapRecords: CsvRecord[] = [];
  try {
    snapRecords = await fetchCsv(URLS.snaps(season));
  } catch (e) {
    console.warn(`[nfl-ingest] ${season} snap counts unavailable: ${(e as Error).message}`);
  }
  const snaps = buildSnapIndex(snapRecords);

  const playerWeeks: NflPlayerWeekRow[] = [];
  let skipped = 0;
  await streamCsv(URLS.stats(season), (r) => {
    const row = toPlayerWeekRow(r, snaps, playerExtras, teamCounts, homeByGame);
    if (row) playerWeeks.push(row);
    else skipped++;
  });
  const snapMatched = playerWeeks.filter((p) => p.offense_pct !== null).length;
  console.log(
    `[nfl-ingest] ${season} players: ${playerWeeks.length} offensive player-games ` +
    `(snap match ${playerWeeks.length ? Math.round((100 * snapMatched) / playerWeeks.length) : 0}%, ` +
    `${skipped} non-offense rows skipped)`,
  );

  let injuries: NflInjuryRow[] = [];
  try {
    injuries = (await fetchCsv(URLS.injuries(season))).map(toInjuryRow).filter((r): r is NflInjuryRow => r !== null);
  } catch (e) {
    console.warn(`[nfl-ingest] ${season} injuries unavailable: ${(e as Error).message}`);
  }
  // Keep the latest report per player-week (the file can repeat entries).
  const injuryKey = (r: NflInjuryRow) => `${r.season}|${r.week}|${r.team}|${r.player_id}`;
  injuries = [...new Map(injuries.map((r) => [injuryKey(r), r])).values()];

  return { teamWeeks, playerWeeks, injuries };
}

async function upsertAll(
  client: any,
  table: string,
  rows: object[],
  onConflict: string,
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + BATCH), { onConflict });
    if (error) throw new Error(`${table} upsert failed at ${i}: ${error.message}`);
  }
  console.log(`[nfl-ingest] upserted ${rows.length} → ${table}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const creds = args.upload ? resolveServiceCredentials(process.argv.slice(2)) : null;
  if (args.upload && !creds) {
    console.log("[nfl-ingest] no credentials (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or pass --linked) — cache only");
  }
  const client = creds
    ? (await import("@supabase/supabase-js")).createClient(creds.url, creds.key, { auth: { persistSession: false } })
    : null;
  if (client) console.log(`[nfl-ingest] uploading to ${new URL(creds!.url).host}`);

  const startedAt = new Date().toISOString();
  const allGames = (await fetchCsv(URLS.games)).map(toGameRow).filter((g): g is NflGameRow => g !== null);
  const wanted = new Set(args.seasons);
  const games = allGames.filter((g) => wanted.has(g.season));
  await mkdir(args.cacheDir, { recursive: true });
  await writeFile(join(args.cacheDir, "games.json"), JSON.stringify(allGames));
  if (client) await upsertAll(client, "nfl_games", games, "game_id");

  const counts: Record<string, number> = { games: games.length, team_weeks: 0, player_weeks: 0, injuries: 0 };
  for (const season of args.seasons) {
    const { teamWeeks, playerWeeks, injuries } = await ingestSeason(season, allGames);
    const dir = join(args.cacheDir, String(season));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "team_week.json"), JSON.stringify(teamWeeks));
    await writeFile(join(dir, "player_week.json"), JSON.stringify(playerWeeks));
    await writeFile(join(dir, "injuries.json"), JSON.stringify(injuries));
    counts.team_weeks += teamWeeks.length;
    counts.player_weeks += playerWeeks.length;
    counts.injuries += injuries.length;
    if (client) {
      await upsertAll(client, "nfl_team_week_features", teamWeeks, "season,week,team");
      await upsertAll(client, "nfl_player_week", playerWeeks, "season,week,player_id");
      await upsertAll(client, "nfl_injuries", injuries, "season,week,team,player_id");
    }
  }

  if (client) {
    const { error } = await client.from("nfl_ingest_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      seasons: args.seasons,
      row_counts: counts,
    });
    if (error) console.warn(`[nfl-ingest] run log failed: ${error.message}`);
  }
  console.log(`[nfl-ingest] done ${JSON.stringify(counts)}`);
}

// Only run when executed directly (the module is also imported by backtests).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/nfl/ingest.ts")) {
  main().catch((e) => {
    console.error("[nfl-ingest] FAILED", e);
    process.exit(1);
  });
}
