import { useState, useEffect } from "react";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { Trophy, TrendingUp, TrendingDown, Loader2, AlertTriangle, RefreshCw, Zap, Crown } from "lucide-react";
import { motion } from "framer-motion";
import { fetchPlayerOdds } from "@/services/oddsApi";
import { getSportsbookInfo } from "@/utils/sportsbookLogos";

interface OddsComparisonProps {
  playerName: string;
  propType: string;
  line: number;
  overUnder: "over" | "under";
  sport?: "nba" | "mlb" | "nhl" | "nfl" | "ufc" | "soccer";
  modelHitRate?: number;
}

interface BookOdds {
  book: string;
  odds: number;
  line: number;
}

function BookLogo({ bookKey, size = 28 }: { bookKey: string; size?: number }) {
  const info = getSportsbookInfo(bookKey);
  if (info.logo) {
    return (
      <div className="rounded-lg overflow-hidden flex items-center justify-center" style={{ width: size, height: size, background: 'hsla(228, 20%, 14%, 0.6)', border: '1px solid hsla(228, 20%, 22%, 0.3)' }}>
        <img src={info.logo} alt={info.label} className="w-5 h-5 object-contain" loading="lazy" />
      </div>
    );
  }
  return (
    <div className="rounded-lg flex items-center justify-center text-[9px] font-black text-white" style={{ width: size, height: size, background: info.color }}>
      {info.abbrev}
    </div>
  );
}

// Implied probability from American odds
function impliedProb(odds: number): number {
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100) * 100;
  return 100 / (odds + 100) * 100;
}

// Expected Value calculation
function calculateEV(modelProb: number, odds: number): number {
  const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
  return ((modelProb / 100) * decimalOdds - 1) * 100;
}

// Edge = model probability - implied probability
function calculateEdge(modelProb: number, impliedProbability: number): number {
  return modelProb - impliedProbability;
}

