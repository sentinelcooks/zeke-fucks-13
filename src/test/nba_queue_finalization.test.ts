import { describe, expect, it } from "vitest";
import { buildNbaQueueFinalization } from "../../supabase/functions/_shared/nba_queue_finalization";
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
    model_diagnostics: {
      analyzer_skipped_reason: "analyzer_call_budget_exceeded",
      canonical_confidence: Math.round(confidence * 100),
      canonical_verdict: "STRONG",
      bookCount: 5,
      marketDataQuality: "medium",
      marketDepth: "normal",
      opponentResolutionStatus: "resolved",
      ...(overrides.model_diagnostics ?? {}),
    },
    ...overrides,
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
});
