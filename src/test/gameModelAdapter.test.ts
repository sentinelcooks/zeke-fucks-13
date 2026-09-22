import { describe, it, expect } from "vitest";
import {
  adaptGameModelResponse,
  buildGameModelRequest,
  marketKeyToModelMarket,
  gameModelFunctionFor,
  type GameModelResponse,
} from "@/lib/gameModelAdapter";

function model(overrides: Partial<GameModelResponse> = {}): GameModelResponse {
  return {
    model_version: "mlb_game_model.v1",
    market: "moneyline",
    sport: "mlb",
    matchup: {
      home: { name: "Detroit Tigers", abbreviation: "DET" },
      away: { name: "Colorado Rockies", abbreviation: "COL" },
      game_date: "2026-09-12",
    },
    home_score: 68,
    away_score: 32,
    predicted_margin: 1.4,
    verdict: "LEAN Detroit Tigers",
    factors: [
      { key: "runs_per_game", label: "Current-season run production", team1Score: 70, team2Score: 30, weight: 10.2, detail: "DET 4.40 vs COL 4.68." },
      { key: "starter_era", label: "Probable starter ERA", team1Score: 80, team2Score: 20, weight: 7.6, detail: "DET 1.59 vs COL 5.60." },
      { key: "sample_size", label: "Season sample size", team1Score: 50, team2Score: 50, weight: 0, detail: "140 games." },
    ],
    factor_count: 3,
    missing_inputs: ["platoon_ops"],
    data_coverage: 0.86,
    score_kind: "heuristic_score",
    ...overrides,
  };
}

describe("adaptGameModelResponse — orientation", () => {
  it("uses the home score when the home side is selected", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.team1_pct).toBe(68);
    expect(result.team1?.name).toBe("Detroit Tigers");
    expect(result.team2?.name).toBe("Colorado Rockies");
  });

  it("uses the away score and swaps the teams when the away side is selected", () => {
    const result = adaptGameModelResponse(model(), { side: "away" });
    expect(result.team1_pct).toBe(32);
    expect(result.team1?.name).toBe("Colorado Rockies");
    expect(result.team2?.name).toBe("Detroit Tigers");
  });

  it("mirrors every factor for the away side", () => {
    const home = adaptGameModelResponse(model(), { side: "home" });
    const away = adaptGameModelResponse(model(), { side: "away" });

    const homeRuns = home.factorBreakdown!.find((f) => f.name === "runs_per_game")!;
    const awayRuns = away.factorBreakdown!.find((f) => f.name === "runs_per_game")!;

    expect(homeRuns.team1Score).toBe(70);
    expect(awayRuns.team1Score).toBe(30);
    expect(awayRuns.team2Score).toBe(70);
  });

  it("keeps each factor's two sides summing to 100 in both orientations", () => {
    for (const side of ["home", "away"] as const) {
      const result = adaptGameModelResponse(model(), { side });
      for (const f of result.factorBreakdown!) {
        if (f.team1Score === undefined || f.team2Score === undefined) continue;
        expect(f.team1Score + f.team2Score).toBe(100);
      }
    }
  });

  it("preserves factor weights when flipping", () => {
    const away = adaptGameModelResponse(model(), { side: "away" });
    expect(away.factorBreakdown!.find((f) => f.name === "starter_era")!.weight).toBe(7.6);
  });
});

describe("adaptGameModelResponse — integrity", () => {
  it("never claims probability support", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.probability_supported).toBe(false);
    expect(result.score_kind).toBe("heuristic_score");
  });

  it("never recommends a stake, because the model is uncalibrated", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.decision?.conviction_tier).toBe("noBet");
    expect(result.decision?.recommended_units).toBe(0);
    expect(result.decision?.grade_explanation).toContain("not a calibrated win probability");
  });
});

