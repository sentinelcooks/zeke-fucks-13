/**
 * Theme-color helpers for places that cannot read CSS variables themselves
 * (canvas-based charts such as Chart.js) and for adding alpha to token colors.
 *
 * Token colors in this app are written as `hsl(var(--token))` or
 * `hsl(var(--token) / 0.5)`; the variables hold "H S% L%" triples (see index.css).
 */

const VAR_RE = /var\((--[\w-]+)\)/g;

/** Replace every `var(--x)` in a CSS color string with its current computed value. */
export function resolveCssVars(value: string, root?: Element): string {
  if (typeof document === "undefined" || !value.includes("var(--")) return value;
  const style = getComputedStyle(root ?? document.documentElement);
  return value.replace(VAR_RE, (_, name: string) => style.getPropertyValue(name).trim() || "0 0% 50%");
}

/**
 * Deep-copy plain objects/arrays, resolving CSS variables in every string.
 * Functions (Chart.js scriptable options) and class instances are kept as-is.
 */
export function resolveCssVarsDeep<T>(input: T, root?: Element): T {
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return resolveCssVars(v, root);
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = visit(val);
      return out;
    }
    return v;
  };
  return visit(input) as T;
}

/**
 * Add alpha to a token color: `withAlpha("hsl(var(--success))", 0.4)` → `hsl(var(--success) / 0.4)`.
 * Hex colors (#RRGGBB) get a hex alpha suffix; anything else is returned unchanged.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const token = color.match(/^hsl\(var\((--[\w-]+)\)\)$/);
  if (token) return `hsl(var(${token[1]}) / ${a})`;
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color + Math.round(a * 255).toString(16).padStart(2, "0");
  }
  return color;
}
