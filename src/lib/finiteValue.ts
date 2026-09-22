/**
 * Narrows an unknown value to a real number, or null.
 *
 * Exists because `Number(null)` is `0` and `Number("")` is `0`, both of which
 * pass `Number.isFinite`. A missing model input therefore reads as a genuine
 * zero: a projection the model never made renders as "0.0 runs", an absent ERA
 * as a 0.00 ERA, and absent coverage as 0%. Every optional numeric field from
 * the model must go through here rather than through `Number()` directly.
 */
export function finiteValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** True when the value is a real number rather than a null standing in for one. */
export function hasFiniteValue(value: unknown): boolean {
  return finiteValue(value) !== null;
}
