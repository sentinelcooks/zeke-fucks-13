import { useEffect, useState } from "react";
import { fetchPlayerOdds } from "@/services/oddsApi";

export interface BookLineInfo {
  /** Median line across the books quoting this player/stat. */
  line: number;
  books: number;
  /** Game the prop belongs to, when the odds lookup found one. */
  event: { home?: string; away?: string; time?: string } | null;
}

// Session cache: a lookup scans upcoming events on the Odds API, so the same
// player/stat is never fetched twice while the app is open.
const cache = new Map<string, BookLineInfo | null>();

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The sportsbook line for a picked player and stat ("Book 24.5" in the line
 * card). Pass `enabled=false` when the line is already known — e.g. the pick
 * came from Trending tonight — to skip the lookup entirely.
 */
export function useBookLine(
  sport: string,
  player: string,
  propType: string,
  enabled: boolean,
): { info: BookLineInfo | null; loading: boolean } {
  const [info, setInfo] = useState<BookLineInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const name = player.trim();
    if (!enabled || !name || !propType || sport === "ufc") {
      setInfo(null);
      setLoading(false);
      return;
    }
    const key = `${sport}|${name.toLowerCase()}|${propType}`;
    if (cache.has(key)) {
      setInfo(cache.get(key) ?? null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setInfo(null);
    setLoading(true);
    // Debounced so stepping through stat chips does not fire a lookup per tap.
    const timer = window.setTimeout(async () => {
      let next: BookLineInfo | null = null;
      try {
        const result = await fetchPlayerOdds(name, propType, "over", sport);
        const lines = (result?.books ?? [])
          .map((b: { line?: unknown }) => Number(b.line))
          .filter((n: number) => Number.isFinite(n) && n > 0);
        const mid = result?.found ? median(lines) : null;
        if (mid !== null) {
          next = { line: mid, books: lines.length, event: result.event ?? null };
        }
        // Cache answers ("no line posted" included), but never a failed
        // request — a network blip must not hide the line for the session.
        if (!result?.error) cache.set(key, next);
      } catch {
        next = null;
      }
      if (!cancelled) {
        setInfo(next);
        setLoading(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sport, player, propType, enabled]);

  return { info, loading };
}
