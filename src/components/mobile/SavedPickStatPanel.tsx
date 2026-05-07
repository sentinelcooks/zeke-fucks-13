import { motion } from "framer-motion";
import { Building2, Gauge, Layers3, ShieldCheck } from "lucide-react";
import type { SavedPickMarket } from "@/lib/savedPick";

interface SavedPickStatPanelProps {
  sport: "nba" | "mlb" | "nhl" | "ufc" | "nfl" | string;
  market: SavedPickMarket | null;
  tier: string | null;
  team: string | null | undefined;
  opponent: string | null | undefined;
  evPct: number | null;
}

function qualityColor(q: string | null): string {
  if (q === "high") return "text-nba-green";
  if (q === "medium") return "text-nba-blue";
  if (q === "low") return "text-nba-yellow";
  return "text-foreground/65";
}

function depthColor(d: string | null): string {
  if (d === "deep" || d === "normal") return "text-foreground/80";
  if (d === "thin") return "text-nba-yellow";
  return "text-foreground/60";
}

export function SavedPickStatPanel({
  sport,
  market,
  tier,
  team,
  opponent,
  evPct,
}: SavedPickStatPanelProps) {
  if (!market) return null;

  const homeAway = market.eventHomeTeam && market.eventAwayTeam
    ? `${market.eventAwayTeam} @ ${market.eventHomeTeam}`
    : (team && opponent ? `${team} vs ${opponent}` : null);

  const impliedDisplay = market.impliedProbability != null
    ? `${Math.round(market.impliedProbability * (market.impliedProbability <= 1 ? 100 : 1))}%`
    : null;

  const evDisplay = evPct != null && Number.isFinite(evPct) && evPct !== 0
    ? `${evPct > 0 ? "+" : ""}${evPct.toFixed(1)}%`
    : null;

  const tierLabel = tier ? tier.toUpperCase() : null;

  const sportLabel = (sport || "").toString().toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
      className="vision-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">
          Scanner snapshot
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase text-muted-foreground/55">{sportLabel}</span>
          {tierLabel && (
            <span className="text-[9px] font-bold uppercase text-foreground/80 px-1.5 py-0.5 rounded" style={{ background: 'hsla(250, 76%, 62%, 0.18)' }}>
              {tierLabel}
            </span>
          )}
        </div>
      </div>

      {homeAway && (
        <p className="text-[11px] text-foreground/75 font-medium text-center">{homeAway}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {market.bestBook && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
            <Building2 className="w-3.5 h-3.5 text-muted-foreground/70" />
            <div className="min-w-0">
              <p className="text-[8px] uppercase font-bold text-muted-foreground/55 leading-none">Best book</p>
              <p className="text-[11px] font-extrabold text-foreground/90 truncate uppercase">{market.bestBook}</p>
            </div>
          </div>
        )}
        {market.bookCount != null && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
            <Layers3 className="w-3.5 h-3.5 text-muted-foreground/70" />
            <div className="min-w-0">
              <p className="text-[8px] uppercase font-bold text-muted-foreground/55 leading-none">Market depth</p>
              <p className={`text-[11px] font-extrabold truncate uppercase ${depthColor(market.marketDepth)}`}>
                {market.bookCount} {market.bookCount === 1 ? "book" : "books"}{market.marketDepth ? ` · ${market.marketDepth}` : ""}
              </p>
            </div>
          </div>
        )}
        {impliedDisplay && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
            <Gauge className="w-3.5 h-3.5 text-muted-foreground/70" />
            <div className="min-w-0">
              <p className="text-[8px] uppercase font-bold text-muted-foreground/55 leading-none">Implied prob.</p>
              <p className="text-[11px] font-extrabold text-foreground/90 tabular-nums">{impliedDisplay}</p>
            </div>
          </div>
        )}
        {market.marketDataQuality && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
            <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground/70" />
            <div className="min-w-0">
              <p className="text-[8px] uppercase font-bold text-muted-foreground/55 leading-none">Quality</p>
              <p className={`text-[11px] font-extrabold uppercase ${qualityColor(market.marketDataQuality)}`}>
                {market.marketDataQuality}
              </p>
            </div>
          </div>
        )}
      </div>

      {(evDisplay || market.consensusLine != null) && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 pt-1 border-t border-border/30">
          {market.consensusLine != null && (
            <span>Consensus line: <span className="text-foreground/80 font-bold tabular-nums">{market.consensusLine}</span></span>
          )}
          {evDisplay && (
            <span>Stored EV: <span className="text-foreground/80 font-bold tabular-nums">{evDisplay}</span></span>
          )}
        </div>
      )}

      {market.edgeDowngradeReason && (
        <p className="text-[10px] text-nba-yellow/80 italic">Edge note: {market.edgeDowngradeReason}</p>
      )}
    </motion.div>
  );
}
