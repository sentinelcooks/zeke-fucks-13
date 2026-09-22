import { describe, expect, it } from "vitest";
import {
  getEspnConfig,
  getStatValue,
  type GameRow,
} from "../../../supabase/functions/_shared/espn_player_data";
import {
  buildPropAnalysisBase,
  isPropAnalysisFailure,
  resolvePropPlayer,
} from "../../../supabase/functions/_shared/prop_analysis_base";
import {
  calculateMlbPropConfidence,
  fetchVerifiedMlbGameContext,
  type MlbContextData,
} from "../../../supabase/functions/_shared/mlb_prop_model";
import { isMlbPitcherPosition, normalizeMlbPropType } from "../../../supabase/functions/_shared/prop_normalization";
import { fetchWnbaLineupContext, scoreWnbaPlayerProp } from "../../../supabase/functions/_shared/wnba_model";
import { fetchWnbaTeamContext } from "../../../supabase/functions/_shared/wnba_game_context";

/**
 * These mirror what `mlb-prop-model/index.ts` and `wnba-prop-model/index.ts`
 * do, minus the CORS and premium-gate wrapper that only exists under Deno.
 * They are the closest thing to an integration test available without a Deno
 * toolchain, so they assert that the whole chain — ESPN lookup, game log,
 * analysis assembly, scoring — produces a usable number against live data.
 *
 * Assertions stay structural. Asserting a specific score against a live feed
 * would fail every time a player has a good week.
 */

describe("MLB prop model, live", () => {
  it("scores a batter prop end to end", async () => {
    const cfg = getEspnConfig("mlb");
    const resolved = await resolvePropPlayer("Steven Kwan", cfg);
    expect(resolved).not.toBeNull();

    const role = isMlbPitcherPosition(resolved!.player.position) ? "pitcher" : "batter";
    expect(role).toBe("batter");
    const propType = normalizeMlbPropType("hits", role);

    const base = await buildPropAnalysisBase({
      cfg,
      playerId: resolved!.playerId,
      player: resolved!.player,
      request: { playerName: "Steven Kwan", propType, line: 0.5, overUnder: "over", opponent: null },
      usePrevSeasonWhenEmpty: true,
      minCurrentSample: 3,
      insufficientSampleError: "insufficient",
    });
    if (isPropAnalysisFailure(base)) throw new Error(`base failed: ${base.error}`);

    expect(base.analysisGames.length).toBeGreaterThan(20);
    expect(base.result.season_hit_rate.total).toBeGreaterThan(20);
    expect(base.result.game_log.length).toBe(base.analysisGames.length);

    let context: MlbContextData = {};
    try {
      context = await fetchVerifiedMlbGameContext({
        teamAbbr: base.player.team_abbr,
        opponentAbbr: base.opponentAbbr,
        playerName: base.player.full_name,
        isPitcher: false,
        gameDate: base.nextGame?.date || null,
      });
    } catch (error) {
      console.warn("verified context unavailable:", (error as Error).message);
    }
    base.result.mlb_context = context;

    const score = await calculateMlbPropConfidence(base.result);
    console.log(
      `[mlb] ${base.player.full_name} ${propType} o0.5 → ${score.confidence} ` +
      `(${score.factors.length} factors, shrink ${score.dataQuality?.shrinkFactor})`,
    );

    expect(Number.isFinite(score.confidence)).toBe(true);
    expect(score.factors.length).toBeGreaterThan(3);
    // Every factor must carry the evidence it scored on — a factor with no
    // detail is exactly the "blank or generic output" the project forbids.
    for (const factor of score.factors) {
      expect(factor.detail, `${factor.name} has no detail`).toBeTruthy();
    }
  });

  it("refuses to score a pitcher who is not a confirmed probable starter", async () => {
    const cfg = getEspnConfig("mlb");
    const resolved = await resolvePropPlayer("Tarik Skubal", cfg);
    expect(resolved).not.toBeNull();
    expect(isMlbPitcherPosition(resolved!.player.position)).toBe(true);

    const propType = normalizeMlbPropType("strikeouts", "pitcher");
    const base = await buildPropAnalysisBase({
      cfg,
      playerId: resolved!.playerId,
      player: resolved!.player,
      request: { playerName: "Tarik Skubal", propType, line: 5.5, overUnder: "over", opponent: null },
      usePrevSeasonWhenEmpty: true,
      minCurrentSample: 3,
      insufficientSampleError: "insufficient",
    });
    if (isPropAnalysisFailure(base)) throw new Error(`base failed: ${base.error}`);

    const score = await calculateMlbPropConfidence(base.result);
    console.log(`[mlb] ${base.player.full_name} ${propType} o5.5 → ${score.confidence}`);

    // Either it resolved a verified start and scored, or it withheld a score.
    // What must never happen is a mid-range number with no verified context
    // behind it, which would read to the user as a real read on the game.
    if (score.confidence === 0) {
      expect(score.dataQuality?.shrinkFactor).toBe(0);
      expect(score.reasoning.join(" ")).toMatch(/incomplete|Missing/i);
    } else {
      expect(score.confidence).toBeGreaterThan(0);
      expect(score.factors.length).toBeGreaterThan(3);
    }
  });
});

