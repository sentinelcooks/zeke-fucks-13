import { BarChart3 } from "lucide-react";
import { AnalysisCard, CardHeading } from "./AnalysisCard";
import type { GameAnalysisTeamStats } from "@/lib/gameAnalysisPresentation";
import { finiteValue } from "@/lib/finiteValue";

interface Row {
  label: string;
  away: number;
  home: number;
  /** Which direction is better for the team. */
  better: "high" | "low";
  decimals: number;
}

function buildRows(away?: GameAnalysisTeamStats | null, home?: GameAnalysisTeamStats | null): Row[] {
  const rows: Row[] = [];
  const pair = (key: keyof GameAnalysisTeamStats) => {
    const a = finiteValue(away?.[key]);
    const h = finiteValue(home?.[key]);
    // Both sides are required: a bar against a missing opponent value would
    // render as a shutout rather than as absent data.
    return a !== null && h !== null ? [a, h] : null;
  };

  const runs = pair("runsPerGame");
  if (runs) rows.push({ label: "Runs per game", away: runs[0], home: runs[1], better: "high", decimals: 2 });

  const bullpen = pair("bullpenEra");
  if (bullpen) rows.push({ label: "Bullpen ERA", away: bullpen[0], home: bullpen[1], better: "low", decimals: 2 });

  const ops = pair("ops");
  if (ops) rows.push({ label: "Team OPS", away: ops[0], home: ops[1], better: "high", decimals: 3 });

  return rows;
}

/**
 * Mirrored bars, away on the left and home on the right, with the better side's
 * number in green.
 *
 * The mockup also lists "OPS last 10" and "runs allowed". Neither is computed
 * anywhere in the codebase, so those rows are absent rather than approximated
 * from season totals. If every row is missing — which is the case until the
 * model's team-stats addition is deployed — the whole card hides.
 */
export function TeamComparisonCard({
  awayTeam,
  homeTeam,
  awayStats,
  homeStats,
}: {
  awayTeam: string;
  homeTeam: string;
  awayStats?: GameAnalysisTeamStats | null;
  homeStats?: GameAnalysisTeamStats | null;
}) {
  const rows = buildRows(awayStats, homeStats);
  if (!rows.length) return null;

  return (
    <AnalysisCard>
      <CardHeading icon={BarChart3} title="Team comparison" />
      {/* Two full club names do not fit beside the heading at phone width, so
          the sides are named on their own row, colour-keyed to their bars. */}
      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] font-semibold text-muted-foreground/70">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "hsl(220 72% 60%)" }} />
          <span className="truncate">{awayTeam}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{homeTeam}</span>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "hsl(342 66% 55%)" }} />
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-3.5">
        {rows.map((row) => {
          const awayWins = row.better === "high" ? row.away >= row.home : row.away <= row.home;
          const ceiling = Math.max(row.away, row.home) * 1.15 || 1;
          const format = (value: number) =>
            row.decimals === 3 ? value.toFixed(3).replace(/^0/, "") : value.toFixed(row.decimals);

          return (
            <div key={row.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className={`text-[14px] font-semibold tabular-nums ${awayWins ? "text-nba-green" : "text-foreground"}`}>
                  {format(row.away)}
                </span>
                <span className="text-[11px] text-muted-foreground">{row.label}</span>
                <span className={`text-[14px] font-semibold tabular-nums ${awayWins ? "text-foreground" : "text-nba-green"}`}>
                  {format(row.home)}
                </span>
              </div>
              <div className="grid h-1.5 grid-cols-2 gap-1">
                <div className="relative overflow-hidden rounded-full" style={{ background: "hsla(228,24%,20%,0.9)" }}>
                  <span className="absolute inset-y-0 right-0 rounded-full" style={{ width: `${(row.away / ceiling) * 100}%`, background: "hsl(220 72% 60%)" }} />
                </div>
                <div className="relative overflow-hidden rounded-full" style={{ background: "hsla(228,24%,20%,0.9)" }}>
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(row.home / ceiling) * 100}%`, background: "hsl(342 66% 55%)" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AnalysisCard>
  );
}