const OddsComparison = ({ playerName, propType, line, overUnder, sport = "nba", modelHitRate }: OddsComparisonProps) => {
  const { fmt } = useOddsFormat();
  const [books, setBooks] = useState<BookOdds[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchOdds = async () => {
    if (!playerName || !line || line <= 0) { setBooks([]); return; }
    setLoading(true);
    setError("");
    try {
      const data = await fetchPlayerOdds(playerName, propType, overUnder, sport);
      if (data.found && data.books?.length > 0) {
        setBooks(data.books);
      } else {
        setBooks([]);
        setError("No live odds found for this player");
      }
    } catch {
      setError("Failed to fetch live odds");
      setBooks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOdds(); }, [playerName, propType, line, overUnder, sport]);

  if (!playerName || !line || line <= 0) return null;

  const bestOdds = books.length > 0 ? books.reduce((best, b) => b.odds > best.odds ? b : best) : null;
  const worstOdds = books.length > 0 ? books.reduce((worst, b) => b.odds < worst.odds ? b : worst) : null;

  // Calculate market consensus (average implied probability across all books)
  const avgImplied = books.length > 0
    ? books.reduce((sum, b) => sum + impliedProb(b.odds), 0) / books.length
    : 0;

  // Best line EV
  const bestEV = bestOdds && modelHitRate ? calculateEV(modelHitRate, bestOdds.odds) : null;
  const bestEdge = bestOdds && modelHitRate ? calculateEdge(modelHitRate, impliedProb(bestOdds.odds)) : null;

  // Juice saved by picking best over worst
  const juiceSaved = bestOdds && worstOdds && books.length > 1
    ? impliedProb(worstOdds.odds) - impliedProb(bestOdds.odds)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="vision-card overflow-hidden relative"
    >
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(270,60%,55%,0.15), transparent)' }} />

      <div className="px-5 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-accent" />
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50">Platform Odds</span>
          </div>
          {books.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: 'hsla(158, 64%, 52%, 0.08)', border: '1px solid hsla(158, 64%, 52%, 0.15)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-pulse" />
                <span className="text-[7px] font-bold text-nba-green uppercase tracking-wider">Live</span>
              </div>
              <span className="text-[8px] text-muted-foreground/40 font-medium">{books.length} books</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-accent/40" />
            <p className="text-[10px] text-muted-foreground/40">Fetching live odds from {sport === "ufc" ? "fight" : books.length || 5} books...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-6 gap-2">
            <AlertTriangle className="w-5 h-5 text-muted-foreground/55" />
            <p className="text-[11px] text-muted-foreground/65">{error}</p>
            <button onClick={fetchOdds} className="flex items-center gap-1 text-[10px] text-accent font-bold mt-1">
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : books.length === 0 ? null : (
          <>
            {/* EV + Edge Summary (only when model hit rate is available) */}
            {modelHitRate && bestOdds && bestEV !== null && bestEdge !== null && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="rounded-xl px-2.5 py-2 text-center" style={{ background: bestEV > 0 ? 'hsla(145, 60%, 45%, 0.08)' : 'hsla(0, 72%, 51%, 0.08)', border: `1px solid ${bestEV > 0 ? 'hsla(145, 60%, 45%, 0.15)' : 'hsla(0, 72%, 51%, 0.15)'}` }}>
                  <p className="text-[7px] text-muted-foreground/45 font-bold uppercase tracking-wider mb-0.5">Best EV</p>
                  <p className={`text-[13px] font-black tabular-nums ${bestEV > 0 ? 'text-nba-green' : 'text-red-400'}`}>
                    {bestEV > 0 ? "+" : ""}{bestEV.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl px-2.5 py-2 text-center" style={{ background: bestEdge > 0 ? 'hsla(145, 60%, 45%, 0.08)' : 'hsla(0, 72%, 51%, 0.08)', border: `1px solid ${bestEdge > 0 ? 'hsla(145, 60%, 45%, 0.15)' : 'hsla(0, 72%, 51%, 0.15)'}` }}>
                  <p className="text-[7px] text-muted-foreground/45 font-bold uppercase tracking-wider mb-0.5">Edge</p>
                  <p className={`text-[13px] font-black tabular-nums ${bestEdge > 0 ? 'text-nba-green' : 'text-red-400'}`}>
                    {bestEdge > 0 ? "+" : ""}{bestEdge.toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl px-2.5 py-2 text-center" style={{ background: 'hsla(228, 20%, 12%, 0.5)', border: '1px solid hsla(228, 30%, 18%, 0.3)' }}>
                  <p className="text-[7px] text-muted-foreground/45 font-bold uppercase tracking-wider mb-0.5">
                    {juiceSaved && juiceSaved > 0 ? "Juice Saved" : "Mkt Impl."}
                  </p>
                  <p className="text-[13px] font-black tabular-nums text-foreground/70">
                    {juiceSaved && juiceSaved > 0.5
                      ? `${juiceSaved.toFixed(1)}%`
                      : `${avgImplied.toFixed(0)}%`}
                  </p>
                </div>
              </div>
            )}

            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 mb-2 px-1">
              <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/55">Platform</span>
              <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/55 text-center w-12">Line</span>
              <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/55 text-center w-14">
                {overUnder === "over" ? "Over" : "Under"}
              </span>
              {modelHitRate && (
                <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/55 text-center w-12">EV</span>
              )}
            </div>

            {/* Book rows */}
            <div className="space-y-1.5">
              {books.map((b, i) => {
                const display = getSportsbookInfo(b.book);
                const isBest = bestOdds && b.book === bestOdds.book;
                const bookEV = modelHitRate ? calculateEV(modelHitRate, b.odds) : null;
                const bookImplied = impliedProb(b.odds);

                return (
                  <motion.div
                    key={b.book}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`grid ${modelHitRate ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto]'} gap-3 items-center py-2.5 px-2.5 rounded-xl transition-all duration-200 group cursor-default`}
                    style={{
                      background: isBest ? 'hsla(270, 50%, 50%, 0.08)' : 'hsla(228, 20%, 10%, 0.3)',
                      border: isBest ? '1px solid hsla(270, 50%, 50%, 0.15)' : '1px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BookLogo bookKey={b.book} />
                      <span className="text-[11px] font-bold text-foreground/80 group-hover:text-foreground transition-colors truncate">{getSportsbookInfo(b.book).label}</span>
                      {isBest && (
                        <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'linear-gradient(135deg, hsla(250,76%,62%,0.2), hsla(210,100%,60%,0.2))', border: '1px solid hsla(250,76%,62%,0.25)' }}>
                          <Crown className="w-2 h-2 text-accent" />
                          <span className="text-[6px] font-black text-accent uppercase tracking-wider">Best</span>
                        </div>
                      )}
                    </div>
                    <div className="text-center w-12">
                      <span className="text-[12px] font-extrabold tabular-nums text-foreground/60">{b.line.toFixed(1)}</span>
                    </div>
                    <div className="text-center w-14">
                      <span className={`text-[12px] font-extrabold tabular-nums ${isBest ? 'text-nba-green' : 'text-foreground/60'}`}>
                        {fmt(b.odds)}
                      </span>
                      <p className="text-[7px] text-muted-foreground/40 tabular-nums">{bookImplied.toFixed(0)}% impl.</p>
                    </div>
                    {modelHitRate && bookEV !== null && (
                      <div className="text-center w-12">
                        <span className={`text-[11px] font-bold tabular-nums ${bookEV > 0 ? 'text-nba-green' : 'text-red-400/70'}`}>
                          {bookEV > 0 ? "+" : ""}{bookEV.toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* Best line callout */}
            {bestOdds && books.length > 1 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="mt-3 rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.06), hsla(210, 100%, 60%, 0.06))', border: '1px solid hsla(250, 76%, 62%, 0.1)' }}
              >
                <Zap className="w-3.5 h-3.5 text-accent shrink-0" />
                <p className="text-[10px] text-foreground/70 leading-relaxed">
                  <span className="font-bold text-accent">{getSportsbookInfo(bestOdds.book).label}</span> has the best line at{" "}
                  <span className="font-bold text-foreground/90">{fmt(bestOdds.odds)}</span>
                  {juiceSaved && juiceSaved > 0.5 && (
                    <span className="text-nba-green font-bold"> — saves {juiceSaved.toFixed(1)}% juice</span>
                  )}
                </p>
              </motion.div>
            )}

            <div className="mt-3 pt-3" style={{ borderTop: '1px solid hsla(228, 18%, 18%, 0.3)' }}>
              <p className="text-[8px] text-muted-foreground/55 text-center leading-relaxed">
                Live odds from The Odds API · Always verify before placing bets
              </p>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
};

export default OddsComparison;