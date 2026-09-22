/**
 * nfl-grade — settles NFL predictions, writing ONLY grading columns
 * (result, profit, closing line/price, CLV). Model outputs are immutable
 * (enforced by the nfl_prediction_freeze trigger).
 *
 * Two independent passes, one per product:
 *   1. nfl_game_edge_predictions    via _shared/nfl/game/grading.ts
 *   2. nfl_player_prop_predictions  via _shared/nfl/prop/grading.ts
 * They share raw data (final scores, box scores, closing snapshots) only.
 *
 * Source of truth: nflverse final scores / player stats loaded by the ingest
 * job (`grading_source = nflverse`). Rows whose game has no final yet are
 * left for the next run.
 *
 * Service role only. POST { days?: number } (look-back window, default 10).
 */

import { requireServiceRoleAccess } from "../_shared/premium-access.ts";
import type { NflGameRow } from "../_shared/nfl/data/types.ts";
import { normalizePlayerName } from "../_shared/nfl/data/aggregate.ts";
import { findOddsEvent, loadGame, loadGameQuotes, loadPropQuotes } from "../_shared/nfl/data/readers.ts";
import { gameClv, settleGame } from "../_shared/nfl/game/grading.ts";
import { propClv, settleProp } from "../_shared/nfl/prop/grading.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Db = any;

const FINAL_AFTER_MS = 4 * 3600e3; // a game is gradable 4 h after kickoff

async function ungraded(db: Db, table: string, days: number) {
  const { data, error } = await db.from(table).select("*").is("result", null)
    .lt("commence_time", new Date(Date.now() - FINAL_AFTER_MS).toISOString())
    .gte("commence_time", new Date(Date.now() - days * 86400e3).toISOString())
    .limit(5000);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function gradeGames(db: Db, days: number) {
  const rows = await ungraded(db, "nfl_game_edge_predictions", days);
  const games = new Map<string, NflGameRow | null>();
  const closing = new Map<string, Awaited<ReturnType<typeof loadGameQuotes>>>();
  let graded = 0, waiting = 0;
  for (const r of rows) {
    if (!games.has(r.game_id)) games.set(r.game_id, await loadGame(db, r.game_id));
    const g = games.get(r.game_id);
    if (!g || g.home_score === null || g.away_score === null) { waiting++; continue; }
    if (!closing.has(r.game_id)) closing.set(r.game_id, await loadGameQuotes(db, g, g.kickoff));
    const q = closing.get(r.game_id)!;
    const pred = { market_type: r.market_type, side: r.side, line: r.line === null ? null : Number(r.line), market_price: r.market_price, no_vig_probability: r.no_vig_probability === null ? null : Number(r.no_vig_probability) };
    const s = settleGame(pred, Number(g.home_score), Number(g.away_score));
    const c = gameClv(pred, r.market_type === "moneyline" ? q.moneyline : r.market_type === "spread" ? q.spread : q.total);
    const { error } = await db.from("nfl_game_edge_predictions").update({
      ...s, roi: s.profit_units, ...c, graded_at: new Date().toISOString(), grading_source: "nflverse",
    }).eq("id", r.id);
    if (error) console.error(`[nfl-grade] game ${r.id}: ${error.message}`);
    else graded++;
  }
  return { candidates: rows.length, graded, waiting_for_final: waiting };
}

const STAT_OF: Record<string, (p: Record<string, number>) => number> = {
  pass_yds: (p) => p.passing_yards, pass_att: (p) => p.pass_attempts, pass_cmp: (p) => p.completions,
  pass_tds: (p) => p.passing_tds, pass_ints: (p) => p.interceptions, rush_yds: (p) => p.rushing_yards,
  rush_att: (p) => p.carries, rec_yds: (p) => p.receiving_yards, receptions: (p) => p.receptions,
  targets: (p) => p.targets, anytime_td: (p) => (Number(p.rushing_tds) + Number(p.receiving_tds) > 0 ? 1 : 0),
  fg_made: (p) => p.fg_made, xp_made: (p) => p.pat_made, kicking_points: (p) => 3 * Number(p.fg_made) + Number(p.pat_made),
};

async function gradeProps(db: Db, days: number) {
  const rows = await ungraded(db, "nfl_player_prop_predictions", days);
  const games = new Map<string, NflGameRow | null>();
  const closing = new Map<string, Awaited<ReturnType<typeof loadPropQuotes>>>();
  let graded = 0, waiting = 0;
  for (const r of rows) {
    if (!games.has(r.game_id)) games.set(r.game_id, await loadGame(db, r.game_id));
    const g = games.get(r.game_id);
    if (!g || g.home_score === null) { waiting++; continue; }
    // Box score: present once the ingest job has loaded the week.
    const { data: stat } = await db.from("nfl_player_week").select("*")
      .eq("season", r.season).eq("week", r.week).eq("player_id", r.player_id).maybeSingle();
    const { count } = await db.from("nfl_player_week").select("player_id", { count: "exact", head: true })
      .eq("game_id", r.game_id);
    if (!count) { waiting++; continue; } // week not ingested yet — don't void prematurely
    const actual = stat ? Number(STAT_OF[r.prop_type]?.(stat) ?? NaN) : null;
    const pred = { side: r.side, line: Number(r.line), market_price: r.market_price, no_vig_probability: r.no_vig_probability === null ? null : Number(r.no_vig_probability) };
    const s = settleProp(pred, actual !== null && Number.isFinite(actual) ? actual : null);
    if (!closing.has(r.game_id)) {
      const eventId = await findOddsEvent(db, g);
      closing.set(r.game_id, eventId ? await loadPropQuotes(db, eventId, g.kickoff) : []);
    }
    const q = closing.get(r.game_id)!.find((x) => x.prop_type === r.prop_type && x.player_key === normalizePlayerName(r.player_name));
    const c = propClv(pred, q?.quote ? { line: q.quote.current.line ?? pred.line, over_price: q.quote.current.price_a, under_price: q.quote.current.price_b } : null);
    const { error } = await db.from("nfl_player_prop_predictions").update({
      ...s, roi: s.profit_units, actual_value: actual, ...c, graded_at: new Date().toISOString(), grading_source: "nflverse",
    }).eq("id", r.id);
    if (error) console.error(`[nfl-grade] prop ${r.id}: ${error.message}`);
    else graded++;
  }
  return { candidates: rows.length, graded, waiting_for_final: waiting };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const gate = await requireServiceRoleAccess(req, corsHeaders);
  if (!gate.ok) return gate.response;
  let days = 10;
  try {
    const body = await req.json();
    if (Number.isFinite(Number(body?.days))) days = Math.min(Math.max(Number(body.days), 1), 60);
  } catch { /* empty body is fine */ }
  const startedAt = Date.now();
  try {
    const game = await gradeGames(gate.admin, days);
    const prop = await gradeProps(gate.admin, days);
    console.log(`[nfl-grade] game=${JSON.stringify(game)} prop=${JSON.stringify(prop)} ms=${Date.now() - startedAt}`);
    return json({ ok: true, game_edge: game, player_prop_edge: prop });
  } catch (e) {
    console.error("[nfl-grade] failed", e);
    return json({ error: "NFL grading failed", reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
