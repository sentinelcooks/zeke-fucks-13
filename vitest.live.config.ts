import { defineConfig } from "vitest/config";

/**
 * Live smoke tests for the per-sport prop models.
 *
 * Separate from the main suite for two reasons: these hit ESPN and MLB StatsAPI
 * for real (so they must never gate CI), and they run in the `node`
 * environment rather than jsdom — jsdom's AbortController is a different realm
 * from undici's fetch, which makes every timed-out request in
 * `_shared/mlb_data.ts` throw a spurious "Expected signal to be an instance of
 * AbortSignal".
 *
 * Run with `npm run test:live`. Worth running before any deploy of
 * `mlb-prop-model` or `wnba-prop-model`, since there is no Deno toolchain here
 * to type-check the handlers.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/live/**/*.live.test.ts"],
    testTimeout: 200_000,
    hookTimeout: 200_000,
  },
});