describe("adaptGameModelResponse — decision", () => {
  it("leans to the selected side when it scores above 50", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.decision?.winning_side).toBe("team1");
    expect(result.decision?.winning_team_name).toBe("Detroit Tigers");
    expect(result.decision?.win_probability).toBe(68);
  });

  it("leans to the OPPONENT when the selected side scores below 50", () => {
    // Viewing the away side of the same game: 32 for them means 68 for home.
    const result = adaptGameModelResponse(model(), { side: "away" });
    expect(result.decision?.winning_side).toBe("team2");
    expect(result.decision?.winning_team_name).toBe("Detroit Tigers");
    expect(result.decision?.win_probability).toBe(68);
  });

  it("names the same favourite from either side of the game", () => {
    const home = adaptGameModelResponse(model(), { side: "home" });
    const away = adaptGameModelResponse(model(), { side: "away" });
    expect(home.decision?.winning_team_name).toBe(away.decision?.winning_team_name);
    expect(home.decision?.win_probability).toBe(away.decision?.win_probability);
  });

  it("leans to the requested total side when it scores above 50", () => {
    const total = model({ market: "total", side_score: 64, total_side: "over", home_score: null, away_score: null });
    const result = adaptGameModelResponse(total, { side: "home" });
    expect(result.decision?.winning_side).toBe("over");
    expect(result.decision?.win_probability).toBe(64);
  });

  it("flips to the other total side when the requested side scores below 50", () => {
    const total = model({ market: "total", side_score: 38, total_side: "over", home_score: null, away_score: null });
    const result = adaptGameModelResponse(total, { side: "home" });
    expect(result.decision?.winning_side).toBe("under");
    expect(result.decision?.win_probability).toBe(62);
  });

  it("emits no decision when the model returned no score", () => {
    const result = adaptGameModelResponse(model({ home_score: null, away_score: null }), { side: "home" });
    expect(result.decision).toBeNull();
  });

  it("states the uncalibrated caveat in the writeup", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.writeup).toContain("not a calibrated win probability");
  });

  it("names the inputs it had to exclude rather than hiding them", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.writeup).toContain("platoon_ops");
    expect(result.writeup).toContain("excluded rather than assumed neutral");
  });

  it("reports data coverage", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.writeup).toContain("86%");
  });

  it("builds a non-empty, data-grounded writeup", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.writeup!.length).toBeGreaterThan(80);
    // Must quote real numbers from the heaviest factor, not generic filler.
    expect(result.writeup).toContain("4.40");
    expect(result.writeup).toContain("current-season run production");
    expect(result.writeup).toContain("+1.4");
  });
});

describe("adaptGameModelResponse — summaries", () => {
  it("orders bullets by the weight the model gave them", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.factors![0]).toContain("4.40");
  });

  it("omits zero-weight context factors from the bullets", () => {
    const result = adaptGameModelResponse(model(), { side: "home" });
    expect(result.factors!.join(" ")).not.toContain("140 games");
  });

  it("ignores a dead-even factor even when it carries the most weight", () => {
    // Reproduces a real case: unavailable_minutes was missing, so renormalising
    // handed the whole availability budget to questionable_minutes — which read
    // 0 vs 0. It outweighed everything but said nothing, and led the writeup.
    const skewed = model({
      factors: [
        { key: "questionable_minutes", label: "Questionable minutes", team1Score: 50, team2Score: 50, weight: 14, detail: "Atlanta 0 minutes vs Connecticut 0." },
        { key: "net_rating", label: "Net rating", team1Score: 88, team2Score: 12, weight: 11.56, detail: "Atlanta net rating 6.3 vs Connecticut -11.2." },
      ],
    });
    const result = adaptGameModelResponse(skewed, { side: "home" });

    expect(result.writeup).toContain("net rating");
    expect(result.writeup).not.toContain("0 minutes");
    expect(result.factors![0]).toContain("6.3");
    expect(result.factors!.join(" ")).not.toContain("0 minutes");
  });
});

