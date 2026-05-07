import { describe, expect, it } from "vitest";
import {
  selectNbaAnalyzerPoolDiversified,
  type ScoredPlay,
} from "../../supabase/functions/_shared/edge_scoring";

function makeCandidate(overrides: Partial<ScoredPlay> = {}): ScoredPlay {
  const confidence = overrides.confidence ?? 0.7;
  const implied = overrides.implied_prob ?? 0.6;
  const edge = overrides.edge ?? confidence - implied;
  const qualityScore = overrides.quality_score ?? confidence * (1 + Math.max(0, edge));

  return {
    sport: "nba",
    bet_type: "prop",
    player_name: "Test Player",
    team: "SAS",
    opponent: "MIN",
    home_team: "SAS",
    away_team: "MIN",
    prop_type: "points",
    line: 24.5,
    direction: "over",
    odds: -110,
    odds_opp: null,
    projected_prob: confidence,
    implied_prob: implied,
    raw_implied_prob: implied,
    edge,
    ev_pct: 5,
    confidence,
    raw_confidence: confidence,
    reliability: 0.75,
    score: edge * confidence,
    quality_score: qualityScore,
    verdict: "Lean",
    reasoning: "",
    event_id: "evt",
    commence_time: "2026-05-07T23:00:00Z",
    game_date: "2026-05-07",
    model_diagnostics: {},
    ...overrides,
  };
}

describe("selectNbaAnalyzerPoolDiversified", () => {
  it("includes Wembanyama-style 3PM under (conf 0.674, edge +0.0482) when packed against high-conf points pool", () => {
    const filler = Array.from({ length: 200 }, (_, i) =>
      makeCandidate({
        player_name: `Filler ${i}`,
        prop_type: "points",
        direction: "over",
        line: 20 + (i % 10),
        confidence: 0.78 + (i % 100) / 10_000,
        edge: 0.005,
        quality_score: 0.95 - i / 10_000,
      }),
    );

    const wemby = makeCandidate({
      player_name: "Victor Wembanyama",
      prop_type: "3-pointers",
      direction: "under",
      line: 2.5,
      confidence: 0.674,
      edge: 0.0482,
      quality_score: 0.674 * (1 + 0.0482),
    });

    const pool = selectNbaAnalyzerPoolDiversified([...filler, wemby], 80);

    expect(pool.selected.some((p) => p.player_name === "Victor Wembanyama")).toBe(true);
    const key = `${wemby.player_name}|${wemby.prop_type}|${wemby.direction}|${wemby.line}`;
    expect(pool.ranks.get(key)).toBeDefined();
  });

  it("includes Jaden-style 3PM under (conf 0.72, edge +0.0644) in pool", () => {
    const filler = Array.from({ length: 200 }, (_, i) =>
      makeCandidate({
        player_name: `Filler ${i}`,
        prop_type: "points",
        direction: "over",
        line: 20 + (i % 10),
        confidence: 0.85,
        edge: 0.005,
        quality_score: 0.99 - i / 10_000,
      }),
    );

    const jaden = makeCandidate({
      player_name: "Jaden McDaniels",
      prop_type: "3-pointers",
      direction: "under",
      line: 1.5,
      confidence: 0.72,
      edge: 0.0644,
      quality_score: 0.72 * (1 + 0.0644),
    });

    const pool = selectNbaAnalyzerPoolDiversified([...filler, jaden], 80);
    expect(pool.selected.some((p) => p.player_name === "Jaden McDaniels")).toBe(true);
  });

  it("preserves a 3-pointers candidate even when its quality rank exceeds the cap", () => {
    const fillers = Array.from({ length: 100 }, (_, i) =>
      makeCandidate({
        player_name: `Q${i}`,
        prop_type: "points",
        direction: "over",
        line: 20 + (i % 5),
        confidence: 0.9,
        quality_score: 1.0 - i / 1_000,
      }),
    );
    const threes = makeCandidate({
      player_name: "Three Specialist",
      prop_type: "3-pointers",
      direction: "under",
      line: 2.5,
      confidence: 0.66,
      edge: 0.02,
      quality_score: 0.40, // would be ranked far below cap by quality
    });

    const pool = selectNbaAnalyzerPoolDiversified([...fillers, threes], 80);
    expect(pool.selected).toContain(threes);
    const k = `${threes.player_name}|${threes.prop_type}|${threes.direction}|${threes.line}`;
    expect(pool.ranks.get(k)?.bucket === "threes" || pool.ranks.get(k)?.bucket === "under").toBe(true);
  });

  it("respects the cap (default 80) and reports excluded", () => {
    const candidates = Array.from({ length: 150 }, (_, i) =>
      makeCandidate({
        player_name: `P${i}`,
        line: 20 + (i % 7),
        quality_score: 1 - i / 1000,
      }),
    );
    const pool = selectNbaAnalyzerPoolDiversified(candidates, 80);
    expect(pool.selected.length).toBeLessThanOrEqual(80);
    expect(pool.truncated).toBe(true);
    expect(pool.excluded.length).toBeGreaterThan(0);
    expect(pool.excluded[0].exclusion_reason).toBe("analyzer_pool_cap_exceeded");
  });

  it("deduplicates across buckets — same candidate never appears twice", () => {
    const c = makeCandidate({
      player_name: "Multi-bucket",
      prop_type: "3-pointers",
      direction: "under",
      line: 2.5,
      confidence: 0.9,
      edge: 0.2,
      quality_score: 1.5,
    });
    const filler = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ player_name: `F${i}`, line: 10 + i, quality_score: 0.5 - i / 1000 }),
    );
    const pool = selectNbaAnalyzerPoolDiversified([c, ...filler], 80);
    const occurrences = pool.selected.filter((p) => p.player_name === "Multi-bucket").length;
    expect(occurrences).toBe(1);
  });
});
