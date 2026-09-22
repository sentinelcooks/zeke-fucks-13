import { describe, expect, it } from "vitest";
import { finiteValue, hasFiniteValue } from "@/lib/finiteValue";

describe("finiteValue", () => {
  // The bug this guards: `Number(null)` is 0 and passes `Number.isFinite`, so a
  // projection the model never made rendered as "0.0 runs" and an absent ERA
  // rendered as a 0.00 ERA.
  it("treats absent values as absent, not as zero", () => {
    expect(finiteValue(null)).toBeNull();
    expect(finiteValue(undefined)).toBeNull();
    expect(finiteValue("")).toBeNull();
    expect(Number(null)).toBe(0); // the trap itself
  });

  it("keeps real numbers, including a genuine zero", () => {
    expect(finiteValue(0)).toBe(0);
    expect(finiteValue(8.4)).toBe(8.4);
    expect(finiteValue("8.4")).toBe(8.4);
    expect(finiteValue(-1.5)).toBe(-1.5);
  });

  it("rejects values that are not numbers at all", () => {
    expect(finiteValue("abc")).toBeNull();
    expect(finiteValue(Number.NaN)).toBeNull();
    expect(finiteValue(Infinity)).toBeNull();
    expect(finiteValue({})).toBeNull();
    // Booleans coerce to 0/1, which would silently become a data point.
    expect(finiteValue(true)).toBeNull();
    expect(finiteValue(false)).toBeNull();
  });

  it("reports presence consistently", () => {
    expect(hasFiniteValue(0)).toBe(true);
    expect(hasFiniteValue(null)).toBe(false);
  });
});
