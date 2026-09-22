/**
 * nfl-admin-analytics — read-only admin analytics for the two NFL products.
 *
 * Game-edge and player-prop metrics are computed from their OWN tables in
 * separate actions and are never combined in one response section.
 *
 * POST { password, action, model_version?, from?, to? }
 *   action = "versions"      model versions seen per engine (predictions + backtests)
 *   action = "game_summary"  NFL GAME EDGE: ML / spread / total
 *   action = "prop_summary"  NFL PLAYER PROP EDGE: by position / prop type / edge / confidence
 *
 * Auth: ADMIN_SECRET_PASSWORD, same as admin-onboarding.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Db = any;

async function fetchAll(db: Db, table: string, cols: string, version: string | null, from: string | null, to: string | null): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; ; i += 1000) {
    let q = db.from(table).select(cols);
    if (version) q = q.eq("model_version", version);
    if (from) q = q.gte("commence_time", from);
    if (to) q = q.lt("commence_time", to);
    const { data, error } = await q.order("commence_time", { ascending: false }).range(i, i + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e4) / 1e4 : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Performance of graded picks. `mode = "published"` counts real PLAYs;
 * `mode = "forward"` counts PLAYs + shadow picks (the forward test).
 */
function perf(rows: Row[], mode: "published" | "forward" = "published") {
  const plays = rows.filter((r) => r.status === "PLAY" || (mode === "forward" && r.shadow_play));
  const graded = plays.filter((r) => r.result && r.result !== "void");
  const wins = graded.filter((r) => r.result === "win").length;
  const losses = graded.filter((r) => r.result === "loss").length;
  const profit = graded.reduce((a, r) => a + Number(r.profit_units ?? 0), 0);
  const clvs = plays.map((r) => num(r.clv)).filter((x): x is number => x !== null);
  return {
    predictions: rows.length,
    plays: plays.length,
    graded: graded.length,
    record: `${wins}-${losses}-${graded.length - wins - losses}`,
    win_rate: wins + losses ? Math.round((wins / (wins + losses)) * 1e4) / 1e4 : null,
    profit_units: Math.round(profit * 100) / 100,
    roi: graded.length ? Math.round((profit / graded.length) * 1e4) / 1e4 : null,
    avg_edge: avg(plays.map((r) => Number(r.edge_percentage ?? 0))),
    avg_ev: avg(plays.map((r) => Number(r.expected_value ?? 0))),
    avg_confidence: avg(plays.map((r) => Number(r.confidence ?? 0))),
    avg_clv: avg(clvs),
    clv_coverage: plays.length ? Math.round((clvs.length / plays.length) * 1e4) / 1e4 : null,
    positive_clv_rate: clvs.length ? Math.round((clvs.filter((c) => c > 0).length / clvs.length) * 1e4) / 1e4 : null,
  };
}

function groupPerf(rows: Row[], key: (r: Row) => string, mode: "published" | "forward" = "published") {
  const g = new Map<string, Row[]>();
  for (const r of rows) g.set(key(r), [...(g.get(key(r)) ?? []), r]);
  return Object.fromEntries([...g.entries()].sort().map(([k, v]) => [k, perf(v, mode)]));
}

/** First qualifying scan per bet identity — repeated hourly scans are not extra bets. */
function firstPicks(rows: Row[], identity: (r: Row) => string): Row[] {
  const seen = new Map<string, Row>();
  for (const r of rows) {
    if (!(r.status === "PLAY" || r.shadow_play)) continue;
    const k = `${r.model_version}|${identity(r)}`;
    const prev = seen.get(k);
    if (!prev || String(r.timestamp) < String(prev.timestamp)) seen.set(k, r);
  }
  return [...seen.values()];
}

const PROMOTION = { min_bets: 150 };

const edgeBucket = (r: Row) => {
  const e = Number(r.edge_percentage ?? 0);
  return e < 3 ? "<3%" : e < 5 ? "3-5%" : e < 8 ? "5-8%" : "8%+";
};
const confBucket = (r: Row) => {
  const c = Number(r.confidence ?? 0);
  return c < 60 ? "<60" : c < 65 ? "60-65" : c < 70 ? "65-70" : "70+";
};

