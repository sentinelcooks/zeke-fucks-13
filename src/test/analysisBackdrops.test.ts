import { describe, it, expect, beforeEach } from "vitest";
import {
  backdropSportFolder,
  isBackdropImage,
  rotateFrom,
  nextBackdropOrder,
  softeningForUpscale,
  __resetBackdropCache,
  cssUrl,
  ANALYSIS_BACKDROP_BUCKET,
} from "@/lib/analysisBackdrops";

describe("backdropSportFolder", () => {
  it("maps the sport strings the odds feed actually sends", () => {
    expect(backdropSportFolder("MLB")).toBe("mlb");
    expect(backdropSportFolder("Baseball MLB")).toBe("mlb");
    expect(backdropSportFolder("baseball_mlb")).toBe("mlb");
    expect(backdropSportFolder("WNBA")).toBe("wnba");
    expect(backdropSportFolder("basketball_wnba")).toBe("wnba");
    expect(backdropSportFolder("icehockey_nhl")).toBe("nhl");
    expect(backdropSportFolder("basketball_nba")).toBe("nba");
  });

  it("does not mistake WNBA for NBA", () => {
    // "basketball_wnba" contains "nba" as a substring — checking NBA first
    // would route every WNBA game to the wrong folder.
    expect(backdropSportFolder("basketball_wnba")).toBe("wnba");
    expect(backdropSportFolder("WNBA")).not.toBe("nba");
  });

  it("returns null for anything unrecognised", () => {
    expect(backdropSportFolder("UFC")).toBeNull();
    expect(backdropSportFolder("")).toBeNull();
    expect(backdropSportFolder(null)).toBeNull();
    expect(backdropSportFolder(undefined)).toBeNull();
  });
});

describe("isBackdropImage", () => {
  it("accepts the formats the bucket allows", () => {
    expect(isBackdropImage("field.jpg")).toBe(true);
    expect(isBackdropImage("Crowd.JPEG")).toBe(true);
    expect(isBackdropImage("arena.png")).toBe(true);
    expect(isBackdropImage("dugout.webp")).toBe(true);
    expect(isBackdropImage("court.avif")).toBe(true);
  });

  it("rejects storage placeholder and non-image rows", () => {
    // Supabase inserts this row when a folder is created in the dashboard.
    expect(isBackdropImage(".emptyFolderPlaceholder")).toBe(false);
    expect(isBackdropImage("notes.txt")).toBe(false);
    expect(isBackdropImage("subfolder")).toBe(false);
    expect(isBackdropImage("")).toBe(false);
    expect(isBackdropImage(null)).toBe(false);
  });
});

describe("rotateFrom", () => {
  it("rotates the list to start at the offset", () => {
    expect(rotateFrom(["a", "b", "c", "d"], 2)).toEqual(["c", "d", "a", "b"]);
  });

  it("keeps every image", () => {
    const urls = ["a", "b", "c", "d"];
    const r = rotateFrom(urls, 3);
    expect([...r].sort()).toEqual([...urls].sort());
  });

  it("wraps an offset past the end", () => {
    expect(rotateFrom(["a", "b", "c"], 7)).toEqual(rotateFrom(["a", "b", "c"], 1));
  });

  it("survives a bad offset instead of throwing", () => {
    const urls = ["a", "b", "c"];
    expect(() => rotateFrom(urls, NaN)).not.toThrow();
    expect(() => rotateFrom(urls, -2)).not.toThrow();
    expect(rotateFrom(urls, NaN)).toHaveLength(3);
  });

  it("survives empty, single and malformed lists", () => {
    expect(rotateFrom([], 1)).toEqual([]);
    expect(rotateFrom(["only"], 5)).toEqual(["only"]);
    expect(rotateFrom(undefined as unknown as string[], 1)).toEqual([]);
    expect(rotateFrom(null as unknown as string[], 1)).toEqual([]);
  });

  it("does not mutate the input", () => {
    const urls = ["a", "b", "c"];
    rotateFrom(urls, 2);
    expect(urls).toEqual(["a", "b", "c"]);
  });
});

