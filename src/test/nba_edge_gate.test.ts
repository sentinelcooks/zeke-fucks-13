import { describe, expect, it } from "vitest";
import {
  evaluateNbaEdgeGate,
  selectNbaEdgePool,
  type ScoredPlay,
} from "../../supabase/functions/_shared/edge_scoring";
import { buildDailyPickRow } from "../../supabase/functions/_shared/daily_pick_rows";

function makePlay(overrides: Partial<ScoredPlay> = {}): ScoredPlay {
  const confidence = overrides.confidence ?? 0.72;
  const implied = overrides.implied_prob ?? 0.6553;
  const edge = overrides.edge ?? confidence - implied;
  const evPct = overrides.ev_pct ?? 10.48;
  const quality = overrides.quality_score ?? confidence * (1 + Math.max(0, edge));

  return {
    sport: "nba",
    bet_type: "prop",
    player_name: "Mike Conley",
    team: "MIN",
    opponent: "DEN",
    home_team: "DEN",
    away_team: "MIN",
    prop_type: "three_pointers_made",
    line: 1.5,
    direction: "under",
    odds: -190,
    odds_opp: null,
    projected_prob: confidence,
    implied_prob: implied,
    raw_implied_prob: implied,
    edge,
    ev_pct: evPct,
    confidence,
    raw_confidence: confidence,
    reliability: 0.75,
    score: edge * confidence,
    quality_score: quality,
    verdict: "Lean",
    reasoning: "Analyzer-backed canonical pick.",
    event_id: "evt_1",
    commence_time: "2026-05-06T23:00:00Z",
    game_date: "2026-05-06",
    model_diagnostics: {
      canonical_confidence: Math.round(confidence * 100),
      canonical_verdict: "LEAN",
      bookCount: 5,
      marketDataQuality: "medium",
      marketDepth: "normal",
      opponentResolutionStatus: "resolved",
      ...(overrides.model_diagnostics ?? {}),
    },
    ...overrides,
  };
}

describe("NBA edge gate heavy-juice handling", () => {
  it("keeps 72 LEAN with positive EV, medium market, and -190 odds gate eligible", () => {
    const gate = evaluateNbaEdgeGate(makePlay());

    expect(gate.ok).toBe(true);
    expect(gate.reasons).not.toContain("heavy_juice");
    expect(gate.heavyJuiceAction).toBe("penalty");
    expect(gate.inputs.canonical_confidence).toBe(72);
    expect(gate.inputs.canonical_verdict).toBe("LEAN");
  });

  it("keeps 85 STRONG with positive EV, medium market, and -190 odds gate eligible", () => {
    const gate = evaluateNbaEdgeGate(makePlay({
      confidence: 0.85,
      projected_prob: 0.85,
      edge: 0.18,
      ev_pct: 30,
      quality_score: 1.1,
      verdict: "Strong",
      model_diagnostics: {
        canonical_confidence: 85,
        canonical_verdict: "STRONG",
        bookCount: 5,
        marketDataQuality: "medium",
        marketDepth: "normal",
        opponentResolutionStatus: "resolved",
      },
    }));

    expect(gate.ok).toBe(true);
    expect(gate.reasons).not.toContain("heavy_juice");
    expect(gate.heavyJuiceAction).toBe("penalty");
  });

  it("blocks PASS and RISKY canonical verdicts from edge", () => {
    const passGate = evaluateNbaEdgeGate(makePlay({
      verdict: "Pass",
      model_diagnostics: {
        canonical_confidence: 75,
        canonical_verdict: "PASS",
        bookCount: 5,
        marketDataQuality: "medium",
        marketDepth: "normal",
        opponentResolutionStatus: "resolved",
      },
    }));
    const riskyGate = evaluateNbaEdgeGate(makePlay({
      model_diagnostics: {
        canonical_confidence: 75,
        canonical_verdict: "RISKY",
        bookCount: 5,
        marketDataQuality: "medium",
        marketDepth: "normal",
        opponentResolutionStatus: "resolved",
      },
    }));

    expect(passGate.ok).toBe(false);
    expect(passGate.reasons).toContain("pass_verdict");
    expect(riskyGate.ok).toBe(false);
    expect(riskyGate.reasons).toContain("risky_verdict");
  });

  it("blocks negative EV and negative model edge from edge", () => {
    const gate = evaluateNbaEdgeGate(makePlay({
      edge: -0.01,
      ev_pct: -2,
    }));

    expect(gate.ok).toBe(false);
    expect(gate.reasons).toContain("negative_model_edge");
    expect(gate.reasons).toContain("negative_ev");
  });

  it("hard-blocks true extreme juice", () => {
    const gate = evaluateNbaEdgeGate(makePlay({
      odds: -250,
      confidence: 0.72,
      projected_prob: 0.72,
      edge: 0.01,
      ev_pct: 0.8,
    }));

    expect(gate.ok).toBe(false);
    expect(gate.hardSafetyFail).toBe(true);
    expect(gate.reasons).toContain("extreme_juice");
    expect(gate.heavyJuiceAction).toBe("hard_block");
  });
});

describe("NBA edge pool diagnostics", () => {
  it("separates gate eligibility from final edge-pool selection", () => {
    const selected = makePlay({
      player_name: "Anthony Edwards",
      confidence: 0.85,
      projected_prob: 0.85,
      edge: 0.16,
      ev_pct: 28,
      quality_score: 1.2,
      verdict: "Strong",
      model_diagnostics: {
        canonical_confidence: 85,
        canonical_verdict: "STRONG",
        bookCount: 5,
        marketDataQuality: "medium",
        marketDepth: "normal",
        opponentResolutionStatus: "resolved",
      },
    });
    const daily = makePlay({
      player_name: "Mike Conley",
      quality_score: 0.7,
    });

    const pool = selectNbaEdgePool([selected, daily], 1);
    const dailyDiag = pool.poolDiagnostics.get("nba|Mike Conley|three_pointers_made|under|1.5");

    expect(pool.gateCache.get("nba|Mike Conley|three_pointers_made|under|1.5")?.ok).toBe(true);
    expect(dailyDiag).toMatchObject({
      rank: 2,
      selected: false,
      selectionReason: "lower_rank_than_selected_picks",
    });
  });
});

describe("NBA daily pick canonical diagnostics", () => {
  it("populates canonical and stored confidence/verdict diagnostics", () => {
    const row = buildDailyPickRow({
      pickDate: "2026-05-06",
      play: makePlay(),
      tier: "edge",
      sourceFunction: "slate-scanner-nba",
      modelUsed: "nba-api/analyze",
    });

    expect(row.model_diagnostics).toMatchObject({
      canonical_confidence: 72,
      canonical_verdict: "LEAN",
      stored_confidence: 72,
      stored_verdict: "LEAN",
    });
  });
});
