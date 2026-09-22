import { describe, expect, it } from "vitest";
import { isResultFinal } from "@/lib/gameDate";
import { settlementOf } from "@/lib/pickSettlement";
import { profitUnits } from "@/lib/odds";

/**
 * Picks published against the wrong side of a market (analyzer side mismatch)
 * are voided rather than deleted: settled, stake returned, excluded from the
 * win/loss record, and never re-graded.
 */
describe("voided picks", () => {
  it("is a final, settled state labelled VOID", () => {
    expect(isResultFinal("void")).toBe(true);
    const s = settlementOf({ result: "void" });
    expect(s).toEqual({ state: "push", label: "VOID", settled: true });
  });

  it("returns the stake, like a push", () => {
    expect(profitUnits(-110, "void")).toBe(0);
    expect(profitUnits(-110, "push")).toBe(0);
    expect(profitUnits(-110, "miss")).toBe(-1);
  });

  it("leaves other results untouched", () => {
    expect(settlementOf({ result: "hit" }).label).toBe("WON");
    expect(settlementOf({ result: "miss" }).label).toBe("LOST");
    expect(settlementOf({ result: "push" }).label).toBe("PUSH");
    expect(settlementOf({ result: null }).settled).toBe(false);
  });
});