async function latestBacktest(db: Db, table: string, version: string | null) {
  let q = db.from(table).select("model_version, seasons, market_source, metrics, created_at").order("created_at", { ascending: false }).limit(1);
  if (version) q = q.eq("model_version", version);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Row;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const secret = Deno.env.get("ADMIN_SECRET_PASSWORD");
  if (!secret || body.password !== secret) return json({ error: "Unauthorized" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const version = typeof body.model_version === "string" && body.model_version ? body.model_version : null;
  const from = typeof body.from === "string" ? body.from : null;
  const to = typeof body.to === "string" ? body.to : null;

  try {
    if (body.action === "versions") {
      const distinct = async (table: string) => {
        const { data } = await db.from(table).select("model_version").limit(10000);
        return [...new Set((data ?? []).map((r: Row) => r.model_version))].sort();
      };
      return json({
        game_edge: [...new Set([...(await distinct("nfl_game_edge_predictions")), ...(await distinct("nfl_game_backtest_runs"))])],
        player_prop_edge: [...new Set([...(await distinct("nfl_player_prop_predictions")), ...(await distinct("nfl_player_prop_backtest_runs"))])],
      });
    }

    if (body.action === "game_summary") {
      const rows = await fetchAll(db, "nfl_game_edge_predictions",
        "model_version, game_id, market_type, status, shadow_play, result, profit_units, edge_percentage, expected_value, confidence, clv, commence_time, timestamp",
        version, from, to);
      const forwardRows = firstPicks(rows, (r) => `${r.game_id}|${r.market_type}`);
      return json({
        engine: "nfl_game_edge",
        model_version: version,
        forward_test: {
          promotion_rule: `>= ${PROMOTION.min_bets} graded picks, ROI > 0 and avg CLV > 0 per market`,
          overall: perf(forwardRows, "forward"),
          by_market: groupPerf(forwardRows, (r) => r.market_type, "forward"),
        },
        overall: perf(rows),
        by_market: groupPerf(rows, (r) => r.market_type),
        by_edge_bucket: groupPerf(rows.filter((r) => r.status === "PLAY"), edgeBucket),
        by_confidence_bucket: groupPerf(rows.filter((r) => r.status === "PLAY"), confBucket),
        backtest: await latestBacktest(db, "nfl_game_backtest_runs", version),
      });
    }

    if (body.action === "prop_summary") {
      const rows = await fetchAll(db, "nfl_player_prop_predictions",
        "model_version, game_id, player_id, prop_type, position, status, shadow_play, result, profit_units, edge_percentage, expected_value, confidence, clv, projection, actual_value, commence_time, timestamp",
        version, from, to);
      const forwardRows = firstPicks(rows, (r) => `${r.game_id}|${r.player_id}|${r.prop_type}`);
      const withActual = rows.filter((r) => r.actual_value !== null && r.actual_value !== undefined);
      const errs = withActual.map((r) => Number(r.projection) - Number(r.actual_value));
      return json({
        engine: "nfl_player_prop_edge",
        model_version: version,
        forward_test: {
          promotion_rule: `>= ${PROMOTION.min_bets} graded picks, ROI > 0 and avg CLV > 0 per prop type`,
          overall: perf(forwardRows, "forward"),
          by_prop_type: groupPerf(forwardRows, (r) => r.prop_type, "forward"),
          by_position: groupPerf(forwardRows, (r) => r.position, "forward"),
        },
        overall: perf(rows),
        projection_accuracy: {
          graded_rows: withActual.length,
          mae: avg(errs.map(Math.abs)),
          rmse: errs.length ? Math.round(Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length) * 1e4) / 1e4 : null,
        },
        by_position: groupPerf(rows, (r) => r.position),
        by_prop_type: groupPerf(rows, (r) => r.prop_type),
        by_edge_bucket: groupPerf(rows.filter((r) => r.status === "PLAY"), edgeBucket),
        by_confidence_bucket: groupPerf(rows.filter((r) => r.status === "PLAY"), confBucket),
        backtest: await latestBacktest(db, "nfl_player_prop_backtest_runs", version),
      });
    }

    return json({ error: "Unknown action", supported: ["versions", "game_summary", "prop_summary"] }, 400);
  } catch (e) {
    console.error("[nfl-admin-analytics] failed", e);
    return json({ error: "NFL analytics failed", reason: e instanceof Error ? e.message : String(e) }, 500);
  }
});
