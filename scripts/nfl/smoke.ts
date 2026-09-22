/**
 * Local smoke test of BOTH NFL engines on real cached data (no Supabase).
 *
 *   node scripts/nfl/smoke.ts [season] [week]
 *
 * Game engine: every game of the week, priced at nflverse's current lines.
 * Prop engine: a WR receiving-yards, a QB passing-yards, an anytime-TD and a
 * K kicking-points prop, lines set near each player's recent average with
 * −110/−110 prices (illustrative prices — the real function uses snapshots).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NflGameRow, NflInjuryRow, NflPlayerWeekRow, NflTeamWeekRow } from "../../supabase/functions/_shared/nfl/data/types.ts";
import { aggregatePositionAllowed } from "../../supabase/functions/_shared/nfl/data/position_allowed.ts";
import { calculate_nfl_game_edge } from "../../supabase/functions/_shared/nfl/game/index.ts";
import { NFL_GAME_FITTED_WEIGHTS } from "../../supabase/functions/_shared/nfl/game/weights_fitted.ts";
import { calculate_nfl_player_prop_edge, type NflPropType } from "../../supabase/functions/_shared/nfl/prop/index.ts";
import { NFL_PROP_FITTED_WEIGHTS } from "../../supabase/functions/_shared/nfl/prop/weights_fitted.ts";

const CACHE = ".cache/nfl";
const load = async <T>(p: string) => JSON.parse(await readFile(p, "utf8")) as T;

const season = Number(process.argv[2] ?? 2026);
const week = Number(process.argv[3] ?? 3);

const games = (await load<NflGameRow[]>(join(CACHE, "games.json"))).filter((g) => g.season === season && g.week === week);
const tw = [...await load<NflTeamWeekRow[]>(join(CACHE, String(season - 1), "team_week.json")), ...await load<NflTeamWeekRow[]>(join(CACHE, String(season), "team_week.json"))];
const pw = [...await load<NflPlayerWeekRow[]>(join(CACHE, String(season - 1), "player_week.json")), ...await load<NflPlayerWeekRow[]>(join(CACHE, String(season), "player_week.json"))];
const inj = await load<NflInjuryRow[]>(join(CACHE, String(season), "injuries.json"));

const q = (line: number | null, a: number, b: number) => ({
  current: { line, price_a: a, price_b: b }, opening: null,
  best_price_a: null, best_book_a: null, best_price_b: null, best_book_b: null, books: 6, snapshot_at: null,
});

console.log(`\n=== NFL GAME EDGE — ${season} week ${week} (${games.length} games, ${NFL_GAME_FITTED_WEIGHTS.version}) ===`);
for (const g of games) {
  if (g.spread_line === null || g.total_line === null) continue;
  const out = calculate_nfl_game_edge({
    features: { game: g, teamWeeks: tw, playerWeeks: pw, injuries: inj, weather: { temp: g.temp, wind: g.wind, precip_prob: null, roof: g.roof, source: "none" }, movement: null },
    markets: {
      moneyline: g.home_moneyline && g.away_moneyline ? q(null, g.home_moneyline, g.away_moneyline) : null,
      spread: q(-g.spread_line, g.home_spread_odds ?? -110, g.away_spread_odds ?? -110),
      total: q(g.total_line, g.over_odds ?? -110, g.under_odds ?? -110),
    },
    weights: NFL_GAME_FITTED_WEIGHTS,
  });
  const p = out.projections;
  const pick = (m: string) => out.results.filter((r) => r.market_type === m).sort((a, b) => b.edge_percentage - a.edge_percentage)[0];
  const fmt = (r: ReturnType<typeof pick>) => r ? `${r.selection.padEnd(12)} model ${(r.model_probability * 100).toFixed(1)}% vs no-vig ${(r.no_vig_probability * 100).toFixed(1)}% edge ${r.edge_percentage.toFixed(1)} conf ${r.confidence} ${r.status}` : "—";
  console.log(`${g.away_team}@${g.home_team}  P(home) ${(p.p_home_win * 100).toFixed(1)}%  margin ${p.projected_margin} (mkt ${-(-g.spread_line)})  total ${p.projected_total} (mkt ${g.total_line})`);
  for (const m of ["moneyline", "spread", "total"]) console.log(`    ${m.padEnd(9)} ${fmt(pick(m))}`);
}

// ─── Props ──
const g0 = games[0];
const allowed = aggregatePositionAllowed(pw);
function propFor(position: string, stat: NflPropType) {
  // Most-used player at the position among this week's teams.
  const teams = new Set(games.flatMap((g) => [g.home_team, g.away_team]));
  const cur = pw.filter((r) => r.season === season && r.position === position && teams.has(r.team));
  const vol = new Map<string, number>();
  for (const r of cur) vol.set(r.player_id, (vol.get(r.player_id) ?? 0) + r.targets + r.pass_attempts + r.carries + r.fg_att + r.pat_att);
  const id = [...vol.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const player = cur.find((r) => r.player_id === id)!;
  const game = games.find((g) => g.home_team === player.team || g.away_team === player.team) ?? g0;
  const isHome = game.home_team === player.team;
  const rows = pw.filter((r) => r.player_id === id);
  const recent = rows.filter((r) => r.season === season).map((r) => ({
    pass_yds: r.passing_yards, rec_yds: r.receiving_yards, kicking_points: 3 * r.fg_made + r.pat_made, anytime_td: 0.5,
  } as Record<string, number>)[stat] ?? 0);
  const avg = recent.reduce((a, b) => a + b, 0) / Math.max(recent.length, 1);
  const line = stat === "anytime_td" ? 0.5 : Math.floor(avg) + 0.5;
  const out = calculate_nfl_player_prop_edge({
    features: {
      player: { player_id: id, player_name: player.player_name, position, team: player.team },
      game: { game_id: game.game_id, season, week, team: player.team, opponent: isHome ? game.away_team : game.home_team, is_home: isHome,
        roof: game.roof, temp: game.temp, wind: game.wind, precip_prob: null, weather_source: "none",
        team_rest: isHome ? game.home_rest : game.away_rest, opp_rest: isHome ? game.away_rest : game.home_rest },
      market_context: { team_spread: game.spread_line === null ? null : isHome ? -game.spread_line : game.spread_line, game_total: game.total_line },
      teamPlayerRows: pw.filter((r) => r.team === player.team),
      playerRows: rows,
      teamWeeks: tw,
      positionAllowed: allowed.filter((a) => a.position === position),
      injuries: inj.filter((i) => i.season === season && i.week === week && i.team === player.team),
    },
    prop_type: stat, line,
    market: { line, over_price: stat === "anytime_td" ? 120 : -110, under_price: stat === "anytime_td" ? null : -110,
      best_over_price: null, best_over_book: null, best_under_price: null, best_under_book: null,
      opening_line: line, opening_over_price: null, opening_under_price: null, books: 5 },
    weights: NFL_PROP_FITTED_WEIGHTS,
  });
  const over = out.results.find((r) => r.side === "over")!;
  console.log(`\n${player.player_name} (${position}, ${player.team}) ${stat} line ${line} — season avg ${avg.toFixed(1)} over ${recent.length} g`);
  console.log(`  projection ${over.projection} median ${over.median_projection} sd ${over.std_dev} p10–p90 ${over.p10}–${over.p90} [${over.distribution}]`);
  console.log(`  P(over) ${(over.over_probability * 100).toFixed(1)}%  P(under) ${(over.under_probability * 100).toFixed(1)}%  P(push) ${(over.push_probability * 100).toFixed(1)}%  sum ${(over.over_probability + over.under_probability + over.push_probability).toFixed(4)}`);
  const best = out.results.sort((a, b) => (b.edge_percentage ?? -99) - (a.edge_percentage ?? -99))[0];
  console.log(`  best side ${best.side}: model ${(best.model_probability * 100).toFixed(1)}% no-vig ${best.no_vig_probability === null ? "—" : (best.no_vig_probability * 100).toFixed(1) + "%"} (${best.no_vig_method}) edge ${best.edge_percentage?.toFixed(1)} EV ${best.expected_value?.toFixed(1)} prop_conf ${best.confidence} → ${best.status}${best.no_play_reasons.length ? ` (${best.no_play_reasons.join("; ")})` : ""}`);
  console.log(`  role: snap ${(over.expected_snap_percentage * 100).toFixed(0)}% targets ${over.role_projection.targets} carries ${over.role_projection.carries} att ${over.role_projection.pass_attempts} team plays ${over.role_projection.team_plays}`);
}

console.log(`\n=== NFL PLAYER PROP EDGE — ${NFL_PROP_FITTED_WEIGHTS.version} ===`);
propFor("WR", "rec_yds");
propFor("QB", "pass_yds");
propFor("RB", "anytime_td");
propFor("K", "kicking_points");
