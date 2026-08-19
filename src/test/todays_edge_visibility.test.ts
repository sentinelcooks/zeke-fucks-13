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
});
