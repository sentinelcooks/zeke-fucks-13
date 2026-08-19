import { describe, expect, it } from "vitest";
import {
  buildGenericQueueFinalization,
  buildNbaQueueFinalization,
  buildWnbaQueueFinalization,
} from "../../supabase/functions/_shared/nba_queue_finalization";
import type { ScoredPlay } from "../../supabase/functions/_shared/edge_scoring";

function makePlay(overrides: Partial<ScoredPlay> = {}): ScoredPlay {
  const confidence = overrides.confidence ?? 0.73;
  const implied = overrides.implied_prob ?? 0.61;
  const edge = overrides.edge ?? confidence - implied;
  const evPct = overrides.ev_pct ?? 12;
  const quality = overrides.quality_score ?? confidence * (1 + Math.max(0, edge));

  return {
    sport: "nba",
    bet_type: "prop",
    player_name: "Jarrett Allen",
    team: "CLE",
    opponent: "BOS",
    home_team: "BOS",
    away_team: "CLE",
    prop_type: "blocks",
    line: 1.5,
    direction: "under",
    odds: -120,
    odds_opp: null,
    projected_prob: confidence,
    implied_prob: implied,
    raw_implied_prob: implied,
    edge,
    ev_pct: evPct,
    confidence,
    raw_confidence: confidence,
    reliability: 0.4,
    score: edge * confidence,
    quality_score: quality,
    verdict: "Strong",
    reasoning: "Analyzer-backed queue result.",
    event_id: "evt_queue",
    commence_time: "2026-05-07T23:00:00Z",
    game_date: "2026-05-07",
    ...overrides,
    model_diagnostics: {
      analyzer_skipped_reason: "analyzer_call_budget_exceeded",
      canonical_confidence: Math.round(confidence * 100),
      canonical_verdict: "STRONG",
      bookCount: 5,
      marketDataQuality: "medium",
      marketDepth: "normal",
      opponentResolutionStatus: "resolved",
      score_kind: "calibrated_probability",
      calibration_status: "validated",
      calibration_applied: true,
      probability_supported: true,
      edge_evidence_validated: true,
      evaluation_status: "validated",
      ...(overrides.model_diagnostics ?? {}),
    },
  };
}

