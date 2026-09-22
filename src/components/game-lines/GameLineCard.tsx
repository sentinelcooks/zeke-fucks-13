import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Radar } from "lucide-react";
import { formatOdds } from "@/utils/oddsFormat";
import { splitTeamName, type GameLineGrid, type GameLineGridRow, type GridCell } from "@/lib/gameLineGrid";

interface TeamSide {
  name: string;
  shortName?: string | null;
  badge: ReactNode;
}

export type MarketStatus = "live" | "unavailable" | "none";

/**
 * One matchup in the Game Lines list: kick-off, both teams with their
 * Spread / Total / ML prices in a grid, and the View lines / Analyze actions.
 *
 * Layout follows the concept screenshot; the surface, accent and green are the
 * app's own (`vision-card`, `nba-green`, `accent`) so it sits with the rest of
 * the Analyze tab rather than looking pasted in.
 */
export function GameLineCard({
  time,
  dayLabel,
  away,
  home,
  grid,
  marketStatus,
  teamsVerified,
  canAnalyze,
  onViewLines,
  onAnalyze,
  index,
}: {
  time: string;
  dayLabel: string;
  away: TeamSide;
  home: TeamSide;
  grid: GameLineGrid;
  marketStatus: MarketStatus;
  teamsVerified: boolean;
  canAnalyze: boolean;
  onViewLines: () => void;
  onAnalyze: () => void;
  index: number;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="vision-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-baseline gap-2">
          <span className="text-[15px] font-extrabold tabular-nums text-foreground">{time}</span>
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/55">{dayLabel}</span>
        </p>
        <MarketPill status={marketStatus} count={grid.liveMarkets} />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_repeat(3,3.6rem)] items-center gap-x-1.5 gap-y-2">
        <span />
        {["Spread", "Total", "ML"].map((label) => (
          <span key={label} className="text-center text-[8px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
            {label}
          </span>
        ))}

        <TeamRow side={away} row={grid.away} />
        <TeamRow side={home} row={grid.home} />
      </div>

      {!teamsVerified && (
        <p className="mt-2.5 text-[9px] font-semibold text-nba-yellow">Team verification pending</p>
      )}

      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onViewLines}
          className="flex items-center justify-center gap-1.5 rounded-xl py-3 text-[12px] font-bold text-foreground/85 transition-colors hover:text-foreground"
          style={{ background: "hsla(228,24%,14%,0.9)", border: "1px solid hsla(228,30%,22%,0.5)" }}
        >
          View lines <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-nba-green py-3 text-[12px] font-bold text-[#06140d] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Radar className="h-3.5 w-3.5" /> Analyze
        </button>
      </div>
    </motion.article>
  );
}

function TeamRow({ side, row }: { side: TeamSide; row: GameLineGridRow }) {
  const { city, nickname } = splitTeamName(side.name, side.shortName);
  return (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="shrink-0">{side.badge}</div>
        <div className="min-w-0 leading-tight">
          {city ? <p className="truncate text-[10px] text-muted-foreground/60">{city}</p> : null}
          <p className="truncate text-[14px] font-bold text-foreground">{nickname}</p>
        </div>
      </div>
      <OddsCell cell={row.spread} />
      <OddsCell cell={row.total} />
      <OddsCell cell={row.moneyline} />
    </>
  );
}

function OddsCell({ cell }: { cell: GridCell }) {
  const empty = cell.price === null;
  return (
    <div
      className="flex h-11 flex-col items-center justify-center rounded-lg text-center"
      style={{ background: "hsla(228,24%,10%,0.85)", border: "1px solid hsla(228,30%,22%,0.45)" }}
    >
      {empty ? (
        <span className="text-[12px] text-muted-foreground/35">–</span>
      ) : (
        <>
          {cell.line ? <span className="text-[11px] font-bold tabular-nums text-foreground">{cell.line}</span> : null}
          <span
            className={`tabular-nums ${cell.line ? "text-[9px] font-semibold" : "text-[12px] font-bold"} ${
              (cell.price as number) > 0 ? "text-nba-green" : cell.line ? "text-muted-foreground/70" : "text-foreground"
            }`}
          >
            {formatOdds(cell.price as number)}
          </span>
        </>
      )}
    </div>
  );
}

export function MarketPill({ status, count }: { status: MarketStatus; count: number }) {
  if (status === "live") {
    return (
      // `nba-green` is a hand-written utility in index.css, not a Tailwind
      // colour, so `/10`-style opacity variants would silently do nothing.
      <span
        className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold text-nba-green"
        style={{ background: "hsla(158,64%,52%,0.1)", border: "1px solid hsla(158,64%,52%,0.3)" }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-nba-green" style={{ boxShadow: "0 0 6px hsl(158 64% 52%)" }} />
        {count} market{count === 1 ? "" : "s"} live
      </span>
    );
  }
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] font-semibold text-muted-foreground/60">
      {status === "unavailable" ? "Odds unavailable" : "Not posted yet"}
    </span>
  );
}
