import { CalendarDays } from "lucide-react";
import { AnalysisCard, CardHeading } from "./AnalysisCard";
import type { HeadToHeadRow } from "@/lib/gameAnalysisPresentation";

/**
 * Completed head-to-head games this season, or the empty state.
 *
 * MLB's game model does not return head-to-head yet, so the empty state is
 * what renders today. It says so plainly instead of hiding the section, since
 * "no prior meetings" is itself information about the matchup.
 */
export function PastMeetingsCard({ rows, season }: { rows: HeadToHeadRow[]; season?: string }) {
  return (
    <AnalysisCard>
      <CardHeading icon={CalendarDays} title="Past meetings" note={season} />

      {rows.length > 0 ? (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl px-3 py-2.5" style={{ background: "hsla(228,24%,10%,0.8)" }}>
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-[11px] font-bold text-foreground/85">{row.scoreLabel}</p>
                <p className="shrink-0 text-[9px] font-semibold text-nba-green">{row.outcomeLabel}</p>
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground/55">
                {row.dateLabel}{row.venue ? ` · ${row.venue}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold text-muted-foreground/45"
            style={{ border: "1px dashed hsla(228,30%,30%,0.5)" }}
          >
            0
          </span>
          No completed meetings between these teams were returned for this matchup.
        </div>
      )}
    </AnalysisCard>
  );
}
