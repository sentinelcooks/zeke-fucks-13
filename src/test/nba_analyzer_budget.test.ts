import { describe, expect, it } from "vitest";
import {
  applyNbaAnalyzerBudget,
  candidateDiagnostic,
  NBA_ANALYZER_BUDGET_DEFAULT,
  NBA_ANALYZER_BUDGET_HARD_MAX,
  resolveNbaAnalyzerBudget,
  type BudgetPriorityCandidate,
} from "../../supabase/functions/_shared/edge_scoring";

function cand(overrides: Partial<BudgetPriorityCandidate> = {}): BudgetPriorityCandidate {
  return {
    sport: "nba",
    player_name: overrides.player_name ?? "P",
    prop_type: overrides.prop_type ?? "points",
    direction: overrides.direction ?? "over",
    line: overrides.line ?? 20.5,
    confidence: overrides.confidence ?? 0.7,
    edge: overrides.edge ?? 0.02,
    quality_score: overrides.quality_score ?? 0.7,
    ev_pct: overrides.ev_pct,
    is_trace_target: overrides.is_trace_target,
  };
}

describe("resolveNbaAnalyzerBudget", () => {
  it("defaults to 25 for undefined / empty / invalid input", () => {
    expect(resolveNbaAnalyzerBudget(undefined)).toBe(NBA_ANALYZER_BUDGET_DEFAULT);
    expect(resolveNbaAnalyzerBudget("")).toBe(NBA_ANALYZER_BUDGET_DEFAULT);
    expect(resolveNbaAnalyzerBudget("not-a-number")).toBe(NBA_ANALYZER_BUDGET_DEFAULT);
    expect(resolveNbaAnalyzerBudget(0)).toBe(NBA_ANALYZER_BUDGET_DEFAULT);
    expect(resolveNbaAnalyzerBudget(-5)).toBe(NBA_ANALYZER_BUDGET_DEFAULT);
  });

  it("parses numeric strings", () => {
    expect(resolveNbaAnalyzerBudget("30")).toBe(30);
    expect(resolveNbaAnalyzerBudget("  20  ")).toBe(20);
  });

  it("clamps to hard max 40", () => {
    expect(resolveNbaAnalyzerBudget("100")).toBe(NBA_ANALYZER_BUDGET_HARD_MAX);
    expect(resolveNbaAnalyzerBudget(9999)).toBe(NBA_ANALYZER_BUDGET_HARD_MAX);
  });
});

describe("applyNbaAnalyzerBudget", () => {
  it("returns selected.length === min(budget, pool.length) and deferred is the rest", () => {
    const pool = Array.from({ length: 50 }, (_, i) =>
      cand({ player_name: `P${i}`, quality_score: 0.5 + i / 100 }),
    );
    const { selected, deferred } = applyNbaAnalyzerBudget(pool, 25);
    expect(selected).toHaveLength(25);
    expect(deferred).toHaveLength(25);
    const allKeys = new Set(pool.map((p) => p.player_name));
    const reconstructed = new Set([
      ...selected.map((p) => p.player_name),
      ...deferred.map((p) => p.player_name),
    ]);
    expect(reconstructed).toEqual(allKeys);
  });

  it("trace targets land in selected even when their quality is the lowest", () => {
    const fillers = Array.from({ length: 30 }, (_, i) =>
      cand({ player_name: `F${i}`, quality_score: 0.9, confidence: 0.85 }),
    );
    const traceLowQuality = cand({
      player_name: "DebuggedPlayer",
      quality_score: 0.01,
      confidence: 0.10,
      edge: -0.5,
      is_trace_target: true,
    });
    const { selected } = applyNbaAnalyzerBudget(
      [...fillers, traceLowQuality],
      5,
    );
    expect(selected.map((p) => p.player_name)).toContain("DebuggedPlayer");
    expect(selected[0].player_name).toBe("DebuggedPlayer");
  });

  it("ranks by quality_score, then confidence, then edge, then positive EV", () => {
    const highQuality = cand({ player_name: "HQ", quality_score: 0.95, confidence: 0.65 });
    const highConf = cand({ player_name: "HC", quality_score: 0.50, confidence: 0.95 });
    const { selected } = applyNbaAnalyzerBudget([highConf, highQuality], 1);
    expect(selected[0].player_name).toBe("HQ");
  });

  it("breaks ties with positive EV over negative EV", () => {
    const negEv = cand({ player_name: "NEG", quality_score: 0.7, confidence: 0.7, edge: 0.05, ev_pct: -2 });
    const posEv = cand({ player_name: "POS", quality_score: 0.7, confidence: 0.7, edge: 0.05, ev_pct: 5 });
    const { selected } = applyNbaAnalyzerBudget([negEv, posEv], 1);
    expect(selected[0].player_name).toBe("POS");
  });

  it("breaks final ties with 3-pointers and unders", () => {
    const points = cand({ player_name: "PTS", prop_type: "points", direction: "over", quality_score: 0.7, confidence: 0.7, edge: 0.02, ev_pct: 1 });
    const threes = cand({ player_name: "TRE", prop_type: "3-pointers", direction: "over", quality_score: 0.7, confidence: 0.7, edge: 0.02, ev_pct: 1 });
    const under = cand({ player_name: "UND", prop_type: "points", direction: "under", quality_score: 0.7, confidence: 0.7, edge: 0.02, ev_pct: 1 });
    const { selected } = applyNbaAnalyzerBudget([points, under, threes], 2);
    expect(selected[0].player_name).toBe("TRE");
    expect(selected[1].player_name).toBe("UND");
  });

  it("respects an explicit small budget", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      cand({ player_name: `P${i}`, quality_score: 0.5 + i / 100 }),
    );
    const { selected, deferred } = applyNbaAnalyzerBudget(pool, 3);
    expect(selected).toHaveLength(3);
    expect(deferred).toHaveLength(7);
  });

  it("clamps invalid budgets to default 25", () => {
    const pool = Array.from({ length: 100 }, (_, i) =>
      cand({ player_name: `P${i}`, quality_score: 0.5 + i / 1000 }),
    );
    const { selected } = applyNbaAnalyzerBudget(pool, 0);
    expect(selected).toHaveLength(NBA_ANALYZER_BUDGET_DEFAULT);
  });
});

describe("candidateDiagnostic exclusion reasons", () => {
  it("supports analyzer_call_budget_exceeded", () => {
    const diag = candidateDiagnostic(cand({ player_name: "X" }), "analyzer_call_budget_exceeded");
    expect(diag.exclusion_reason).toBe("analyzer_call_budget_exceeded");
    expect(diag.player_name).toBe("X");
  });

  it("supports analyzer_rate_limit_budget_exhausted", () => {
    const diag = candidateDiagnostic(cand({ player_name: "Y" }), "analyzer_rate_limit_budget_exhausted");
    expect(diag.exclusion_reason).toBe("analyzer_rate_limit_budget_exhausted");
  });

  it("still supports analyzer_pool_cap_exceeded", () => {
    const diag = candidateDiagnostic(cand(), "analyzer_pool_cap_exceeded");
    expect(diag.exclusion_reason).toBe("analyzer_pool_cap_exceeded");
  });
});
