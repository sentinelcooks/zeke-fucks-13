import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, Loader2, Swords, Trophy, BarChart3, Clock, Zap, Crosshair, Shield, Target, Flame, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import WrittenAnalysis from "@/components/WrittenAnalysis";

import { searchUfcFighters, analyzeUfcMatchup } from "@/services/api";
import { fetchNbaOdds } from "@/services/oddsApi";

const UfcPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [fighter1, setFighter1] = useState("");
  const [fighter2, setFighter2] = useState("");
  const [suggestions1, setSuggestions1] = useState<any[]>([]);
  const [suggestions2, setSuggestions2] = useState<any[]>([]);
  const [showSug1, setShowSug1] = useState(false);
  const [showSug2, setShowSug2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<any>(null);
  const timeout1 = useRef<ReturnType<typeof setTimeout>>();
  const timeout2 = useRef<ReturnType<typeof setTimeout>>();
  const autoAnalyzedRef = useRef(false);

  const state = location.state as { fighter1?: string; fighter2?: string } | null;
  const [isAutoAnalyze, setIsAutoAnalyze] = useState(!!(state?.fighter1 && state?.fighter2));
  const showSearchPanel = !isAutoAnalyze || (results === null && !loading);

  useEffect(() => {
    const state = location.state as { fighter1?: string; fighter2?: string } | null;
    if (state?.fighter1 && state?.fighter2 && !autoAnalyzedRef.current) {
      autoAnalyzedRef.current = true;
      setFighter1(state.fighter1);
      setFighter2(state.fighter2);
      (async () => {
        setLoading(true); setError(""); setResults(null);
        try {
          const data = await analyzeUfcMatchup(state.fighter1!, state.fighter2!);
          if (data.error) setError(data.error);
          else setResults(data);
        } catch { setError("Failed to fetch matchup data. Please try again."); }
        finally { setLoading(false); }
      })();
    }
  }, [location.state]);

  const handleSearch = (q: string, side: 1 | 2) => {
    const setter = side === 1 ? setFighter1 : setFighter2;
    const setSug = side === 1 ? setSuggestions1 : setSuggestions2;
    const setShow = side === 1 ? setShowSug1 : setShowSug2;
    const timeoutRef = side === 1 ? timeout1 : timeout2;
    setter(q);
    clearTimeout(timeoutRef.current);
    if (q.length < 2) { setShow(false); return; }
    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchUfcFighters(q);
        setSug(data);
        setShow(data.length > 0);
      } catch { setShow(false); }
    }, 300);
  };

  const selectFighter = (name: string, side: 1 | 2) => {
    if (side === 1) { setFighter1(name); setShowSug1(false); }
    else { setFighter2(name); setShowSug2(false); }
  };

  const handleAnalyze = async () => {
    if (!fighter1 || !fighter2) { setError("Enter both fighter names"); return; }
    setLoading(true); setError(""); setResults(null);
    try {
      const data = await analyzeUfcMatchup(fighter1, fighter2);
      if (data.error) setError(data.error);
      else setResults(data);
    } catch { setError("Failed to fetch matchup data. Please try again."); }
    finally { setLoading(false); }
  };

  const renderSearchInput = (value: string, side: 1 | 2, suggestions: any[], showSuggestions: boolean, placeholder: string) => (
    <div className="flex-1 relative">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
        Fighter {side}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => handleSearch(e.target.value, side)}
        onKeyDown={(e) => { if (e.key === "Enter") { side === 1 ? setShowSug1(false) : setShowSug2(false); } }}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        style={{
          background: 'hsla(228, 20%, 12%, 0.6)',
          border: '1px solid hsla(228, 20%, 20%, 0.3)',
        }}
      />
      {showSuggestions && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl max-h-[200px] overflow-y-auto z-50"
          style={{ background: 'hsla(228, 25%, 10%, 0.95)', border: '1px solid hsla(228, 20%, 20%, 0.4)', backdropFilter: 'blur(20px)' }}>
          {suggestions.map((s, i) => (
            <div key={i} onClick={() => selectFighter(s.name, side)}
              className="px-3 py-2.5 text-sm cursor-pointer hover:bg-primary/10 transition-colors flex items-center gap-2.5">
              {s.headshot ? (
                <img src={s.headshot} alt="" className="w-7 h-7 rounded-full object-cover shrink-0"
                  style={{ background: 'hsla(228, 20%, 15%, 1)' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-muted-foreground/50 shrink-0"
                  style={{ background: 'hsla(228, 20%, 15%, 0.8)' }}>
                  {s.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2)}
                </div>
              )}
              <span className="text-foreground">{s.name}</span>
              {s.record && <span className="text-muted-foreground/50 text-xs ml-auto">{s.record}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full">
      

      <div className="px-4 pb-8 space-y-4">
        {/* Back / New Matchup */}
        {isAutoAnalyze && !showSearchPanel && (
          <motion.button
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            onClick={() => setIsAutoAnalyze(false)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors mt-2">
            <ArrowLeft className="w-3.5 h-3.5" /> New Matchup
          </motion.button>
        )}

        {showSearchPanel && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 mt-2">
            {/* Search Card */}
            <div className="rounded-2xl p-4" style={{
              background: 'hsla(228, 20%, 10%, 0.5)',
              border: '1px solid hsla(228, 20%, 18%, 0.3)',
              backdropFilter: 'blur(12px)',
            }}>
              <div className="space-y-3">
                <div className="flex gap-3 items-end">
                  {renderSearchInput(fighter1, 1, suggestions1, showSug1, "e.g. Islam Makhachev")}
                  <div className="flex items-center pb-2.5">
                    <span className="text-[10px] font-extrabold text-muted-foreground/40 uppercase">vs</span>
                  </div>
                  {renderSearchInput(fighter2, 2, suggestions2, showSug2, "e.g. Charles Oliveira")}
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleAnalyze} disabled={loading}
                  className="w-full py-3 rounded-xl font-bold text-sm text-primary-foreground flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                  style={{
                    background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(var(--nba-blue)))',
                    boxShadow: '0 4px 20px hsla(250, 76%, 50%, 0.25)',
                  }}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
                  ANALYZE MATCHUP
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {loading && (
          <div className="text-center py-16">
            <div className="w-10 h-10 border-4 border-border/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground/50 text-sm">Analyzing matchup...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl p-3 text-center text-destructive text-sm"
            style={{ background: 'hsla(0, 60%, 50%, 0.08)', border: '1px solid hsla(0, 60%, 50%, 0.2)' }}>
            {error}
          </div>
        )}

        {results && <MatchupResults data={results} />}
      </div>
    </div>
  );
};

/* ── Stat Bar ── */
function StatBar({ label, val1, val2, format }: { label: string; val1: number; val2: number; format?: (v: number) => string }) {
  const fmt = format || ((v: number) => v.toFixed(1));
  const max = Math.max(val1, val2, 0.1);
  return (
    <div className="py-1.5">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1">
        <span className="font-bold text-foreground/80">{fmt(val1)}</span>
        <span className="font-semibold">{label}</span>
        <span className="font-bold text-foreground/80">{fmt(val2)}</span>
      </div>
      <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'hsla(228, 20%, 15%, 0.5)' }}>
        <div className="flex-1 flex justify-end">
          <div className="rounded-l-full transition-all" style={{
            width: `${(val1 / max) * 100}%`,
            background: val1 >= val2 ? 'hsl(var(--accent))' : 'hsla(228, 20%, 25%, 0.4)',
          }} />
        </div>
        <div className="flex-1">
          <div className="rounded-r-full transition-all" style={{
            width: `${(val2 / max) * 100}%`,
            background: val2 >= val1 ? 'hsl(var(--nba-blue))' : 'hsla(228, 20%, 25%, 0.4)',
          }} />
        </div>
      </div>
    </div>
  );
}

