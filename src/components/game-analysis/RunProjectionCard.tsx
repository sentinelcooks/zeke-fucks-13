import { AlignLeft } from "lucide-react";
import { AnalysisCard, CardHeading } from "./AnalysisCard";
import { finiteValue } from "@/lib/finiteValue";

/**
 * The model's projected run total.
 *
 * The mockup splits this per team (4.3 vs 3.9). Nothing in the model produces
 * per-team runs — it returns a total and, separately, a margin — so this shows
 * the total as one bar against the book's line. Splitting the total by the
 * margin would look like two projections while being one projection and an
 * arithmetic guess.
 */
export function RunProjectionCard({
  projection,
  line,
  unit = "runs",
  title = "Run projection",
}: {
  projection?: number | null;
  line?: number | null;
  unit?: string;
  title?: string;
}) {
  const projected = finiteValue(projection);
  const bookLine = finiteValue(line);
  if (projected === null) return null;
  const hasLine = bookLine !== null;

  // Scale so both markers sit inside the bar with headroom on either side.
  const ceiling = Math.max(projected, hasLine ? bookLine! : projected) * 1.25;
  const projectedPct = Math.max(4, Math.min(100, (projected / ceiling) * 100));
  const linePct = hasLine ? Math.max(0, Math.min(100, (bookLine! / ceiling) * 100)) : null;

  return (
    <AnalysisCard>
      <CardHeading icon={AlignLeft} title={title} note={`${projected.toFixed(1)} ${unit}`} />
      <div className="relative mt-3 h-8 overflow-hidden rounded-lg" style={{ background: "hsla(228,24%,18%,0.8)" }}>
        <div
          className="flex h-full items-center rounded-lg px-3 text-[13px] font-bold text-white"
          style={{ width: `${projectedPct}%`, background: "linear-gradient(90deg, hsla(250,76%,62%,0.85), hsla(210,100%,60%,0.85))" }}
        >
          {projected.toFixed(1)}
        </div>
        {linePct !== null && (
          <span className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: `${linePct}%` }} aria-hidden />
        )}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>Model projection</span>
        {hasLine ? <span>Line {bookLine!.toFixed(1)}</span> : null}
      </div>
    </AnalysisCard>
  );
}
