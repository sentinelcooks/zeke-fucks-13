import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TrendingPropItem } from "@/hooks/useTrendingProps";
import { formatGameTime, initialsOf } from "@/lib/playerDisplay";

export function PlayerAvatar({ name, size = 36, ring = false, src }: { name: string; size?: number; ring?: boolean; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full bg-fill/15 object-cover object-top ${
          ring ? "shadow-[0_0_0_2px_hsl(var(--nba-cyan))]" : "shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))]"
        }`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-bold ${
        ring ? "bg-secondary text-foreground shadow-[inset_0_0_0_2px_hsl(var(--nba-cyan))]" : "bg-fill/15 text-muted-foreground shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))]"
      }`}
      style={{ width: size, height: size, fontSize: size >= 40 ? 15 : 11 }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  );
}

interface TrendingTonightProps {
  items: TrendingPropItem[];
  /** Short stat label for a prop value, e.g. "points" → "PTS". */
  statLabel: (propType: string) => string;
  onPick: (item: TrendingPropItem) => void;
}

/**
 * The props with the most sportsbook line movement on tonight's slate.
 * Deliberately captioned as line movement — this is market heat, not a count
 * of bets, and must not be presented as "most bet".
 */
export function TrendingTonight({ items, statLabel, onPick }: TrendingTonightProps) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="trending-tonight-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="trending-tonight-heading" className="text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
          Trending tonight
        </h2>
        <span className="text-[11px] text-muted-foreground">Biggest line moves across books</span>
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const time = formatGameTime(item.commence_time);
          const meta = [item.matchup, time].filter(Boolean).join(" · ");
          return (
            <li key={`${item.event_id}-${item.player}-${item.market}`}>
              <button
                type="button"
                onClick={() => onPick(item)}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-[18px] bg-card px-3 py-2.5 text-left shadow-[inset_0_0_0_0.5px_hsl(var(--hairline))] active:scale-[0.99]"
              >
                <PlayerAvatar name={item.player} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-foreground">{item.player}</p>
                  {meta && <p className="truncate text-[12px] text-muted-foreground">{meta}</p>}
                </div>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-muted-foreground">
                  {statLabel(item.prop_type)} {item.line}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
