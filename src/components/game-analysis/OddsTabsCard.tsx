import { useState } from "react";
import { Zap } from "lucide-react";
import { formatOdds } from "@/utils/oddsFormat";
import { AnalysisCard, CardHeading } from "./AnalysisCard";
import type { GameAnalysisMarketKey, GameAnalysisReportMarket, GameAnalysisReportSelection } from "./GameAnalysisExperience";

const TAB_LABELS: Record<GameAnalysisMarketKey, string> = {
  totals: "Total",
  h2h: "Moneyline",
  spreads: "Spread",
};

const TAB_ORDER: GameAnalysisMarketKey[] = ["totals", "h2h", "spreads"];

/**
 * A spread's point is a handicap and carries its sign; a total's point is a
 * threshold and does not. Signing both turns "Over 8.0" into "Over +8", which
 * reads as a plus-eight line.
 */
function pointLabel(point: number | undefined, side: string) {
  if (point == null || !Number.isFinite(point)) return "";
  if (side === "over" || side === "under") return point.toFixed(1);
  return point > 0 ? `+${point}` : String(point);
}

/**
 * Published prices for every market, with the model's own side tagged.
 *
 * A market the model did not cover still shows its prices — the odds are real
 * and useful — under a note saying it was not modelled, so a missing tag is
 * never mistaken for the model passing on that side.
 */
export function OddsTabsCard({
  markets,
  selected,
  tierColor,
}: {
  markets: GameAnalysisReportMarket[];
  selected?: GameAnalysisReportSelection;
  tierColor: string;
}) {
  const available = TAB_ORDER.filter((key) => markets.some((market) => market.key === key));
  const [active, setActive] = useState<GameAnalysisMarketKey>(
    selected?.marketKey && available.includes(selected.marketKey) ? selected.marketKey : available[0] ?? "totals",
  );

  const market = markets.find((entry) => entry.key === active);
  if (!available.length || !market) return null;

  const quotes = market.entries.flatMap((entry) => (entry.quote ? [entry.quote] : []));
  const isModelled = market.state === "complete" && selected?.marketKey === active;

  return (
    <AnalysisCard>
      <CardHeading icon={Zap} title="Odds" />

      <div role="tablist" aria-label="Markets" className="mt-3 grid gap-1 rounded-xl p-1" style={{ background: "hsla(228,24%,10%,0.8)", gridTemplateColumns: `repeat(${available.length}, minmax(0, 1fr))` }}>
        {available.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === active}
            onClick={() => setActive(key)}
            className={`rounded-lg py-2 text-[12px] font-semibold transition-colors ${
              key === active ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {quotes.length > 0 ? (
        <div className="mt-1.5">
          {quotes.map((quote, index) => {
            const isPick = isModelled && selected?.quote?.side === quote.side;
            return (
              <div
                key={`${quote.side}-${index}`}
                className="mt-1.5 flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
                style={{
                  background: isPick ? `color-mix(in srgb, ${tierColor} 7%, hsla(228,24%,10%,0.8))` : "hsla(228,24%,10%,0.8)",
                  border: `1px solid ${isPick ? `color-mix(in srgb, ${tierColor} 50%, transparent)` : "hsla(228,30%,22%,0.35)"}`,
                }}
              >
                <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground">
                  <span className="truncate">{quote.label}{pointLabel(quote.point, quote.side) ? ` ${pointLabel(quote.point, quote.side)}` : ""}</span>
                  {isPick && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black tracking-wider"
                      style={{ background: `color-mix(in srgb, ${tierColor} 18%, transparent)`, color: tierColor }}
                    >
                      MODEL
                    </span>
                  )}
                </span>
                <span className={`shrink-0 text-[15px] font-bold tabular-nums ${quote.price > 0 ? "text-nba-green" : "text-foreground"}`}>
                  {formatOdds(quote.price)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-muted-foreground/60">No published prices returned for this market.</p>
      )}

      {!isModelled && quotes.length > 0 && (
        <p className="mt-2.5 text-[11px] text-muted-foreground/55">Not modeled yet. Shown for reference.</p>
      )}
    </AnalysisCard>
  );
}
