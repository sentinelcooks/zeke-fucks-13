import { describe, expect, it } from "vitest";
import { shiftYmd } from "@/lib/gameDate";

describe("shiftYmd", () => {
  it("moves calendar days without depending on the local timezone", () => {
    expect(shiftYmd("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftYmd("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("rejects invalid calendar dates", () => {
    expect(shiftYmd("2026-02-30", -1)).toBeNull();
  });
});
