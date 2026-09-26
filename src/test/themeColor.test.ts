import { afterEach, describe, expect, it } from "vitest";
import { resolveCssVars, resolveCssVarsDeep, withAlpha } from "@/lib/themeColor";

describe("withAlpha", () => {
  it("adds alpha to a token color", () => {
    expect(withAlpha("hsl(var(--success))", 0.4)).toBe("hsl(var(--success) / 0.4)");
  });

  it("appends a hex alpha to #RRGGBB colors", () => {
    expect(withAlpha("#1D428A", 0.5)).toBe("#1D428A80");
    expect(withAlpha("#000000", 0)).toBe("#00000000");
  });

  it("clamps alpha to 0..1", () => {
    expect(withAlpha("hsl(var(--danger))", 2)).toBe("hsl(var(--danger) / 1)");
    expect(withAlpha("hsl(var(--danger))", -1)).toBe("hsl(var(--danger) / 0)");
  });

  it("leaves other formats unchanged", () => {
    expect(withAlpha("hsl(var(--success) / 0.2)", 0.5)).toBe("hsl(var(--success) / 0.2)");
    expect(withAlpha("rebeccapurple", 0.5)).toBe("rebeccapurple");
  });
});

describe("resolveCssVars", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--success");
    document.documentElement.style.removeProperty("--primary");
  });

  it("replaces variables with their computed values", () => {
    document.documentElement.style.setProperty("--success", "135 64% 50%");
    expect(resolveCssVars("hsl(var(--success))")).toBe("hsl(135 64% 50%)");
    expect(resolveCssVars("hsl(var(--success) / 0.3)")).toBe("hsl(135 64% 50% / 0.3)");
  });

  it("falls back to a neutral gray for unknown variables instead of leaving var() for canvas", () => {
    expect(resolveCssVars("hsl(var(--does-not-exist))")).toBe("hsl(0 0% 50%)");
  });

  it("returns strings without variables untouched", () => {
    expect(resolveCssVars("#1D428A")).toBe("#1D428A");
  });
});

describe("resolveCssVarsDeep", () => {
  it("resolves nested strings but keeps functions and numbers", () => {
    document.documentElement.style.setProperty("--primary", "228 100% 56%");
    const scriptable = () => "hsl(var(--primary))";
    const out = resolveCssVarsDeep({
      datasets: [{ backgroundColor: ["hsl(var(--primary))", "#fff"], borderWidth: 2, hover: scriptable }],
      scales: { y: { ticks: { color: "hsl(var(--primary) / 0.5)" } } },
    });
    expect(out.datasets[0].backgroundColor).toEqual(["hsl(228 100% 56%)", "#fff"]);
    expect(out.datasets[0].borderWidth).toBe(2);
    expect(out.datasets[0].hover).toBe(scriptable);
    expect(out.scales.y.ticks.color).toBe("hsl(228 100% 56% / 0.5)");
  });
});
