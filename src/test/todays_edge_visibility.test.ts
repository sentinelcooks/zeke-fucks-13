import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Today's Edge visibility", () => {
  it("renders every qualified Today’s Edge row instead of truncating at five", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/home/ModernHomeLayout.tsx"),
      "utf8",
    );

    expect(source).not.toContain("todayPicks.slice(0, 5)");
    expect(source).toContain("todayPicks.map((pick, i)");
  });

  it("labels fallback plays as model scores instead of win probabilities", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/home/ModernHomeLayout.tsx"),
      "utf8",
    );

    expect(source).toContain("UNCALIBRATED MODEL LEAN");
    expect(source).toContain("MODEL SCORE");
    expect(source).toContain("LINEUPS PENDING");
    expect(source).toContain("not validated win probabilities");
    expect(source).toContain('isModelScore={isFallbackEdge}');
  });
});
