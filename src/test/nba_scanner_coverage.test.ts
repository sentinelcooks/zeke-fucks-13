import { describe, expect, it } from "vitest";
import {
  evaluateNbaEdgeGate,
  getMarketReliability,
  lowConfidenceRejectionDiagnostic,
  missingDataFieldsForCandidate,
  resolveNbaAnalyzerCap,
  selectNbaAnalyzerPool,
  type ScoredPlay,
} from "../../supabase/functions/_shared/edge_scoring";
import { normalizeNbaPropType } from "../../supabase/functions/_shared/prop_normalization";

function makeNbaCandidate(overrides: Partial<ScoredPlay> = {}): ScoredPlay {
  const confidence = overrides.confidence ?? 0.7;
  const implied = overrides.implied_prob ?? 0.6;
  const edge = overrides.edge ?? confidence - implied;
  const qualityScore = overrides.quality_score ?? confidence * (1 + Math.max(0, edge));

  return {
    sport: "nba",
    bet_type: "prop",
    player_name: "Victor Wembanyama",
    team: "SAS",
    opponent: "MIN",
    home_team: "SAS",
    away_team: "MIN",
    prop_type: "3-pointers",
    line: 2.5,
    direction: "under",
    odds: -150,
    odds_opp: null,
    projected_prob: confidence,
    implied_prob: implied,
    raw_implied_prob: implied,
    edge,
    ev_pct: overrides.ev_pct ?? 12,
    confidence,
    raw_confidence: confidence,
    reliability: overrides.reliability ?? 0.75,
    score: edge * confidence,
    quality_score: qualityScore,
    verdict: overrides.verdict ?? "Lean",
    reasoning: "Analyzer-backed manual-style candidate.",
    event_id: "evt_nba",
    commence_time: "2026-05-07T23:00:00Z",
    game_date: "2026-05-07",
    model_diagnostics: {
      canonical_confidence: Math.round(confidence * 100),
      canonical_verdict: overrides.verdict === "Strong" ? "STRONG" : "LEAN",
      bookCount: 5,
      marketDataQuality: "medium",
      marketDepth: "normal",
      opponentResolutionStatus: "resolved",
      ...(overrides.model_diagnostics ?? {}),
    },
    ...overrides,
  };
}

describe("NBA prop normalization", () => {
  it("normalizes Wembanyama 3-pointers Made to 3-pointers", () => {
    expect(normalizeNbaPropType("3-pointers Made")).toBe("3-pointers");
    expect(normalizeNbaPropType("player_threes")).toBe("3-pointers");
  });

  it("normalizes Jaden McDaniels 3-pointers Made to 3-pointers", () => {
    const candidate = makeNbaCandidate({
      player_name: "Jaden McDaniels",
      line: 1.5,
      confidence: 0.85,
      projected_prob: 0.85,
      prop_type: normalizeNbaPropType("threes"),
    });

    expect(normalizeNbaPropType("3-pointers Made")).toBe("3-pointers");
    expect(candidate.prop_type).toBe("3-pointers");
    expect(getMarketReliability("prop", candidate.prop_type, "under", -150)).toBe(0.75);
  });
});

describe("NBA analyzer pool guardrails", () => {
  it("keeps manual-style 70 LEAN +EV candidates in the analyzer pool", () => {
    const manualStyle = makeNbaCandidate({
      confidence: 0.7,
      projected_prob: 0.7,
      implied_prob: 0.6,
      edge: 0.1,
      quality_score: 0.77,
    });
    const weaker = makeNbaCandidate({
      player_name: "Lower Priority",
      confidence: 0.61,
      projected_prob: 0.61,
      implied_prob: 0.59,
      edge: 0.02,
      quality_score: 0.45,
    });

    const pool = selectNbaAnalyzerPool([weaker, manualStyle], 80);

    expect(pool.selected).toContain(manualStyle);
    expect(evaluateNbaEdgeGate(manualStyle).ok).toBe(true);
  });

  it("clamps NBA_ANALYZER_CAP at 100 and reports excluded candidates", () => {
    const candidates = Array.from({ length: 105 }, (_, i) =>
      makeNbaCandidate({
        player_name: `Player ${i}`,
        confidence: 0.7 + i / 10_000,
        projected_prob: 0.7 + i / 10_000,
        quality_score: 1 - i / 1_000,
      })
    );

    const cap = resolveNbaAnalyzerCap("250");
    const pool = selectNbaAnalyzerPool(candidates, cap);

    expect(cap).toBe(100);
    expect(pool.selected).toHaveLength(100);
    expect(pool.truncated).toBe(true);
    expect(pool.excluded[0]).toMatchObject({
      exclusion_reason: "analyzer_pool_cap_exceeded",
      prop_type: "3-pointers",
      direction: "under",
    });
  });
});

describe("NBA scanner rejection diagnostics", () => {
  it("includes exact missing fields for missing-data candidates", () => {
    const fields = missingDataFieldsForCandidate({
      player_name: "Victor Wembanyama",
      prop_type: "3-pointers",
      direction: "under",
      line: 2.5,
      odds: -150,
    });

    expect(fields).toEqual(["game_date"]);
  });

  it("includes low-confidence threshold and feature snapshot", () => {
    const candidate = makeNbaCandidate({
      confidence: 0.59,
      projected_prob: 0.59,
      edge: 0.04,
      quality_score: 0.5,
    });
    const diagnostic = lowConfidenceRejectionDiagnostic(candidate, 0.62, {
      bookCount: 5,
      marketDataQuality: "medium",
    });

    expect(diagnostic).toMatchObject({
      threshold: 0.62,
      confidence: 0.59,
      edge: 0.04,
      bookCount: 5,
      marketDataQuality: "medium",
    });
  });
});
