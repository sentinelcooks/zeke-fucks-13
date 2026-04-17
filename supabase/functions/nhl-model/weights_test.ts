// Validates that every WEIGHTS_V2 bet_type sums to exactly 1.00.
// Run via: deno test supabase/functions/nhl-model/weights_test.ts
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { WEIGHTS_V2, validateWeights } from "./weights.ts";

Deno.test("WEIGHTS_V2 sums to 1.00 for every bet_type", () => {
  const errors = validateWeights(WEIGHTS_V2);
  assert(
    errors.length === 0,
    `Weight validation failed:\n${errors.join("\n")}`,
  );
});

Deno.test("WEIGHTS_V2 lists all 26 factor slots per bet_type", () => {
  const expectedSlots = 26;
  for (const [bt, weights] of Object.entries(WEIGHTS_V2)) {
    const count = Object.keys(weights).length;
    assert(
      count >= expectedSlots,
      `${bt} has ${count} factors, expected >= ${expectedSlots}`,
    );
  }
});