describe("adaptGameModelResponse — markets and errors", () => {
  it("uses side_score directly for a total, without flipping", () => {
    const total = model({
      market: "total",
      side_score: 64,
      total_side: "over",
      projected_total: 168.5,
      home_score: null,
      away_score: null,
    });
    const result = adaptGameModelResponse(total, { side: "away" });
    expect(result.team1_pct).toBe(64);
    expect(result.writeup).toContain("168.5");
  });

  it("surfaces an endpoint error with its reason", () => {
    const result = adaptGameModelResponse(
      { error: "Insufficient model inputs", reason: "no run-production data" },
      { side: "home" },
    );
    expect(result.error).toBe("Insufficient model inputs: no run-production data");
  });

  it("handles a null response", () => {
    expect(adaptGameModelResponse(null, { side: "home" }).error).toBeTruthy();
  });

  it("carries the odds event id through for matchup confirmation", () => {
    const result = adaptGameModelResponse(model(), { side: "home", oddsEventId: "evt-99" });
    expect(result.matchup?.oddsEventId).toBe("evt-99");
    expect(result.matchup?.confirmed).toBe(true);
  });
});

describe("buildGameModelRequest", () => {
  const base = {
    sport: "baseball_mlb",
    odds_home_team: "Detroit Tigers",
    odds_away_team: "Colorado Rockies",
    odds_commence_time: "2026-09-12T18:20:00Z",
  };

  it("routes an MLB moneyline on the home side", () => {
    const req = buildGameModelRequest({ ...base, team1: "Detroit Tigers", team2: "Colorado Rockies", bet_type: "moneyline" })!;
    expect(req.fn).toBe("mlb-game-model");
    expect(req.side).toBe("home");
    expect(req.payload.market).toBe("moneyline");
    expect(req.payload.homeTeam).toBe("Detroit Tigers");
  });

  it("sends the start time so a doubleheader resolves to the right game", () => {
    const req = buildGameModelRequest({ ...base, team1: "Detroit Tigers", bet_type: "moneyline" })!;
    expect(req.payload.gameDate).toBe("2026-09-12T18:20:00Z");
    expect(req.payload.gameStartTime).toBe("2026-09-12T18:20:00Z");
  });

  it("detects the away side from the selected team", () => {
    const req = buildGameModelRequest({ ...base, team1: "Colorado Rockies", team2: "Detroit Tigers", bet_type: "moneyline" })!;
    expect(req.side).toBe("away");
    // The payload still describes the game home-first.
    expect(req.payload.homeTeam).toBe("Detroit Tigers");
  });

  it("keeps a home spread as-is", () => {
    const req = buildGameModelRequest({ ...base, team1: "Detroit Tigers", bet_type: "spread", spread_line: -1.5 })!;
    expect(req.payload.homeSpread).toBe(-1.5);
  });

  it("negates an away spread into the home perspective", () => {
    const req = buildGameModelRequest({ ...base, team1: "Colorado Rockies", bet_type: "spread", spread_line: 1.5 })!;
    expect(req.side).toBe("away");
    expect(req.payload.homeSpread).toBe(-1.5);
  });

  it("passes the total line and side through for WNBA", () => {
    const req = buildGameModelRequest({
      sport: "basketball_wnba",
      odds_home_team: "Atlanta Dream",
      odds_away_team: "Connecticut Sun",
      team1: "Atlanta Dream",
      bet_type: "total",
      total_line: 163.5,
      over_under: "under",
    })!;
    expect(req.fn).toBe("wnba-game-model");
    expect(req.payload.totalLine).toBe(163.5);
    expect(req.payload.totalSide).toBe("under");
  });

  it("declines MLB totals, which the MLB endpoint does not serve yet", () => {
    expect(buildGameModelRequest({ ...base, team1: "Detroit Tigers", bet_type: "total", total_line: 8.5 })).toBeNull();
  });

  it("declines an unsupported sport so the caller can fall back", () => {
    expect(buildGameModelRequest({ ...base, sport: "icehockey_nhl", team1: "A", bet_type: "moneyline" })).toBeNull();
  });

  it("declines a spread with no line rather than guessing one", () => {
    expect(buildGameModelRequest({ ...base, team1: "Detroit Tigers", bet_type: "spread" })).toBeNull();
  });

  it("declines when the event teams are missing", () => {
    expect(buildGameModelRequest({ sport: "baseball_mlb", team1: "A", bet_type: "moneyline" })).toBeNull();
  });
});