describe("nextBackdropOrder", () => {
  beforeEach(() => __resetBackdropCache());

  it("starts on a different image on every successive scan", () => {
    const urls = ["a", "b", "c", "d"];
    // Pressing Analyze repeatedly must not keep opening on the same picture.
    const firsts = [0, 1, 2, 3].map(() => nextBackdropOrder(urls, "mlb")[0]);
    expect(new Set(firsts).size).toBe(4);
  });

  it("never repeats back-to-back", () => {
    const urls = ["a", "b", "c"];
    let previous: string | null = null;
    for (let i = 0; i < 12; i += 1) {
      const first = nextBackdropOrder(urls, "mlb")[0];
      expect(first).not.toBe(previous);
      previous = first;
    }
  });

  it("eventually shows every image", () => {
    const urls = ["a", "b", "c", "d", "e"];
    const seen = new Set(Array.from({ length: 10 }, () => nextBackdropOrder(urls, "mlb")[0]));
    expect(seen.size).toBe(urls.length);
  });

  it("advances each sport independently", () => {
    const mlb = ["m1", "m2", "m3"];
    const wnba = ["w1", "w2", "w3"];
    nextBackdropOrder(mlb, "mlb");
    const a = nextBackdropOrder(mlb, "mlb")[0];
    nextBackdropOrder(wnba, "wnba");
    const b = nextBackdropOrder(mlb, "mlb")[0];
    // The WNBA scan in between must not disturb MLB's position.
    expect(b).not.toBe(a);
    expect(mlb).toContain(b);
  });

  it("keeps the full set each time", () => {
    const urls = ["a", "b", "c", "d"];
    for (let i = 0; i < 5; i += 1) {
      expect([...nextBackdropOrder(urls, "mlb")].sort()).toEqual([...urls].sort());
    }
  });

  it("handles empty and single-image folders", () => {
    expect(nextBackdropOrder([], "mlb")).toEqual([]);
    expect(nextBackdropOrder(["only"], "mlb")).toEqual(["only"]);
  });
});

describe("cssUrl", () => {
  it("quotes the value so parentheses in a filename cannot break the rule", () => {
    // Real uploads look exactly like this. Unquoted, the parentheses make the
    // CSS invalid and the browser computes background-image: none — silently.
    const url = "https://x.supabase.co/storage/v1/object/public/analysis-backdrops/mlb/images%20(11).jpg";
    const value = cssUrl(url);
    expect(value).toBe(`url("${url}")`);
    expect(value.startsWith('url("')).toBe(true);
    expect(value.endsWith('")')).toBe(true);
  });

  it("handles spaces and commas", () => {
    expect(cssUrl("https://x/a b,c.jpg")).toBe('url("https://x/a b,c.jpg")');
  });

  it("neutralises a double quote so it cannot terminate the CSS string", () => {
    expect(cssUrl('https://x/we"ird.jpg')).toBe('url("https://x/we%22ird.jpg")');
  });
});

describe("softeningForUpscale", () => {
  const COVER_W = 1125; // a phone viewport at DPR 3
  const COVER_H = 2436;

  it("leaves a large source completely crisp", () => {
    // 2208x2208 is downscaled to fit — it must never be blurred.
    expect(softeningForUpscale(2208, 2208, COVER_W, COVER_H)).toBe(0);
    expect(softeningForUpscale(2208, 1242, 536, 918)).toBe(0);
  });

  it("blurs harder the more an image is stretched", () => {
    const mild = softeningForUpscale(738, 415, 536, 918);   // ~2.2x
    const bad = softeningForUpscale(299, 168, 536, 918);    // ~5.5x
    expect(mild).toBeGreaterThan(0);
    expect(bad).toBeGreaterThan(mild);
  });

  it("does not blur something only marginally upscaled", () => {
    // A source just under the cover size stays sharp enough to leave alone.
    expect(softeningForUpscale(1000, 2200, 1125, 2436)).toBe(0);
  });

  it("returns 0 for unusable measurements rather than throwing", () => {
    expect(softeningForUpscale(0, 0, COVER_W, COVER_H)).toBe(0);
    expect(softeningForUpscale(NaN, 100, COVER_W, COVER_H)).toBe(0);
    expect(softeningForUpscale(100, 100, 0, 0)).toBe(0);
    expect(softeningForUpscale(-5, 100, COVER_W, COVER_H)).toBe(0);
  });

  it("increases monotonically with upscale factor", () => {
    const factors = [1.4, 2.5, 3.5, 6].map((f) =>
      softeningForUpscale(COVER_W / f, COVER_H / f, COVER_W, COVER_H));
    for (let i = 1; i < factors.length; i += 1) {
      expect(factors[i]).toBeGreaterThanOrEqual(factors[i - 1]);
    }
  });
});

describe("bucket name", () => {
  it("matches the migration", () => {
    expect(ANALYSIS_BACKDROP_BUCKET).toBe("analysis-backdrops");
  });
});