describe("WNBA prop model, live", () => {
  it("scores a points prop end to end", async () => {
    const cfg = getEspnConfig("wnba");
    const resolved = await resolvePropPlayer("Caitlin Clark", cfg);
    expect(resolved).not.toBeNull();

    const base = await buildPropAnalysisBase({
      cfg,
      playerId: resolved!.playerId,
      player: resolved!.player,
      request: { playerName: "Caitlin Clark", propType: "points", line: 18.5, overUnder: "over", opponent: null },
      usePrevSeasonWhenEmpty: false,
      minCurrentSample: 5,
      insufficientSampleError: "insufficient",
    });
    if (isPropAnalysisFailure(base)) throw new Error(`base failed: ${base.error}`);

    expect(base.analysisGames.length).toBeGreaterThan(5);

    const lineup = await fetchWnbaLineupContext(
      base.nextGame?.event_id ?? null,
      base.player.team_abbr,
      base.player.full_name,
    );

    let teamContext = null;
    let opponentContext = null;
    if (base.opponentAbbr) {
      const targetDate = base.nextGame?.date_time || new Date().toISOString();
      [teamContext, opponentContext] = await Promise.all([
        fetchWnbaTeamContext(base.player.team_abbr, targetDate),
        fetchWnbaTeamContext(base.opponentAbbr, targetDate),
      ]);
    }

    const toGame = (game: GameRow) => ({
      date: game.date,
      value: getStatValue(game, "points"),
      minutes: Number.isFinite(game.min) ? game.min : null,
      isHome: game.isHome,
      opponent: game.opponent,
    });

    const score = scoreWnbaPlayerProp({
      games: base.analysisGames.map(toGame),
      previousSeasonGames: base.prevSeasonGames.map(toGame),
      line: 18.5,
      direction: "over",
      propType: "points",
      opponent: base.opponentAbbr || null,
      nextGameDate: base.nextGame?.date_time ?? null,
      isHome: typeof base.nextGame?.is_home === "boolean" ? base.nextGame.is_home : null,
      lineup,
      playerAvailability: null,
      injurySourceAvailable: base.teamInjuryReport.sourceAvailable,
      teamEfficiency: teamContext?.efficiency ?? null,
      opponentEfficiency: opponentContext?.efficiency ?? null,
      targetVenueCity: base.nextGame?.venue_city ?? null,
      lastVenueCity: teamContext?.metrics.lastVenueCity ?? null,
    });

    console.log(
      `[wnba] ${base.player.full_name} points o18.5 → ${score.score} ${score.verdict} ` +
      `(${score.factors.length} factors)`,
    );

    expect(Number.isFinite(score.score)).toBe(true);
    expect(score.factors.length).toBeGreaterThan(0);
    for (const factor of score.factors) {
      expect(factor.detail, `${factor.name} has no detail`).toBeTruthy();
    }
  });
});