describe("routing helpers", () => {
  it("maps UI market keys onto endpoint markets", () => {
    expect(marketKeyToModelMarket("h2h")).toBe("moneyline");
    expect(marketKeyToModelMarket("spreads")).toBe("spread");
    expect(marketKeyToModelMarket("totals")).toBe("total");
    expect(marketKeyToModelMarket("nonsense")).toBeNull();
  });

  it("routes each sport to its own function", () => {
    expect(gameModelFunctionFor("mlb")).toBe("mlb-game-model");
    expect(gameModelFunctionFor("baseball_mlb")).toBe("mlb-game-model");
    expect(gameModelFunctionFor("wnba")).toBe("wnba-game-model");
    expect(gameModelFunctionFor("basketball_wnba")).toBe("wnba-game-model");
  });

  it("returns null for a sport with no dedicated model yet", () => {
    expect(gameModelFunctionFor("nhl")).toBeNull();
    expect(gameModelFunctionFor("ufc")).toBeNull();
    expect(gameModelFunctionFor("")).toBeNull();
  });
});

describe("verified context passthrough", () => {
  // These fields were being dropped on the floor, which is why the report had
  // no Conditions, no coverage and no data check to render.
  const model = {
    matchup: {
      home: { name: "Cleveland Guardians", abbreviation: "CLE" },
      away: { name: "Chicago White Sox", abbreviation: "CWS" },
      game_date: "2026-09-15",
      venue: "Progressive Field",
      status: "Scheduled",
    },
    home_score: 61,
    away_score: 39,
    predicted_margin: 1.2,
    projected_total: 8.4,
    data_coverage: 0.76,
    missing_inputs: ["park_factor"],
    feed_missing: ["LINEUP_UNCONFIRMED"],
    factors: [],
    context: {
      park_run_factor: 1.02,
      weather: { temperatureF: 74, windMph: 9, windDirection: "out to CF", condition: "Clear", roofType: "Open" },
      home_lineup_confirmed: false,
      away_lineup_confirmed: true,
      home_starter: { name: "J. Collins", era: 4.08 },
      away_starter: { name: "M. Rivera", era: 3.41 },
      home_team_stats: { runsPerGame: 4.4, ops: 0.701, bullpenEra: 4.35 },
      away_team_stats: { runsPerGame: 5.1, ops: 0.782, bullpenEra: 3.88 },
    },
  };

  it("carries venue, coverage and input gaps through to the UI contract", () => {
    const result = adaptGameModelResponse(model, { side: "home" });
    expect(result.matchup?.venue).toBe("Progressive Field");
    expect(result.matchup?.status).toBe("Scheduled");
    expect(result.data_coverage).toBe(0.76);
    expect(result.predicted_total).toBe(8.4);
    expect(result.predicted_margin).toBe(1.2);
    expect(result.missing_inputs).toEqual(["park_factor"]);
    expect(result.feed_missing).toEqual(["LINEUP_UNCONFIRMED"]);
  });

  it("carries park, weather, starters and team stats", () => {
    const result = adaptGameModelResponse(model, { side: "away" });
    expect(result.context?.parkRunFactor).toBe(1.02);
    expect(result.context?.weather?.temperatureF).toBe(74);
    expect(result.context?.awayStarter).toEqual({ name: "M. Rivera", era: 3.41 });
    expect(result.context?.homeTeamStats?.bullpenEra).toBe(4.35);
    expect(result.context?.awayLineupConfirmed).toBe(true);
  });

  it("accepts a starter serialised as a bare name, from an older deployment", () => {
    const legacy = { ...model, context: { ...model.context, home_starter: "J. Collins", away_starter: null } };
    const result = adaptGameModelResponse(legacy, { side: "home" });
    expect(result.context?.homeStarter).toEqual({ name: "J. Collins", era: null });
    expect(result.context?.awayStarter).toBeNull();
  });

  it("leaves context null when the model sent none", () => {
    const result = adaptGameModelResponse({ ...model, context: undefined }, { side: "home" });
    expect(result.context).toBeNull();
    expect(result.missing_inputs).toEqual(["park_factor"]);
  });
});
