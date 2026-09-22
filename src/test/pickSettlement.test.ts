import { describe, it, expect } from "vitest";
import { settlementOf, actualValueLabel, SETTLEMENT_PALETTE, isAwaitingGame, isUnresolved } from "@/lib/pickSettlement";

describe("settlementOf", () => {
  it("treats grade-picks' hit/miss/push as settled", () => {
    expect(settlementOf({ result: "hit" })).toMatchObject({ state: "won", label: "WON", settled: true });
    expect(settlementOf({ result: "miss" })).toMatchObject({ state: "lost", label: "LOST", settled: true });
    expect(settlementOf({ result: "push" })).toMatchObject({ state: "push", label: "PUSH", settled: true });
  });

  it("accepts the legacy win/loss synonyms", () => {
    expect(settlementOf({ result: "win" }).state).toBe("won");
    expect(settlementOf({ result: "loss" }).state).toBe("lost");
  });

  it("is case and whitespace insensitive", () => {
    expect(settlementOf({ result: "  HIT " }).state).toBe("won");
    expect(settlementOf({ result: "Miss" }).state).toBe("lost");
  });

  it("leaves live picks pending", () => {
    for (const result of ["pending", null, undefined, "", "in_progress"]) {
      const s = settlementOf({ result } as { result?: string | null });
      expect(s.settled).toBe(false);
      expect(s.state).toBe("pending");
      expect(s.label).toBe("");
    }
  });

  it("never throws on a malformed pick", () => {
    expect(settlementOf({} as { result?: string | null }).state).toBe("pending");
    expect(settlementOf(null as unknown as { result?: string | null }).state).toBe("pending");
  });
});

describe("SETTLEMENT_PALETTE", () => {
  it("covers every settled state", () => {
    for (const state of ["won", "lost", "push"] as const) {
      expect(SETTLEMENT_PALETTE[state].accent).toBeTruthy();
      expect(SETTLEMENT_PALETTE[state].chip).toBeTruthy();
      expect(SETTLEMENT_PALETTE[state].border).toBeTruthy();
    }
  });

  it("matches the green/red already used by Yesterday's Edge Results", () => {
    expect(SETTLEMENT_PALETTE.won.accent).toBe("hsl(142 71% 45%)");
    expect(SETTLEMENT_PALETTE.lost.accent).toBe("hsl(0 84% 60%)");
  });
});

describe("actualValueLabel", () => {
  it("renders recorded actuals", () => {
    expect(actualValueLabel({ actual_value: 3 })).toBe("3");
    expect(actualValueLabel({ actual_value: 0 })).toBe("0");
    expect(actualValueLabel({ actual_value: 1.5 })).toBe("1.5");
    expect(actualValueLabel({ actual_value: "2" })).toBe("2");
  });

  it("returns null when grade-picks recorded no actual (game bets)", () => {
    expect(actualValueLabel({ actual_value: null })).toBeNull();
    expect(actualValueLabel({ actual_value: undefined })).toBeNull();
    expect(actualValueLabel({ actual_value: "" })).toBeNull();
    expect(actualValueLabel({ actual_value: "n/a" })).toBeNull();
  });
});

describe("isAwaitingGame / isUnresolved", () => {
  const HOUR = 3_600_000;
  const now = Date.parse("2026-09-14T04:00:00Z");

  it("treats a settled pick as neither awaiting nor unresolved", () => {
    const settled = { result: "hit", commence_time: "2026-09-13T16:00:00Z" };
    expect(isAwaitingGame(settled, now)).toBe(false);
    expect(isUnresolved(settled, now)).toBe(false);
  });

  it("treats a recently started game as still awaiting", () => {
    const live = { result: "pending", commence_time: new Date(now - 2 * HOUR).toISOString() };
    expect(isAwaitingGame(live, now)).toBe(true);
    expect(isUnresolved(live, now)).toBe(false);
  });

  it("flags a pending pick whose game finished long ago", () => {
    // Real case: Ezequiel Tovar, first pitch 16:11Z, never appeared in the box
    // score because he was scratched — it will never grade.
    const dead = { result: "pending", commence_time: "2026-09-13T16:11:00Z" };
    expect(isUnresolved(dead, now)).toBe(true);
    expect(isAwaitingGame(dead, now)).toBe(false);
  });

  it("is generous about extra innings and delays", () => {
    // 5 hours in is still plausibly live; only past the window is it dead.
    const long = { result: "pending", commence_time: new Date(now - 5 * HOUR).toISOString() };
    expect(isUnresolved(long, now)).toBe(false);
  });

  it("assumes live when the start time is unknown", () => {
    // Better to under-claim than to declare a pick dead on missing data.
    for (const commence_time of [null, undefined, "not-a-date"]) {
      const pick = { result: "pending", commence_time } as { result: string; commence_time?: string | null };
      expect(isAwaitingGame(pick, now)).toBe(true);
      expect(isUnresolved(pick, now)).toBe(false);
    }
  });
});

describe("void (did-not-play) picks", () => {
  const now = Date.parse("2026-09-14T04:00:00Z");

  it("treats a push as settled, not pending", () => {
    // grade-picks writes push when a player was scratched and never appeared in
    // a final box score. It must not be reported as "still pending".
    const voided = { result: "push", commence_time: "2026-09-13T16:11:00Z" };
    expect(settlementOf(voided).settled).toBe(true);
    expect(settlementOf(voided).state).toBe("push");
    expect(isAwaitingGame(voided, now)).toBe(false);
    expect(isUnresolved(voided, now)).toBe(false);
  });

  it("keeps a void distinct from a loss", () => {
    expect(settlementOf({ result: "push" }).state).not.toBe("lost");
    expect(settlementOf({ result: "miss" }).state).toBe("lost");
  });
});
