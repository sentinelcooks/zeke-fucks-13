import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The NFL Game Edge engine and the NFL Player Prop Edge engine are separate
 * products. They may share raw data (`_shared/nfl/data/`), pure math
 * (`_shared/nfl/distributions.ts`, `_shared/prob_math.ts`) and gate defaults
 * (`_shared/thresholds.ts`) — never each other's predictive code.
 */
const ROOT = join(__dirname, "../../supabase/functions/_shared/nfl");

function importsOf(dir: string): Array<{ file: string; spec: string }> {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".ts"))
    .flatMap((file) => {
      const src = readFileSync(join(ROOT, dir, file), "utf8");
      return [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => ({ file: `${dir}/${file}`, spec: m[1] }));
    });
}

const SHARED_OK = [/^\.\/[\w.]+\.ts$/, /^\.\.\/data\//, /^\.\.\/distributions\.ts$/, /^\.\.\/\.\.\/prob_math\.ts$/, /^\.\.\/\.\.\/thresholds\.ts$/];

describe("NFL engine isolation", () => {
  for (const [engine, other] of [["game", "prop"], ["prop", "game"]] as const) {
    it(`${engine} engine never imports the ${other} engine`, () => {
      const bad = importsOf(engine).filter(({ spec }) => spec.includes(`/${other}/`) || spec.startsWith(`../${other}`));
      expect(bad).toEqual([]);
    });

    it(`${engine} engine only imports its own modules, shared raw data and pure math`, () => {
      const bad = importsOf(engine).filter(({ spec }) => !SHARED_OK.some((re) => re.test(spec)));
      expect(bad).toEqual([]);
    });
  }

  it("the shared data layer and distributions import neither engine", () => {
    const shared = [...importsOf("data"), ...readFileSync(join(ROOT, "distributions.ts"), "utf8").matchAll(/from\s+["']([^"']+)["']/g)]
      .map((x) => ("spec" in x ? x.spec : x[1]));
    expect(shared.filter((s) => /\/(game|prop)\//.test(s))).toEqual([]);
  });

  it("each engine has its own model version and confidence function", () => {
    const game = readFileSync(join(ROOT, "game/weights.ts"), "utf8");
    const prop = readFileSync(join(ROOT, "prop/weights.ts"), "utf8");
    expect(game).toMatch(/NFL_GAME_MODEL_VERSION = "nfl-game-edge-/);
    expect(prop).toMatch(/NFL_PROP_MODEL_VERSION = "nfl-prop-edge-/);
    expect(readFileSync(join(ROOT, "game/confidence.ts"), "utf8")).toMatch(/export function gameConfidence/);
    expect(readFileSync(join(ROOT, "prop/confidence.ts"), "utf8")).toMatch(/export function propConfidence/);
  });
});
