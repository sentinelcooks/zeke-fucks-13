import { supabase } from "@/integrations/supabase/client";

/**
 * Backdrop artwork for the Analyze scan screen.
 *
 * Images live in the public `analysis-backdrops` bucket, one folder per sport
 * (see supabase/migrations/20260912000000_analysis_backdrops_bucket.sql). The
 * folder is listed at scan time, so adding artwork is an upload — no code change
 * and no redeploy.
 *
 * Everything here degrades to "no backdrop" rather than failing: the scan screen
 * is fully usable without artwork, so an empty folder, a missing bucket or a
 * network error must never surface an error to the user.
 */

export const ANALYSIS_BACKDROP_BUCKET = "analysis-backdrops";

/** Folders that exist (or may exist) in the bucket. */
export type BackdropSport = "mlb" | "wnba" | "nba" | "nhl";

const SUPPORTED: BackdropSport[] = ["mlb", "wnba", "nba", "nhl"];

/**
 * Maps the loose sport strings the odds feed uses ("Baseball MLB", "WNBA",
 * "basketball_wnba") onto a bucket folder.
 *
 * WNBA is checked before NBA deliberately — "basketball_wnba" contains "nba" as
 * a substring, so the looser test would swallow every WNBA game.
 */
export function backdropSportFolder(raw: string | null | undefined): BackdropSport | null {
  const value = String(raw ?? "").toLowerCase();
  if (!value) return null;
  if (value.includes("wnba")) return "wnba";
  if (value.includes("mlb") || value.includes("baseball")) return "mlb";
  if (value.includes("nhl") || value.includes("hockey")) return "nhl";
  if (value.includes("nba") || value.includes("basketball")) return "nba";
  return null;
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

/** Storage listings include folder rows and placeholder files; keep real images. */
export function isBackdropImage(name: string | null | undefined): boolean {
  const value = String(name ?? "").toLowerCase();
  if (!value || value.startsWith(".")) return false;
  return IMAGE_EXTENSIONS.some((ext) => value.endsWith(ext));
}

/**
 * Rotates a list so it starts at `offset`. Pure, so the ordering logic can be
 * tested independently of the cursor that drives it.
 *
 * Defensive on both arguments: ordering is cosmetic and must never be able to
 * take the artwork down with it. A non-finite offset or a malformed list
 * previously threw here, and because the caller awaited it inside a promise
 * with no catch, the throw silently left the backdrop blank.
 */
export function rotateFrom(urls: string[], offset: number): string[] {
  if (!Array.isArray(urls) || urls.length <= 1) return Array.isArray(urls) ? [...urls] : [];
  const safe = Number.isFinite(offset) ? Math.abs(Math.trunc(offset)) % urls.length : 0;
  return [...urls.slice(safe), ...urls.slice(0, safe)];
}

// Where each sport's next scan should start. Module-level so it survives the
// scan screen mounting and unmounting, and per-sport so MLB and WNBA advance
// independently of one another.
const rotationCursor = new Map<string, number>();

/**
 * Picks the starting image for a scan, advancing one step each time.
 *
 * This is deliberately NOT seeded by the game id. Seeding that way meant the
 * same fixture always opened on the same picture, so a user analysing one game
 * repeatedly saw it every time. Advancing a cursor guarantees consecutive scans
 * differ and that the whole set gets shown over repeated use — which random
 * selection would not, since random repeats.
 *
 * The first scan of a session starts at a random point so every session does
 * not open on the same image.
 */
export function nextBackdropOrder(urls: string[], key: string): string[] {
  if (!Array.isArray(urls) || urls.length <= 1) return Array.isArray(urls) ? [...urls] : [];
  const current = rotationCursor.get(key);
  const next = current === undefined
    ? Math.floor(Math.random() * urls.length)
    : (current + 1) % urls.length;
  rotationCursor.set(key, next);
  return rotateFrom(urls, next);
}

// Listings are cached for the page's lifetime. The scan screen mounts on every
// analysis; re-listing the bucket each time would be a needless round trip for
// artwork that changes maybe once a month.
const cache = new Map<BackdropSport, string[]>();
const inFlight = new Map<BackdropSport, Promise<string[]>>();

async function listBackdrops(sport: BackdropSport): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from(ANALYSIS_BACKDROP_BUCKET)
    .list(sport, { limit: 100, sortBy: { column: "name", order: "asc" } });

  if (error) {
    // Bucket missing or unreadable is an expected state before the first
    // upload, so log at debug level and fall back to no backdrop.
    console.warn(`[backdrops] could not list ${sport}`, error.message);
    return [];
  }

  return (data ?? [])
    .filter((file) => isBackdropImage(file.name))
    .map((file) =>
      supabase.storage
        .from(ANALYSIS_BACKDROP_BUCKET)
        .getPublicUrl(`${sport}/${file.name}`).data.publicUrl,
    )
    .filter(Boolean);
}

/**
 * Public URLs for a sport's backdrops. Returns [] for an unknown sport, an empty
 * folder, or any failure — callers render without artwork in that case.
 */
export async function getBackdrops(rawSport: string | null | undefined): Promise<string[]> {
  const sport = backdropSportFolder(rawSport);
  if (!sport || !SUPPORTED.includes(sport)) return [];

  const cached = cache.get(sport);
  if (cached) return cached;

  // Collapse concurrent requests for the same sport onto one listing.
  const pending = inFlight.get(sport);
  if (pending) return pending;

  const request = listBackdrops(sport)
    .then((urls) => {
      cache.set(sport, urls);
      return urls;
    })
    .finally(() => inFlight.delete(sport));

  inFlight.set(sport, request);
  return request;
}

/**
 * Wraps a URL for use in a CSS `url()` value.
 *
 * MUST be quoted. Supabase preserves the uploaded filename, and real uploads are
 * routinely called things like "images (11).jpg". An unquoted `url(...)` value
 * containing parentheses is invalid CSS, so the browser discards the entire
 * declaration and the background silently computes to `none` — no error, no
 * warning, just no image. Quoting also covers spaces and commas.
 */
export function cssUrl(url: string): string {
  // A double quote inside the value would terminate the string early; percent-
  // encode it so the URL stays intact.
  return `url("${String(url).replace(/"/g, "%22")}")`;
}

/**
 * How much to soften an image that has to be upscaled to fill the screen.
 *
 * A backdrop is stretched to cover the viewport. When the source is smaller than
 * the area it must cover, the browser upscales it and the result reads as
 * pixelated and cheap — which is worse than slightly soft, because pixel blocks
 * look like a bug while softness reads as depth of field.
 *
 * Returns 0 for images that are large enough to render crisp, so good artwork is
 * never degraded. Only the ones that would otherwise show blocking get blurred,
 * and the amount scales with how badly they are being stretched.
 */
export function softeningForUpscale(
  naturalWidth: number,
  naturalHeight: number,
  coverWidth: number,
  coverHeight: number,
): number {
  if (![naturalWidth, naturalHeight, coverWidth, coverHeight].every((n) => Number.isFinite(n) && n > 0)) {
    return 0;
  }
  const scale = Math.max(coverWidth / naturalWidth, coverHeight / naturalHeight);
  if (scale <= 1.35) return 0;          // effectively native — leave it alone
  if (scale <= 2) return 1.5;
  if (scale <= 3) return 3;
  if (scale <= 4.5) return 5;
  return 7;                              // 5x+ upscale; only softness saves it
}

/** Test seam — clears the module cache. */
export function __resetBackdropCache() {
  cache.clear();
  inFlight.clear();
  rotationCursor.clear();
}
