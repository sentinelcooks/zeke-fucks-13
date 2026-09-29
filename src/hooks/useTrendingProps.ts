import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { currentSlateDate } from "@/lib/gameDate";

/**
 * One "Trending tonight" row, as written by the trending-props-<sport> Edge
 * Functions (supabase/functions/_shared/trending_props.ts). Trending means
 * market heat — line/price movement across sportsbooks — not bet volume.
 */
export interface TrendingPropItem {
  event_id: string;
  player: string;
  market: string;
  /** The Analyze tab's prop value (e.g. "points", "pitcher_strikeouts"). */
  prop_type: string;
  line: number;
  books: number;
  line_move: number;
  price_move_pp: number;
  heat: number;
  lean: "over" | "under" | null;
  commence_time: string | null;
  matchup: string | null;
}

const TRENDING_SPORTS = new Set(["nba", "wnba", "mlb", "nhl", "nfl"]);

function isTrendingItem(value: unknown): value is TrendingPropItem {
  const item = value as Partial<TrendingPropItem> | null;
  return !!item && typeof item.player === "string" && typeof item.prop_type === "string" &&
    typeof item.line === "number" && Number.isFinite(item.line);
}

/**
 * Reads the stored trending list for a sport. Reading never calls the Odds API
 * — the list is refreshed on cron — and a list from a previous slate or for a
 * game that already started is dropped rather than shown as "tonight".
 */
export function useTrendingProps(sport: string): { items: TrendingPropItem[]; loading: boolean } {
  const [items, setItems] = useState<TrendingPropItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setItems([]);
    if (!TRENDING_SPORTS.has(sport)) return;

    let cancelled = false;
    setLoading(true);
    supabase
      .from("trending_props")
      .select("items, slate_date")
      .eq("sport", sport)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error || !data) return;
        // NFL lists the next game day, which may be days away.
        if (sport !== "nfl" && data.slate_date !== currentSlateDate()) return;
        const now = Date.now();
        const rows = Array.isArray(data.items) ? (data.items as unknown[]).filter(isTrendingItem) : [];
        setItems(rows.filter((row) => !row.commence_time || new Date(row.commence_time).getTime() > now));
      });

    return () => {
      cancelled = true;
    };
  }, [sport]);

  return { items, loading };
}
