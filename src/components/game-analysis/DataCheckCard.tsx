import { Check, CircleAlert, Target } from "lucide-react";
import { buildInputNodes } from "@/lib/gameAnalysisInputs";
import { AnalysisCard, CardHeading } from "./AnalysisCard";
import { finiteValue } from "@/lib/finiteValue";

/**
 * Which model inputs were verified and which are still pending, plus the
 * coverage bar.
 *
 * Labels come from `gameAnalysisInputs` so raw keys like `LINEUP_UNCONFIRMED`
 * never reach the screen. Coverage is the model's own `data_coverage` — the
 * share of its weight budget that had real data behind it — not a count of the
 * rows below, which would be a different and softer number.
 */
export function DataCheckCard({
  missingInputs,
  feedMissing,
  coverage,
}: {
  missingInputs?: string[];
  feedMissing?: string[];
  coverage?: number | null;
}) {
  const nodes = buildInputNodes(missingInputs, feedMissing);
  if (!nodes.length) return null;

  const verified = nodes.filter((node) => node.verified).length;
  const coverageValue = finiteValue(coverage);
  const coveragePct = coverageValue === null ? null : Math.round(Math.max(0, Math.min(1, coverageValue)) * 100);

  return (
    <AnalysisCard>
      <CardHeading icon={Target} title="Data check" note={`${verified} of ${nodes.length} verified`} />

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-[11.5px] font-medium ${
              node.verified ? "text-foreground/85" : "text-muted-foreground"
            }`}
            style={{ background: "hsla(228,24%,10%,0.8)", border: "1px solid hsla(228,30%,22%,0.35)" }}
          >
            {node.verified
              ? <Check className="h-3.5 w-3.5 shrink-0 text-nba-green" strokeWidth={3} />
              : <CircleAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
            <span className="truncate">{node.label}</span>
          </div>
        ))}
      </div>

      {coveragePct !== null && (
        <div className="mt-3.5 flex items-center gap-2.5 text-[11px] font-semibold text-muted-foreground">
          Coverage
          <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "hsla(228,24%,20%,0.9)" }}>
            <span className="block h-full rounded-full bg-nba-green transition-[width] duration-700" style={{ width: `${coveragePct}%` }} />
          </span>
          <span className="text-[14px] font-bold text-nba-green tabular-nums">{coveragePct}%</span>
        </div>
      )}
    </AnalysisCard>
  );
}
