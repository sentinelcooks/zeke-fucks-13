import { afterEach, describe, expect, it, vi } from "vitest";
import { currentSlateDate, isTodayGamePick, shiftYmd } from "@/lib/gameDate";

describe("shiftYmd", () => {
  it("moves calendar days without depending on the local timezone", () => {
    expect(shiftYmd("2026-03-09", -1)).toBe("2026-03-08");
    expect(shiftYmd("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("rejects invalid calendar dates", () => {
    expect(shiftYmd("2026-02-30", -1)).toBeNull();
  });
});

describe("currentSlateDate — 4 AM ET rollover", () => {
  // Times are given in UTC. EDT = UTC-4, EST = UTC-5.
  const at = (iso: string) => currentSlateDate(new Date(iso));

  it("keeps the previous slate from midnight until 4 AM ET (EDT)", () => {
    expect(at("2026-09-18T03:59:00Z")).toBe("2026-09-17"); // 11:59 PM ET 9/17
    expect(at("2026-09-18T04:30:00Z")).toBe("2026-09-17"); // 12:30 AM ET 9/18
    expect(at("2026-09-18T07:59:00Z")).toBe("2026-09-17"); //  3:59 AM ET 9/18
  });

  it("rolls to the new slate at exactly 4 AM ET (EDT)", () => {
    expect(at("2026-09-18T08:00:00Z")).toBe("2026-09-18"); //  4:00 AM ET 9/18
    expect(at("2026-09-18T16:00:00Z")).toBe("2026-09-18"); // noon ET
  });

  it("rolls at 4 AM ET in winter too (EST), with no manual DST change", () => {
    expect(at("2026-12-10T08:59:00Z")).toBe("2026-12-09"); // 3:59 AM EST
    expect(at("2026-12-10T09:00:00Z")).toBe("2026-12-10"); // 4:00 AM EST
  });

  it("crosses month and year boundaries correctly", () => {
    expect(at("2026-10-01T06:00:00Z")).toBe("2026-09-30"); // 2 AM ET Oct 1
    expect(at("2027-01-01T07:00:00Z")).toBe("2026-12-31"); // 2 AM EST Jan 1
    expect(at("2027-01-01T09:00:00Z")).toBe("2027-01-01"); // 4 AM EST Jan 1
  });
});

describe("isTodayGamePick uses the slate date", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps a late West-coast game in today's slate after midnight", () => {
    // Emmanuel Rodriguez, 9/17 at 9:39 PM ET — still live at 12:19 AM ET.
    // Under the old midnight rollover this pick jumped to Yesterday's Edge.
    const pick = { game_date: "2026-09-17", commence_time: "2026-09-18T01:39:00Z" };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T04:19:00Z")); // 12:19 AM ET
    expect(isTodayGamePick(pick)).toBe(true);
    vi.setSystemTime(new Date("2026-09-18T08:00:00Z")); //  4:00 AM ET
    expect(isTodayGamePick(pick)).toBe(false);
  });
});