describe("NBA queue finalization", () => {
  it("refreshes an 82 STRONG gate-failed row to hit_rate 82 without promotion", () => {
    const result = buildNbaQueueFinalization({
      finalized: makePlay({
        player_name: "Jaylin Williams",
        prop_type: "3-pointers",
        direction: "over",
        line: 0.5,
        confidence: 0.82,
        projected_prob: 0.82,
        edge: 0.12,
        ev_pct: 20,
        model_diagnostics: {
          canonical_confidence: 82,
          canonical_verdict: "STRONG",
          marketDataQuality: "low",
        },
      }),
      baseDiagnostics: {
        analyzer_skipped_reason: "analyzer_call_budget_exceeded",
      },
      currentEdgeCount: 0,
      edgeCap: 5,
      now: new Date("2026-05-07T12:00:00Z"),
    });

    expect(result.hitRate).toBe(82);
    expect(result.confidence).toBe(0.82);
    expect(result.canPromote).toBe(false);
    expect(result.finalTier).toBe("daily");
    expect(result.promotionBlocker).toBe("edge_gate_failed");
    expect(result.diagnostics.analyzer_skipped_reason).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      canonical_confidence: 82,
      canonical_verdict: "STRONG",
      edge_gate_result: "failed",
      final_edge_eligible: false,
      edge_pool_selected: false,
    });
  });

  it("promotes a Jarrett-style 73 STRONG gate-passed row when edge cap has room", () => {
    const result = buildNbaQueueFinalization({
      finalized: makePlay(),
      baseDiagnostics: {
        analyzer_skipped_reason: "analyzer_rate_limit_budget_exhausted",
      },
      currentEdgeCount: 4,
      edgeCap: 5,
      now: new Date("2026-05-07T12:00:00Z"),
    });

    expect(result.hitRate).toBe(73);
    expect(result.canPromote).toBe(true);
    expect(result.finalTier).toBe("edge");
    expect(result.promotionBlocker).toBeNull();
    expect(result.diagnostics.analyzer_skipped_reason).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      edge_gate_result: "passed",
      final_edge_eligible: true,
      edge_pool_selected: true,
      edge_pool_selection_reason: "selected_from_queue",
    });
  });

  it("does not promote gate-failed rows", () => {
    const result = buildNbaQueueFinalization({
      finalized: makePlay({
        model_diagnostics: {
          opponentResolutionStatus: "unresolved",
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 5,
    });

    expect(result.canPromote).toBe(false);
    expect(result.promotionBlocker).toBe("edge_gate_failed");
    expect(result.diagnostics.edge_pool_selected).toBe(false);
  });

  it("does not promote PASS or RISKY rows", () => {
    const passResult = buildNbaQueueFinalization({
      finalized: makePlay({
        verdict: "Pass",
        model_diagnostics: {
          canonical_confidence: 82,
          canonical_verdict: "PASS",
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 5,
    });
    const riskyResult = buildNbaQueueFinalization({
      finalized: makePlay({
        model_diagnostics: {
          canonical_confidence: 82,
          canonical_verdict: "RISKY",
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 5,
    });

    expect(passResult.canPromote).toBe(false);
    expect(passResult.promotionBlocker).toBe("verdict_not_strong_or_lean");
    expect(riskyResult.canPromote).toBe(false);
    expect(riskyResult.promotionBlocker).toBe("verdict_not_strong_or_lean");
  });

  it("does not promote otherwise eligible rows when the edge cap is full", () => {
    const result = buildNbaQueueFinalization({
      finalized: makePlay(),
      baseDiagnostics: null,
      currentEdgeCount: 5,
      edgeCap: 5,
    });

    expect(result.canPromote).toBe(false);
    expect(result.promotionBlocker).toBe("edge_cap_full");
    expect(result.finalTier).toBe("daily");
    expect(result.diagnostics.edge_pool_selection_reason).toBe("edge_cap_full");
  });

  it("does not promote an uncalibrated analyzer score as an edge pick", () => {
    const result = buildNbaQueueFinalization({
      finalized: makePlay({
        model_diagnostics: {
          score_kind: "heuristic_score",
          calibration_status: "insufficient_evidence",
          calibration_applied: false,
          probability_supported: false,
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 5,
    });

    expect(result.canPromote).toBe(false);
    expect(result.promotionBlocker).toBe("calibration_not_supported");
    expect(result.finalTier).not.toBe("edge");
  });

  it("stores an otherwise eligible pick as a shadow candidate until evaluation validates", () => {
    const result = buildNbaQueueFinalization({
      finalized: makePlay({
        model_diagnostics: {
          edge_evidence_validated: false,
          evaluation_status: "insufficient_evidence",
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 5,
    });

    expect(result.canPromote).toBe(false);
    expect(result.promotionBlocker).toBe("evaluation_not_validated");
    expect(result.diagnostics.shadow_edge_candidate).toBe(true);
    expect(result.finalTier).toBe("daily");
  });
});

describe("generic queue finalization", () => {
  it("marks a qualified uncalibrated MLB analyzer result as a shadow candidate only", () => {
    const result = buildGenericQueueFinalization({
      finalized: makePlay({
        sport: "mlb",
        confidence: 0.68,
        projected_prob: 0.68,
        edge: 0,
        ev_pct: 0,
        verdict: "Lean",
        model_diagnostics: {
          canonical_confidence: 68,
          canonical_verdict: "LEAN",
          confidenceSource: "analyzer",
          analyzer_response_snapshot: { verdict: "LEAN", confidence: 68 },
          probability_supported: false,
          score_kind: "heuristic_score",
          calibration_status: "not_calibrated",
          calibration_applied: false,
          edge_evidence_validated: false,
          evaluation_status: "insufficient_evidence",
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 4,
    });

    expect(result.canPromote).toBe(false);
    expect(result.finalTier).toBe("daily");
    expect(result.promotionBlocker).toBe("calibration_not_supported");
    expect(result.diagnostics).toMatchObject({
      shadow_edge_candidate: true,
      shadow_edge_reason: "calibration_not_supported",
      shadow_edge_rejection_reason: null,
      shadow_edge_warning: null,
    });
  });

  it("does not mark low-score or risky MLB analyzer results as fallback candidates", () => {
    const diagnostics = {
      confidenceSource: "analyzer",
      analyzer_response_snapshot: { ok: true },
      probability_supported: false,
      score_kind: "heuristic_score",
      calibration_status: "not_calibrated",
    };
    const low = buildGenericQueueFinalization({
      finalized: makePlay({
        sport: "mlb", confidence: 0.55, projected_prob: 0.55, edge: 0,
        verdict: "Lean",
        model_diagnostics: { ...diagnostics, canonical_confidence: 55, canonical_verdict: "LEAN" },
      }),
      baseDiagnostics: null, currentEdgeCount: 0, edgeCap: 4,
    });
    const risky = buildGenericQueueFinalization({
      finalized: makePlay({
        sport: "mlb", confidence: 0.75, projected_prob: 0.75, edge: 0,
        verdict: "Risky",
        model_diagnostics: { ...diagnostics, canonical_confidence: 75, canonical_verdict: "RISKY" },
      }),
      baseDiagnostics: null, currentEdgeCount: 0, edgeCap: 4,
    });

    expect(low.diagnostics.shadow_edge_candidate).toBe(false);
    expect(low.diagnostics.shadow_edge_rejection_reason).toBe("confidence_below_lean_min");
    expect(risky.diagnostics.shadow_edge_candidate).toBe(false);
    expect(risky.diagnostics.shadow_edge_rejection_reason).toBe("verdict_not_strong_or_lean");
  });

  it("promotes an analyzer-backed 68% Lean with at least 2% positive edge", () => {
    const result = buildGenericQueueFinalization({
      finalized: makePlay({
        sport: "mlb",
        confidence: 0.68,
        projected_prob: 0.68,
        implied_prob: 0.656,
        edge: 0.024,
        reliability: 0.75,
        verdict: "Lean",
        model_diagnostics: {
          canonical_confidence: 68,
          canonical_verdict: "LEAN",
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 4,
    });

    expect(result.canPromote).toBe(true);
    expect(result.finalTier).toBe("edge");
    expect(result.promotionBlocker).toBeNull();
  });

  it("does not promote a Lean whose analyzer probability has no market edge", () => {
    const result = buildGenericQueueFinalization({
      finalized: makePlay({
        sport: "mlb",
        confidence: 0.65,
        projected_prob: 0.65,
        implied_prob: 0.71,
        edge: 0,
        reliability: 0.75,
        verdict: "Lean",
        model_diagnostics: {
          canonical_confidence: 65,
          canonical_verdict: "LEAN",
        },
      }),
      baseDiagnostics: null,
      currentEdgeCount: 0,
      edgeCap: 4,
    });

    expect(result.canPromote).toBe(false);
    expect(result.finalTier).toBe("daily");
    expect(result.promotionBlocker).toBe("edge_below_lean_min");
    expect(result.diagnostics.edgeDowngradeReason).toBe("edge_below_lean_min");
  });
});

describe("WNBA fallback finalization", () => {
  const uncalibratedAnalyzerDiagnostics = {
    canonical_confidence: 65,
    canonical_verdict: "LEAN",
    confidenceSource: "analyzer",
    analyzer_response_snapshot: { verdict: "LEAN", confidence: 65 },
    probability_supported: false,
    score_kind: "heuristic_score",
    calibration_status: "not_calibrated",
    calibration_applied: false,
    edge_evidence_validated: false,
    evaluation_status: "insufficient_evidence",
  };

  it("allows an uncalibrated WNBA team-market fallback with a lineup warning", () => {
    const result = buildWnbaQueueFinalization({
      finalized: makePlay({
        sport: "wnba", bet_type: "spread", prop_type: "spread",
        player_name: "Minnesota Lynx @ Golden State Valkyries",
        confidence: 0.65, projected_prob: 0.65, edge: 0, ev_pct: 0,
        verdict: "Lean", model_diagnostics: uncalibratedAnalyzerDiagnostics,
      }),
      baseDiagnostics: {
        wnba_data_quality: "medium",
        injury_source_available: true,
        matchup_confirmed: true,
        selected_side_confirmed: true,
        lineup_status: "unconfirmed",
        marketDataQuality: "high",
        bookCount: 8,
      },
      currentEdgeCount: 0,
      edgeCap: 4,
    });

    expect(result.canPromote).toBe(false);
    expect(result.finalTier).toBe("daily");
    expect(result.diagnostics).toMatchObject({
      shadow_edge_candidate: true,
      shadow_edge_reason: "calibration_not_supported",
      shadow_edge_warning: "lineups_pending",
    });
  });

  it("keeps WNBA player props blocked until the lineup and starter are confirmed", () => {
    const result = buildWnbaQueueFinalization({
      finalized: makePlay({
        sport: "wnba", bet_type: "prop", prop_type: "points",
        confidence: 0.65, projected_prob: 0.65, edge: 0, ev_pct: 0,
        verdict: "Lean", model_diagnostics: uncalibratedAnalyzerDiagnostics,
      }),
      baseDiagnostics: {
        wnba_data_quality: "high",
        injury_source_available: true,
        lineup_status: "unconfirmed",
        player_starting: null,
        player_availability: "not_listed",
        minutes_restriction: false,
        current_season_sample: 20,
        marketDataQuality: "high",
        bookCount: 8,
      },
      currentEdgeCount: 0,
      edgeCap: 4,
    });

    expect(result.canPromote).toBe(false);
    expect(result.diagnostics.shadow_edge_candidate).toBe(false);
    expect(result.diagnostics.shadow_edge_rejection_reason).toBe("wnba_starting_lineup_unconfirmed");
    expect(result.diagnostics.shadow_edge_warning).toBeNull();
  });
});
