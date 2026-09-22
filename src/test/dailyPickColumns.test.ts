import { describe, it, expect, vi } from "vitest";
import {
  DAILY_PICK_LIST_COLUMNS,
  hydrateDailyPick,
  hydrateDailyPicks,
} from "@/lib/dailyPickColumns";

describe("DAILY_PICK_LIST_COLUMNS", () => {
  it("never selects the whole row", () => {
    // select("*") pulled 35 MB for one slate because model_diagnostics carries
    // the full analyzer snapshot per row, which timed out the query.
    expect(DAILY_PICK_LIST_COLUMNS).not.toBe("*");
    expect(DAILY_PICK_LIST_COLUMNS).not.toContain("*");
  });

  it("does not pull the whole model_diagnostics blob", () => {
    // Only the arrow-operator projections are allowed, never the bare column.
    expect(DAILY_PICK_LIST_COLUMNS).not.toMatch(/(^|,)model_diagnostics(,|$)/);
    expect(DAILY_PICK_LIST_COLUMNS).toContain("model_diagnostics->shadow_edge_candidate");
  });

  it("includes the columns the dashboard renders", () => {
    for (const column of [
      "id", "player_name", "prop_type", "line", "direction", "odds", "result",
      "actual_value", "sport", "bet_type", "tier", "status", "game_date",
      "commence_time", "score_kind", "calibration_status", "calibrated_probability",
    ]) {
      expect(DAILY_PICK_LIST_COLUMNS.split(",")).toContain(column);
    }
  });

  it("includes every diagnostic key the selection logic reads", () => {
    for (const key of [
      "shadow_edge_candidate", "confidenceSource", "raw_model_score", "shadow_edge_warning",
    ]) {
      expect(DAILY_PICK_LIST_COLUMNS).toContain(`model_diagnostics->${key}`);
    }
  });
});

describe("hydrateDailyPick", () => {
  const row = {
    id: "p1",
    player_name: "Ben Rice",
    diag_shadow_edge_candidate: true,
    diag_confidence_source: "analyzer",
    diag_raw_model_score: 71.5,
    diag_shadow_edge_warning: "lineups_pending",
  };

  it("rebuilds model_diagnostics in the shape the app expects", () => {
    const hydrated = hydrateDailyPick(row);
    expect(hydrated.model_diagnostics).toEqual({
      shadow_edge_candidate: true,
      confidenceSource: "analyzer",
      raw_model_score: 71.5,
      shadow_edge_warning: "lineups_pending",
    });
  });

  it("keeps the scalar columns untouched", () => {
    const hydrated = hydrateDailyPick(row);
    expect(hydrated.id).toBe("p1");
    expect(hydrated.player_name).toBe("Ben Rice");
  });

  it("strips the aliased diagnostic keys from the top level", () => {
    const hydrated = hydrateDailyPick(row) as Record<string, unknown>;
    expect(hydrated.diag_shadow_edge_candidate).toBeUndefined();
    expect(hydrated.diag_confidence_source).toBeUndefined();
  });

  it("treats a JSON string 'true' as true", () => {
    // The jsonb -> operator yields JSON, so a boolean can arrive as a string.
    const hydrated = hydrateDailyPick({ ...row, diag_shadow_edge_candidate: "true" });
    expect(hydrated.model_diagnostics.shadow_edge_candidate).toBe(true);
  });

  it("is false, never undefined, when the flag is absent", () => {
    // selectTodaysEdgePicks compares with === true, so a missing flag must
    // resolve to a definite false rather than leaking undefined.
    const hydrated = hydrateDailyPick({ id: "x" });
    expect(hydrated.model_diagnostics.shadow_edge_candidate).toBe(false);
  });

  it("drops an unusable raw score instead of passing NaN through", () => {
    const hydrated = hydrateDailyPick({ ...row, diag_raw_model_score: "not-a-number" });
    expect(hydrated.model_diagnostics.raw_model_score).toBeUndefined();
  });

  it("ignores a non-string confidence source", () => {
    const hydrated = hydrateDailyPick({ ...row, diag_confidence_source: 42 });
    expect(hydrated.model_diagnostics.confidenceSource).toBeUndefined();
  });
});

describe("hydrateDailyPicks", () => {
  it("maps a list", () => {
    const rows = hydrateDailyPicks([
      { id: "a", diag_shadow_edge_candidate: true },
      { id: "b", diag_shadow_edge_candidate: false },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].model_diagnostics.shadow_edge_candidate).toBe(true);
    expect(rows[1].model_diagnostics.shadow_edge_candidate).toBe(false);
  });

  it("returns [] for null or undefined rather than throwing", () => {
    expect(hydrateDailyPicks(null)).toEqual([]);
    expect(hydrateDailyPicks(undefined)).toEqual([]);
  });
});

describe("daily slate row ceiling", () => {
  it("sits well above a real day's slate", async () => {
    const { DAILY_SLATE_ROW_LIMIT } = await import("@/lib/dailyPickColumns");
    // Regression guard: at 120 the newest-first query dropped every game line
    // on 2026-09-16 (168 rows; spreads/moneylines/totals ranked #127-#161).
    // The busiest recent day was 168 rows — keep generous headroom above it.
    expect(DAILY_SLATE_ROW_LIMIT).toBeGreaterThanOrEqual(168 * 2);
  });

  it("flags a result that reached the ceiling, and stays quiet below it", async () => {
    const { warnIfSlateTruncated } = await import("@/lib/dailyPickColumns");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(warnIfSlateTruncated(499, 500, "today")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(warnIfSlateTruncated(500, 500, "today")).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
