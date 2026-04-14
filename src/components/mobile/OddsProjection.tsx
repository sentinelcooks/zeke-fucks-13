import { useState, useEffect } from "react";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, TrendingUp, TrendingDown, Zap, Shield, Crown, ArrowRight, HelpCircle, ChevronDown } from "lucide-react";
import { fetchPlayerOdds } from "@/services/oddsApi";

interface OddsProjectionProps {
  playerName: string;
  propType: string;
  line: number;
  overUnder: "over" | "under";
  sport?: "nba" | "mlb" | "nhl" | "nfl" | "ufc" | "soccer";
  modelHitRate?: number;
  seasonHitRate?: number;
  last10HitRate?: number;
  last5HitRate?: number;
  h2hHitRate?: number;
}

// formatOdds removed — using useOddsFormat hook instead

function impliedProb(odds: number): number {
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100) * 100;
  return 100 / (odds + 100) * 100;
}

// Vig-free / no-vig implied probability (devigging)
function noVigProb(overOdds: number, underOdds: number): { over: number; under: number } {
  const overRaw = impliedProb(overOdds);
  const underRaw = impliedProb(underOdds);
  const total = overRaw + underRaw;
  return { over: (overRaw / total) * 100, under: (underRaw / total) * 100 };
}

// Calculate the composite model hit rate using weighted factors
function calculateModelHitRate(params: {
  seasonRate?: number;
  last10Rate?: number;
  last5Rate?: number;
  h2hRate?: number;
}): number {
  const { seasonRate, last10Rate, last5Rate, h2hRate } = params;
  
  // Weighted model: recent form matters most
  // L5: 35%, L10: 25%, Season: 20%, H2H: 20%
  const weights = { l5: 0.35, l10: 0.25, season: 0.20, h2h: 0.20 };
  let totalWeight = 0;
  let weightedSum = 0;

  if (last5Rate != null && last5Rate > 0) { weightedSum += last5Rate * weights.l5; totalWeight += weights.l5; }
  if (last10Rate != null && last10Rate > 0) { weightedSum += last10Rate * weights.l10; totalWeight += weights.l10; }
  if (seasonRate != null && seasonRate > 0) { weightedSum += seasonRate * weights.season; totalWeight += weights.season; }
  if (h2hRate != null && h2hRate > 0) { weightedSum += h2hRate * weights.h2h; totalWeight += weights.h2h; }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

// Calculate Expected Value
function calculateEV(modelProb: number, odds: number): number {
  const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
  // EV = (prob * (decimalOdds - 1)) - (1 - prob)
  // EV as percentage of stake
  return ((modelProb / 100) * (decimalOdds - 1) - (1 - modelProb / 100)) * 100;
}

function getEVColor(ev: number): string {
  if (ev >= 10) return "text-nba-green";
  if (ev >= 5) return "text-nba-green";
  if (ev >= 0) return "text-nba-blue";
  if (ev >= -5) return "text-nba-yellow";
  return "text-nba-red";
}

function getEVBg(ev: number): string {
  if (ev >= 5) return "from-[hsla(158,64%,52%,0.15)] to-transparent";
  if (ev >= 0) return "from-[hsla(211,100%,60%,0.12)] to-transparent";
  if (ev >= -5) return "from-[hsla(43,96%,56%,0.1)] to-transparent";
  return "from-[hsla(0,72%,51%,0.12)] to-transparent";
}

function getEdgeLabel(edge: number): { label: string; color: string; bg: string } {
  if (edge >= 10) return { label: "STRONG EDGE", color: "text-nba-green", bg: "bg-nba-green/10" };
  if (edge >= 5) return { label: "EDGE", color: "text-nba-green", bg: "bg-nba-green/10" };
  if (edge >= 2) return { label: "SLIGHT EDGE", color: "text-nba-blue", bg: "bg-nba-blue/10" };
  if (edge >= 0) return { label: "FAIR", color: "text-muted-foreground", bg: "bg-secondary/40" };
  if (edge >= -5) return { label: "OVERPRICED", color: "text-nba-yellow", bg: "bg-nba-yellow/10" };
  return { label: "BAD VALUE", color: "text-nba-red", bg: "bg-nba-red/10" };
}

const BOOK_ICONS: Record<string, string> = {
  FanDuel: "FD",
  DraftKings: "DK",
  BetMGM: "MG",
  "Caesars Sportsbook": "CZ",
  "PointsBet (US)": "PB",
  PointsBet: "PB",
  Bovada: "BV",
  "BetOnline.ag": "BO",
  "William Hill (US)": "WH",
  "ESPN BET": "ES",
  Fliff: "FL",
  "Hard Rock Bet": "HR",
  BetRivers: "BR",
  SuperBook: "SB",
  WynnBET: "WB",
  BetAnySports: "BA",
};

const BOOK_GRADIENTS: Record<string, string> = {
  FanDuel: "from-[hsl(210,100%,55%)] to-[hsl(210,100%,40%)]",
  DraftKings: "from-[hsl(145,70%,45%)] to-[hsl(160,60%,35%)]",
  BetMGM: "from-[hsl(40,90%,50%)] to-[hsl(35,85%,40%)]",
  "Caesars Sportsbook": "from-[hsl(250,60%,55%)] to-[hsl(250,50%,40%)]",
  "PointsBet (US)": "from-[hsl(350,70%,55%)] to-[hsl(340,60%,40%)]",
  PointsBet: "from-[hsl(350,70%,55%)] to-[hsl(340,60%,40%)]",
  Bovada: "from-[hsl(0,70%,50%)] to-[hsl(0,60%,38%)]",
  "BetOnline.ag": "from-[hsl(30,80%,50%)] to-[hsl(25,70%,38%)]",
  "William Hill (US)": "from-[hsl(210,60%,45%)] to-[hsl(215,50%,35%)]",
  "ESPN BET": "from-[hsl(0,80%,48%)] to-[hsl(0,70%,35%)]",
  Fliff: "from-[hsl(280,70%,55%)] to-[hsl(280,60%,40%)]",
  "Hard Rock Bet": "from-[hsl(45,85%,50%)] to-[hsl(40,75%,38%)]",
  BetRivers: "from-[hsl(200,80%,45%)] to-[hsl(205,70%,35%)]",
  SuperBook: "from-[hsl(220,70%,50%)] to-[hsl(225,60%,38%)]",
  WynnBET: "from-[hsl(340,70%,50%)] to-[hsl(345,60%,38%)]",
  BetAnySports: "from-[hsl(170,60%,45%)] to-[hsl(175,50%,35%)]",
};

const BOOK_SHORT: Record<string, string> = {
  "Caesars Sportsbook": "Caesars",
  "PointsBet (US)": "PointsBet",
  "BetOnline.ag": "BetOnline",
  "William Hill (US)": "William Hill",
  "Hard Rock Bet": "Hard Rock",
};

function EdgeExplainer({ modelRate, impliedRate, edge, ev }: { modelRate: number; impliedRate: number; edge: number; ev: number }) {
  const [open, setOpen] = useState(false);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)',
        border: '1px solid hsla(250,76%,62%,0.15)',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left group"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
            <HelpCircle className="w-3.5 h-3.5 text-accent" />
          </div>
          <span className="text-[11px] font-bold text-foreground/70 group-hover:text-foreground transition-colors">
            What do Edge & EV mean?
          </span>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }}>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Edge explanation */}
              <div className="rounded-xl p-3.5 space-y-2" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-nba-cyan" />
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[hsl(var(--nba-cyan))]">Edge</span>
                </div>
                <p className="text-[11px] text-foreground/60 leading-relaxed">
                  Edge is the difference between what <strong className="text-foreground/80">our model thinks will happen</strong> and what the <strong className="text-foreground/80">sportsbooks think</strong>.
                </p>
                <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'hsla(228, 20%, 8%, 0.7)' }}>
                  <p className="text-[10px] text-muted-foreground/50 italic">Example with this prop:</p>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-accent font-bold">Our model: {modelRate.toFixed(0)}%</span>
                    <span className="text-muted-foreground/55">—</span>
                    <span className="text-foreground/50 font-bold">Books: {impliedRate.toFixed(0)}%</span>
                    <span className="text-muted-foreground/55">=</span>
                    <span className={`font-extrabold ${edge > 0 ? 'text-nba-green' : 'text-nba-red'}`}>{edge > 0 ? '+' : ''}{edge.toFixed(1)}% edge</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/65 leading-relaxed mt-1">
                    {edge > 0 
                      ? `The books are pricing this at ${impliedRate.toFixed(0)}% probability, but our data shows it hits ${modelRate.toFixed(0)}% of the time. That's a mispricing we can capitalize on.`
                      : `The books are pricing this more aggressively than our model suggests. The line may be fairly priced or overvalued.`
                    }
                  </p>
                </div>
              </div>

              {/* EV explanation */}
              <div className="rounded-xl p-3.5 space-y-2" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 text-nba-green" />
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-nba-green">Expected Value (EV)</span>
                </div>
                <p className="text-[11px] text-foreground/60 leading-relaxed">
                  EV tells you <strong className="text-foreground/80">how much you'd profit per $100 bet</strong> over time if our model is right. Positive EV (+EV) means the bet is profitable long-term.
                </p>
                <div className="rounded-lg p-3" style={{ background: 'hsla(228, 20%, 8%, 0.7)' }}>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground/50">This bet's EV:</span>
                    <span className={`font-extrabold ${ev > 0 ? 'text-nba-green' : 'text-nba-red'}`}>{ev > 0 ? '+' : ''}{ev.toFixed(1)}%</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/65 leading-relaxed mt-1.5">
                    {ev > 0
                      ? `For every $100 wagered on bets like this, you'd expect to profit ~$${ev.toFixed(0)} on average over time.`
                      : `This bet would lose ~$${Math.abs(ev).toFixed(0)} per $100 wagered over time. Look for +EV opportunities instead.`
                    }
                  </p>
                </div>
              </div>

              {/* Quick tips */}
              <div className="rounded-xl p-3" style={{ background: 'hsla(158, 64%, 52%, 0.04)', border: '1px solid hsla(158, 64%, 52%, 0.08)' }}>
                <span className="text-[9px] font-bold uppercase tracking-wider text-nba-green/60 block mb-1.5">💡 Quick Tips</span>
                <ul className="space-y-1">
                  {[
                    "Edge > 5% = strong mispricing worth betting",
                    "Always bet +EV to be profitable long-term",
                    "Higher edge = more confident the books are wrong",
                  ].map((tip, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[10px] text-foreground/50">
                      <span className="text-nba-green mt-0.5">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function OddsProjection({ 
  playerName, propType, line, overUnder, sport = "nba",
  modelHitRate, seasonHitRate, last10HitRate, last5HitRate, h2hHitRate
}: OddsProjectionProps) {
  const { fmt: formatOdds } = useOddsFormat();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<any>(null);

  const fetchOdds = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchPlayerOdds(playerName, propType, overUnder, sport);
      if (result.found && result.books?.length > 0) {
        // Filter: exact line first, then alt lines below (never above)
        const exactMatches = result.books.filter((b: any) => b.line === line);
        const belowMatches = result.books.filter((b: any) => b.line < line);
        const filtered = exactMatches.length > 0 ? exactMatches : belowMatches;
        if (filtered.length > 0) {
          setData({ ...result, books: filtered });
        } else {
          setError("No odds found for this exact line");
        }
      } else if (result.found) {
        setData(result);
      } else {
        setError(result.message || "No odds available for this player");
      }
    } catch (e: any) {
      setError("Failed to fetch live odds");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (playerName) fetchOdds();
  }, [playerName, propType, overUnder]);

  // Calculate composite model hit rate
  const compositeModelRate = modelHitRate || calculateModelHitRate({
    seasonRate: seasonHitRate,
    last10Rate: last10HitRate,
    last5Rate: last5HitRate,
    h2hRate: h2hHitRate,
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-border/30" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
        </div>
        <p className="text-xs text-muted-foreground/65">Fetching live odds from 5 books...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vision-card p-5 text-center space-y-3">
        <AlertTriangle className="w-5 h-5 text-muted-foreground/65 mx-auto" />
        <p className="text-xs text-muted-foreground/50">{error}</p>
        <button onClick={fetchOdds} className="text-[11px] text-accent font-bold hover:underline flex items-center gap-1 mx-auto">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  if (!data || !data.books?.length) {
    return (
      <div className="vision-card p-5 text-center">
        <p className="text-xs text-muted-foreground/65">No odds data available</p>
      </div>
    );
  }

  const books: Array<{ book: string; odds: number; line: number }> = data.books;
  const bestBook = books[0]; // sorted best-first from API
  const avgImplied = books.reduce((sum, b) => sum + impliedProb(b.odds), 0) / books.length;
  const bestImplied = impliedProb(bestBook.odds);

  // EV calculations for each book
  const booksWithEV = books.map(b => {
    const implied = impliedProb(b.odds);
    const ev = compositeModelRate > 0 ? calculateEV(compositeModelRate, b.odds) : 0;
    const edge = compositeModelRate > 0 ? compositeModelRate - implied : 0;
    return { ...b, implied, ev, edge };
  });

  const bestEV = booksWithEV[0];
  const edgeInfo = getEdgeLabel(bestEV.edge);
  const hasPositiveEV = bestEV.ev > 0;

  return (
    <div className="space-y-3">
      {/* Event context */}
      {data.event && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/65 px-1">
          <span className="font-medium">{data.event.home} vs {data.event.away}</span>
          <button onClick={fetchOdds} className="flex items-center gap-1 text-accent/60 hover:text-accent transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      )}

      {/* ── MODEL vs MARKET COMPARISON ── */}
      {compositeModelRate > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`relative rounded-2xl overflow-hidden p-5`}
          style={{
            background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)',
            border: `1px solid ${hasPositiveEV ? 'hsla(158,64%,52%,0.25)' : 'hsla(228,30%,22%,0.3)'}`,
          }}
        >
          {/* Glow for +EV */}
          {hasPositiveEV && <div className="absolute inset-0 bg-gradient-to-b from-[hsla(158,64%,52%,0.06)] to-transparent pointer-events-none" />}

          <div className="relative z-10">
            {/* EV Verdict Banner */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {hasPositiveEV ? (
                  <div className="w-8 h-8 rounded-lg bg-nba-green/15 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-nba-green" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-nba-red/15 flex items-center justify-center">
                    <TrendingDown className="w-4 h-4 text-nba-red" />
                  </div>
                )}
                <div>
                  <p className={`text-[13px] font-extrabold ${hasPositiveEV ? "text-nba-green" : "text-nba-red"}`}>
                    {hasPositiveEV ? "+EV Opportunity" : "Negative EV"}
                  </p>
                  <p className="text-[9px] text-muted-foreground/65">Model vs Market comparison</p>
                </div>
              </div>
              <div className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider ${edgeInfo.bg} ${edgeInfo.color}`}>
                {edgeInfo.label}
              </div>
            </div>

            {/* Model vs Implied visual comparison */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-xl p-3 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.7)' }}>
                <div className="flex items-center justify-center gap-1 mb-1.5">
                  <Zap className="w-3 h-3 text-accent" />
                  <span className="text-[8px] font-bold uppercase tracking-wider text-accent/60">Our Model</span>
                </div>
                <span className="block text-xl font-extrabold tabular-nums text-accent">{compositeModelRate.toFixed(1)}%</span>
                <span className="block text-[8px] text-muted-foreground/55 mt-0.5">Hit Probability</span>
              </div>
              <div className="rounded-xl p-3 text-center flex flex-col items-center justify-center" style={{ background: 'hsla(228, 20%, 10%, 0.7)' }}>
                <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/65 mb-1">Implied</span>
                <span className="block text-xl font-extrabold tabular-nums text-foreground/60">{bestImplied.toFixed(1)}%</span>
                <span className="block text-[8px] text-muted-foreground/55 mt-0.5">Best Book</span>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.7)' }}>
                <div className="flex items-center justify-center gap-1 mb-1.5">
                  <Shield className="w-3 h-3 text-nba-cyan" />
                  <span className="text-[8px] font-bold uppercase tracking-wider text-[hsl(var(--nba-cyan))]/60">Edge</span>
                </div>
                <span className={`block text-xl font-extrabold tabular-nums ${getEVColor(bestEV.edge)}`}>
                  {bestEV.edge > 0 ? "+" : ""}{bestEV.edge.toFixed(1)}%
                </span>
                <span className="block text-[8px] text-muted-foreground/55 mt-0.5">Model Edge</span>
              </div>
            </div>

            {/* Edge projection bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/55">Edge Projection</span>
                <span className={`text-[11px] font-extrabold tabular-nums ${getEVColor(bestEV.ev)}`}>
                  EV: {bestEV.ev > 0 ? "+" : ""}{bestEV.ev.toFixed(1)}%
                </span>
              </div>
              <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'hsla(228, 20%, 12%, 0.8)' }}>
                {/* Implied prob bar */}
                <div
                  className="absolute top-0 left-0 h-full rounded-full opacity-30"
                  style={{ width: `${Math.min(bestImplied, 100)}%`, background: 'hsl(228 10% 45%)' }}
                />
                {/* Model prob bar */}
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(compositeModelRate, 100)}%` }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className="absolute top-0 left-0 h-full rounded-full"
                  style={{ background: hasPositiveEV
                    ? 'linear-gradient(90deg, hsl(158 64% 52% / 0.8), hsl(158 64% 52% / 0.4))'
                    : 'linear-gradient(90deg, hsl(0 72% 51% / 0.7), hsl(0 72% 51% / 0.3))'
                  }}
                />
                {/* Line marker for implied */}
                <div
                  className="absolute top-0 h-full w-px bg-foreground/30"
                  style={{ left: `${Math.min(bestImplied, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[8px] text-muted-foreground/50">0%</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[8px] text-muted-foreground/55">
                    <span className="w-2 h-1 rounded-full" style={{ background: hasPositiveEV ? 'hsl(158 64% 52%)' : 'hsl(0 72% 51%)' }} /> Model
                  </span>
                  <span className="flex items-center gap-1 text-[8px] text-muted-foreground/55">
                    <span className="w-2 h-1 rounded-full bg-muted-foreground/55" /> Implied
                  </span>
                </div>
                <span className="text-[8px] text-muted-foreground/50">100%</span>
              </div>
            </div>

            {/* Model breakdown weights */}
            <div className="rounded-xl p-3" style={{ background: 'hsla(228, 20%, 10%, 0.5)' }}>
              <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/50 block mb-2">Model Weights</span>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "L5", rate: last5HitRate, weight: "35%" },
                  { label: "L10", rate: last10HitRate, weight: "25%" },
                  { label: "Season", rate: seasonHitRate, weight: "20%" },
                  { label: "H2H", rate: h2hHitRate, weight: "20%" },
                ].map(w => (
                  <div key={w.label} className="text-center">
                    <span className={`block text-[12px] font-extrabold tabular-nums ${
                      (w.rate || 0) >= 60 ? "text-nba-green" : (w.rate || 0) >= 45 ? "text-foreground/60" : "text-nba-red"
                    }`}>{w.rate != null ? `${w.rate}%` : "—"}</span>
                    <span className="block text-[8px] text-muted-foreground/55">{w.label} ({w.weight})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── WHAT IS EDGE & EV EXPLAINER ── */}
      {compositeModelRate > 0 && (
        <EdgeExplainer
          modelRate={compositeModelRate}
          impliedRate={bestImplied}
          edge={bestEV.edge}
          ev={bestEV.ev}
        />
      )}

      {/* ── BEST BOOK CARD ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="relative rounded-2xl overflow-hidden p-4"
        style={{
          background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)',
          border: '1px solid hsla(158,64%,52%,0.2)',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[hsla(158,64%,52%,0.04)] to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-nba-green" />
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-nba-green/70">Best Line Available</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${BOOK_GRADIENTS[bestBook.book] || 'from-accent to-accent/60'} flex items-center justify-center shadow-lg`}>
                <span className="text-[12px] font-black text-white">{BOOK_ICONS[bestBook.book] || bestBook.book.slice(0, 2).toUpperCase()}</span>
              </div>
              <div>
                <p className="text-[15px] font-extrabold text-foreground">{BOOK_SHORT[bestBook.book] || bestBook.book}</p>
                <p className="text-[10px] text-muted-foreground/65">{overUnder.toUpperCase()} {bestBook.line}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black tabular-nums font-mono text-nba-green">{formatOdds(bestBook.odds)}</p>
              <p className="text-[10px] text-muted-foreground/65 tabular-nums">{bestImplied.toFixed(1)}% implied</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── ALL BOOKS COMPARISON ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55">All Sportsbooks</span>
          <span className="text-[9px] text-muted-foreground/50">{books.length} books</span>
        </div>

        {booksWithEV.map((book, i) => {
          const isBest = i === 0;

          return (
            <motion.div
              key={book.book}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className={`relative rounded-xl overflow-hidden transition-all ${
                isBest ? "ring-1 ring-nba-green/20" : ""
              }`}
              style={{
                background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.7) 19.41%, hsla(228, 30%, 8%, 0.4) 76.65%)',
                border: '1px solid hsla(228, 30%, 22%, 0.2)',
              }}
            >
              <div className="flex items-center justify-between px-4 py-3.5">
                {/* Book info */}
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${BOOK_GRADIENTS[book.book] || 'from-secondary to-secondary/60'} flex items-center justify-center`}>
                    <span className="text-[10px] font-black text-white">{BOOK_ICONS[book.book] || book.book.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold text-foreground/80">{BOOK_SHORT[book.book] || book.book}</span>
                      {isBest && <span className="text-[8px] font-black text-nba-green bg-nba-green/10 px-1.5 py-0.5 rounded-md">BEST</span>}
                    </div>
                    <span className="text-[9px] text-muted-foreground/55">{overUnder.toUpperCase()} {book.line}</span>
                  </div>
                </div>

                {/* Odds + EV */}
                <div className="flex items-center gap-4">
                  {/* Implied prob */}
                  <div className="text-center">
                    <span className="block text-[10px] font-bold tabular-nums text-foreground/50">{book.implied.toFixed(1)}%</span>
                    <span className="block text-[7px] text-muted-foreground/50 uppercase">Implied</span>
                  </div>

                  {/* EV */}
                  {compositeModelRate > 0 && (
                    <div className="text-center min-w-[44px]">
                      <span className={`block text-[10px] font-bold tabular-nums ${getEVColor(book.ev)}`}>
                        {book.ev > 0 ? "+" : ""}{book.ev.toFixed(1)}%
                      </span>
                      <span className="block text-[7px] text-muted-foreground/50 uppercase">EV</span>
                    </div>
                  )}

                  {/* Odds */}
                  <div className="text-right min-w-[52px]">
                    <span className={`block text-[15px] font-black font-mono tabular-nums ${
                      isBest ? "text-nba-green" : "text-foreground/70"
                    }`}>
                      {formatOdds(book.odds)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Edge bar per book */}
              {compositeModelRate > 0 && (
                <div className="px-4 pb-2.5">
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'hsla(228, 20%, 12%, 0.8)' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(Math.max(book.edge + 50, 0), 100)}%` }}
                      transition={{ duration: 0.6, delay: 0.2 + i * 0.05 }}
                      className="h-full rounded-full"
                      style={{ background: book.edge > 0
                        ? 'linear-gradient(90deg, hsl(158 64% 52% / 0.6), hsl(158 64% 52% / 0.3))'
                        : 'linear-gradient(90deg, hsl(0 72% 51% / 0.5), hsl(0 72% 51% / 0.2))'
                      }}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* ── SUMMARY FOOTER ── */}
      <div className="rounded-xl p-3 text-center space-y-1" style={{ background: 'hsla(228, 20%, 10%, 0.4)' }}>
        <div className="flex items-center justify-center gap-4 text-[10px]">
          <span className="text-muted-foreground/55">
            Avg implied: <span className="font-bold text-foreground/50 tabular-nums">{avgImplied.toFixed(1)}%</span>
          </span>
          {compositeModelRate > 0 && (
            <>
              <span className="text-muted-foreground/65">·</span>
              <span className="text-muted-foreground/55">
                Model: <span className="font-bold text-accent tabular-nums">{compositeModelRate.toFixed(1)}%</span>
              </span>
              <span className="text-muted-foreground/65">·</span>
              <span className={`font-bold tabular-nums ${getEVColor(bestEV.ev)}`}>
                {bestEV.ev > 0 ? "+" : ""}{bestEV.ev.toFixed(1)}% EV
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