/* ── Bet Section (reusable) ── */
function BetSection({ icon, title, predictions }: { icon: React.ReactNode; title: string; predictions: any[] | undefined }) {
  return (
    <div className="rounded-2xl p-4" style={{
      background: 'hsla(228, 20%, 10%, 0.5)',
      border: '1px solid hsla(228, 20%, 18%, 0.3)',
    }}>
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold mb-3 flex items-center gap-1.5">
        {icon} {title}
      </h3>
      {predictions && predictions.length > 0 ? (
        <div className="space-y-2">
          {predictions.map((p: any, i: number) => (
            <div key={i} className={`rounded-xl p-3 border ${
              p.confidence === "strong" ? "border-[hsl(var(--nba-green)/0.3)] bg-nba-green-dim" :
              p.confidence === "lean" ? "border-[hsl(var(--nba-blue)/0.3)] bg-[hsl(var(--nba-blue)/0.06)]" :
              "border-border/20 bg-secondary/20"
            }`}>
              <div className="flex items-center gap-1.5 mb-1">
                {p.probability && (
                  <span className={`text-[11px] font-extrabold ${
                    p.confidence === "strong" ? "text-nba-green" : p.confidence === "lean" ? "text-[hsl(var(--nba-blue))]" : "text-muted-foreground/60"
                  }`}>{p.probability}%</span>
                )}
                <span className={`text-[8px] uppercase font-bold px-1.5 py-0.5 rounded-full ${
                  p.confidence === "strong" ? "bg-nba-green text-accent-foreground" :
                  p.confidence === "lean" ? "bg-[hsl(var(--nba-blue))] text-primary-foreground" :
                  "bg-muted/50 text-muted-foreground/60"
                }`}>{p.confidence}</span>
              </div>
              <span className={`text-sm font-extrabold block mb-1 ${
                p.confidence === "strong" ? "text-nba-green" : p.confidence === "lean" ? "text-[hsl(var(--nba-blue))]" : "text-muted-foreground"
              }`}>{p.bet}</span>
              <p className="text-[10px] text-white leading-snug">{p.reasoning}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/40 text-center py-3">No predictions available</p>
      )}
    </div>
  );
}

/* ── Matchup Results ── */
function MatchupResults({ data }: { data: any }) {
  const { fighter1, fighter2, comparison, round_predictions, ml_pick, best_bet, sig_strikes_predictions, takedown_predictions, method_predictions, fgtd_predictions } = data;
  const [ufcOdds, setUfcOdds] = useState<any[]>([]);
  const [oddsLoading, setOddsLoading] = useState(false);

  useEffect(() => {
    if (!fighter1?.name || !fighter2?.name) return;
    (async () => {
      setOddsLoading(true);
      try {
        const raw = await fetchNbaOdds(undefined, "h2h", "ufc");
        const events = raw?.events || (Array.isArray(raw) ? raw : []);
        const f1 = fighter1.name.toLowerCase();
        const f2 = fighter2.name.toLowerCase();
        const match = events.find((e: any) => {
          const h = (e.home_team || "").toLowerCase();
          const a = (e.away_team || "").toLowerCase();
          return (h.includes(f1.split(" ").pop()) || a.includes(f1.split(" ").pop())) &&
                 (h.includes(f2.split(" ").pop()) || a.includes(f2.split(" ").pop()));
        });

        if (match?.bookmakers) {
          const odds: any[] = [];
          for (const bk of match.bookmakers) {
            const h2h = bk.markets?.find((m: any) => m.key === "h2h");
            if (h2h) {
              odds.push({ book: bk.title, outcomes: h2h.outcomes });
            }
          }
          setUfcOdds(odds);
        } else {
          setUfcOdds([]);
        }
      } catch (e) {
        console.error("UFC odds fetch error:", e);
        setUfcOdds([]);
      } finally {
        setOddsLoading(false);
      }
    })();
  }, [fighter1?.name, fighter2?.name]);

  const confidenceNum = best_bet?.probability || ml_pick?.probability || 60;
  const verdictText = best_bet?.confidence === "strong" ? "STRONG PICK" : best_bet?.confidence === "lean" ? "LEAN" : "RISKY";
  const primaryFighter = ml_pick?.pick || best_bet?.bet || fighter1?.name || "Fighter";

  const confidenceColor = (c: string) =>
    c === "strong" ? "text-nba-green" : c === "lean" ? "text-[hsl(var(--nba-blue))]" : "text-nba-yellow";
  const confidenceBorder = (c: string) =>
    c === "strong" ? "border-[hsl(var(--nba-green)/0.4)]" : c === "lean" ? "border-[hsl(var(--nba-blue)/0.4)]" : "border-[hsl(var(--nba-yellow)/0.4)]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      {/* Fighter Cards Row */}
      <div className="grid grid-cols-3 gap-2">
        {/* Fighter 1 */}
        <FighterCard fighter={fighter1} color="text-accent" />

        {/* Top Pick Center */}
        <div className={`rounded-2xl p-3 flex flex-col items-center justify-center text-center border-2 ${confidenceBorder(best_bet?.confidence)}`}
          style={{
            background: 'hsla(228, 20%, 10%, 0.5)',
            boxShadow: best_bet?.confidence === "strong" ? '0 0 24px hsla(var(--nba-green), 0.15)' : 'none',
          }}>
          <Trophy className={`w-5 h-5 mb-1 ${confidenceColor(best_bet?.confidence)}`} />
          <span className="text-[8px] uppercase tracking-wider text-muted-foreground mb-0.5">Top Pick</span>
          <div className={`text-xs font-extrabold leading-tight ${confidenceColor(best_bet?.confidence)}`}>{best_bet?.bet}</div>
          {best_bet?.probability && (
            <div className={`text-lg font-extrabold ${confidenceColor(best_bet?.confidence)}`}>{best_bet.probability}%</div>
          )}
          <p className="text-[8px] text-white mt-0.5 leading-snug line-clamp-3">{best_bet?.reasoning}</p>
        </div>

        {/* Fighter 2 */}
        <FighterCard fighter={fighter2} color="text-[hsl(var(--nba-blue))]" />
      </div>

      {/* Head to Head */}
      <div className="rounded-2xl p-4" style={{
        background: 'hsla(228, 20%, 10%, 0.5)',
        border: '1px solid hsla(228, 20%, 18%, 0.3)',
      }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-accent truncate">{fighter1?.name}</span>
          <h3 className="text-[9px] uppercase tracking-wider text-muted-foreground/40 font-semibold flex items-center gap-1">
            <BarChart3 className="w-3 h-3" /> Head to Head
          </h3>
          <span className="text-[10px] font-bold text-[hsl(var(--nba-blue))] truncate">{fighter2?.name}</span>
        </div>
        <StatBar label="Strikes / Min" val1={comparison?.strikes_per_min?.fighter1 || 0} val2={comparison?.strikes_per_min?.fighter2 || 0} />
        <StatBar label="Finish Rate" val1={comparison?.finish_rate?.fighter1 || 0} val2={comparison?.finish_rate?.fighter2 || 0} format={v => `${v}%`} />
        <StatBar label="KO Rate" val1={comparison?.ko_rate?.fighter1 || 0} val2={comparison?.ko_rate?.fighter2 || 0} format={v => `${v}%`} />
        <StatBar label="Takedown Avg" val1={comparison?.takedown_avg?.fighter1 || 0} val2={comparison?.takedown_avg?.fighter2 || 0} />
        <StatBar label="Avg Rounds" val1={comparison?.avg_fight_rounds?.fighter1 || 0} val2={comparison?.avg_fight_rounds?.fighter2 || 0} />
      </div>

      {/* Round Predictions + ML Pick */}
      <div className="grid grid-cols-2 gap-3">
        <BetSection icon={<Clock className="w-3 h-3" />} title="Round Predictions" predictions={round_predictions} />

        {/* ML Pick */}
        <div className="rounded-2xl p-4" style={{
          background: 'hsla(228, 20%, 10%, 0.5)',
          border: '1px solid hsla(228, 20%, 18%, 0.3)',
        }}>
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold mb-3 flex items-center gap-1.5">
            <Zap className="w-3 h-3" /> Moneyline
          </h3>
          {ml_pick && (
            <div className={`rounded-xl p-3 border text-center ${
              ml_pick.confidence === "strong" ? "border-[hsl(var(--nba-green)/0.3)] bg-nba-green-dim" :
              ml_pick.confidence === "lean" ? "border-[hsl(var(--nba-blue)/0.3)] bg-[hsl(var(--nba-blue)/0.06)]" :
              "border-[hsl(var(--nba-yellow)/0.3)] bg-nba-yellow-dim"
            }`}>
              <span className={`block text-base font-extrabold mb-0.5 ${confidenceColor(ml_pick.confidence)}`}>{ml_pick.pick}</span>
              {ml_pick.probability && (
                <span className={`block text-2xl font-extrabold ${confidenceColor(ml_pick.confidence)}`}>{ml_pick.probability}%</span>
              )}
              <span className={`inline-block text-[8px] uppercase font-bold px-1.5 py-0.5 rounded-full mt-1 mb-1.5 ${
                ml_pick.confidence === "strong" ? "bg-nba-green text-accent-foreground" :
                ml_pick.confidence === "lean" ? "bg-[hsl(var(--nba-blue))] text-primary-foreground" :
                "bg-[hsl(var(--nba-yellow))] text-accent-foreground"
              }`}>{ml_pick.confidence}</span>
              <p className="text-[10px] text-white leading-snug">{ml_pick.reasoning}</p>
            </div>
          )}

          {/* Combined stats */}
          <div className="mt-3 grid grid-cols-3 gap-1 text-center">
            {[
              { label: "Strikes/m", val: (data.combined_strikes_per_min || 0).toFixed(1) },
              { label: "Avg Rds", val: (data.combined_avg_rounds || 0).toFixed(1) },
              { label: "Finish %", val: `${(data.combined_finish_rate || 0).toFixed(0)}%` },
            ].map(s => (
              <div key={s.label}>
                <span className="block text-[8px] text-muted-foreground/40 uppercase">{s.label}</span>
                <span className="block text-sm font-extrabold text-foreground">{s.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sportsbook Odds */}
      <div className="rounded-2xl p-4" style={{
        background: 'hsla(228, 20%, 10%, 0.5)',
        border: '1px solid hsla(228, 20%, 18%, 0.3)',
      }}>
        <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold mb-3 flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3" /> Sportsbook Odds
        </h3>
        {oddsLoading ? (
          <p className="text-xs text-muted-foreground/40 text-center py-3">Loading odds...</p>
        ) : ufcOdds.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border/20">
                  <th className="text-left py-1.5 text-muted-foreground/40 uppercase tracking-wider font-semibold">Book</th>
                  <th className="text-center py-1.5 text-muted-foreground/40 uppercase tracking-wider font-semibold truncate max-w-[80px]">{fighter1?.name?.split(" ").pop()}</th>
                  <th className="text-center py-1.5 text-muted-foreground/40 uppercase tracking-wider font-semibold truncate max-w-[80px]">{fighter2?.name?.split(" ").pop()}</th>
                </tr>
              </thead>
              <tbody>
                {ufcOdds.map((bk, i) => {
                  const o1 = bk.outcomes?.find((o: any) => fighter1?.name && o.name.toLowerCase().includes(fighter1.name.split(" ").pop()?.toLowerCase()));
                  const o2 = bk.outcomes?.find((o: any) => fighter2?.name && o.name.toLowerCase().includes(fighter2.name.split(" ").pop()?.toLowerCase()));
                  return (
                    <tr key={i} className="border-b border-border/10">
                      <td className="py-1.5 font-medium text-foreground/70">{bk.book}</td>
                      <td className={`text-center py-1.5 font-bold ${o1?.price < 0 ? 'text-nba-green' : 'text-nba-red'}`}>
                        {o1 ? (o1.price > 0 ? `+${o1.price}` : o1.price) : '—'}
                      </td>
                      <td className={`text-center py-1.5 font-bold ${o2?.price < 0 ? 'text-nba-green' : 'text-nba-red'}`}>
                        {o2 ? (o2.price > 0 ? `+${o2.price}` : o2.price) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/40 text-center py-3">No sportsbook odds available for this matchup right now.</p>
        )}
      </div>

      {/* Sig Strikes + Takedowns + Method + FGTD */}
      <div className="grid grid-cols-2 gap-3">
        <BetSection icon={<Crosshair className="w-3 h-3" />} title="Sig. Strikes" predictions={sig_strikes_predictions} />
        <BetSection icon={<Shield className="w-3 h-3" />} title="Takedowns" predictions={takedown_predictions} />
        <BetSection icon={<Target className="w-3 h-3" />} title="Method of Victory" predictions={method_predictions} />
        <BetSection icon={<Flame className="w-3 h-3" />} title="Goes the Distance?" predictions={fgtd_predictions} />
      </div>

      {/* Recent Fights */}
      <div className="space-y-3">
        {[{ f: fighter1, fights: data.fighter1?.recent_fights || fighter1?.recent_fights, color: "text-accent" },
          { f: fighter2, fights: data.fighter2?.recent_fights || fighter2?.recent_fights, color: "text-[hsl(var(--nba-blue))]" }].map((side, idx) => (
          <div key={idx} className="rounded-2xl p-4" style={{
            background: 'hsla(228, 20%, 10%, 0.5)',
            border: '1px solid hsla(228, 20%, 18%, 0.3)',
          }}>
            <h3 className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${side.color}`}>
              {side.f?.name} — Recent Fights
            </h3>
            {side.fights && side.fights.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-border/20">
                      {["Date", "Opponent", "W/L", "Method", "Rd"].map(h => (
                        <th key={h} className="text-center py-1 text-muted-foreground/40 uppercase tracking-wider font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {side.fights.slice(0, 5).map((f: any, i: number) => (
                      <tr key={i} className="border-b border-border/10">
                        <td className="text-center py-1.5 text-muted-foreground/50 whitespace-nowrap">{f.date}</td>
                        <td className="text-center py-1.5 font-medium text-foreground/80 truncate max-w-[80px]">{f.opponent}</td>
                        <td className={`text-center py-1.5 font-bold ${f.result === "W" ? "text-nba-green" : f.result === "L" ? "text-nba-red" : "text-nba-yellow"}`}>{f.result}</td>
                        <td className="text-center py-1.5 text-muted-foreground/50">{f.method}</td>
                        <td className="text-center py-1.5 text-muted-foreground/50">{f.round}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-[10px] text-muted-foreground/40 text-center py-3">No fight data</p>}
          </div>
        ))}
      </div>

      {/* Written Analysis */}
      <WrittenAnalysis
        type="moneyline"
        sport="ufc"
        verdict={verdictText}
        confidence={confidenceNum}
        playerOrTeam={primaryFighter}
        factors={[
          ml_pick?.reasoning,
          best_bet?.reasoning,
          ...(round_predictions || []).map((rp: any) => `${rp.bet}: ${rp.probability}% (${rp.confidence})`),
        ].filter(Boolean)}
        ev={best_bet?.probability ? best_bet.probability - 50 : undefined}
        edge={best_bet?.probability ? best_bet.probability - 50 : undefined}
      />
    </motion.div>
  );
}

/* ── Fighter Card ── */
function FighterCard({ fighter, color }: { fighter: any; color: string }) {
  const [imgErr, setImgErr] = useState(false);
  const initials = (fighter?.name || "").split(" ").map((w: string) => w[0]).join("").slice(0, 2);

  return (
    <div className="rounded-2xl p-3 text-center" style={{
      background: 'hsla(228, 20%, 10%, 0.5)',
      border: '1px solid hsla(228, 20%, 18%, 0.3)',
    }}>
      <div className="mx-auto w-14 h-14 rounded-xl overflow-hidden mb-2" style={{ background: 'hsla(228, 20%, 15%, 0.6)' }}>
        {fighter?.image_url && !imgErr ? (
          <img src={fighter.image_url} alt={fighter.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-lg font-bold text-muted-foreground/40">{initials}</div>
        )}
      </div>
      <h3 className={`text-xs font-bold truncate ${color}`}>{fighter?.name}</h3>
      <div className="flex items-center justify-center gap-1.5">
        <p className="text-[9px] text-muted-foreground/50">{fighter?.record}</p>
        {fighter?.age && <span className="text-[9px] text-muted-foreground/40">• {fighter.age}yr</span>}
      </div>
      <p className="text-[8px] text-muted-foreground/35">{fighter?.weight_class}</p>
      <div className="grid grid-cols-3 gap-1 mt-2">
        {[
          { label: "KO", val: fighter?.stats?.ko_wins },
          { label: "SUB", val: fighter?.stats?.sub_wins },
          { label: "DEC", val: fighter?.stats?.dec_wins },
        ].map(s => (
          <div key={s.label}>
            <span className="block text-[7px] text-muted-foreground/40 uppercase">{s.label}</span>
            <span className="block text-sm font-extrabold text-foreground">{s.val ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default UfcPage;
