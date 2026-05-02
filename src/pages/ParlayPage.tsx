import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Trash2, Loader2, Search, Zap, BookOpen, Trophy, DollarSign, Target } from "lucide-react";

import { motion, AnimatePresence } from "framer-motion";
import NbaLegInput, { NbaLegData } from "@/components/parlay/NbaLegInput";
import UfcLegInput, { UfcLegData } from "@/components/parlay/UfcLegInput";
import ParlayAnalysisResults from "@/components/parlay/ParlayAnalysisResults";
import { analyzeProp, analyzeUfcMatchup } from "@/services/api";
import { safeConfidence, gradeFromConfidence, extractConfidence } from "@/lib/matchupGrade";
import { fetchPlayerOdds } from "@/services/oddsApi";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { useParlaySlip } from "@/contexts/ParlaySlipContext";

type Sport = "NBA" | "MLB" | "NHL" | "UFC" | "NFL";
const ALL_SPORTS: Sport[] = ["NBA", "MLB", "NHL", "UFC", "NFL"];

const SPORT_ICONS: Record<Sport, string> = {
  NBA: "🏀", MLB: "⚾", NHL: "🏒", UFC: "🥊", NFL: "🏈",
};

interface ParlayLeg {
  id: string;
  sport: Sport;
  odds: number;
  bestBook: string;
  nba: NbaLegData;
  ufc: UfcLegData;
}

function createLeg(sport: Sport = "NBA"): ParlayLeg {
  return {
    id: crypto.randomUUID(),
    sport,
    odds: -110,
    bestBook: "",
    nba: { player: "", propType: sport === "NHL" ? "goals" : sport === "NFL" ? "passing_yards" : sport === "MLB" ? "hits" : "points", line: "", overUnder: "over", opponent: "" },
    ufc: { fighter1: "", fighter2: "", pickFighter: "fighter1" },
  };
}

function americanToDecimal(odds: number): number {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}
function decimalToAmerican(dec: number): number {
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

const ODDS_SPORT_KEY: Record<string, string> = {
  NBA: "basketball_nba",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  NFL: "americanfootball_nfl",
  UFC: "mma_mixed_martial_arts",
};

const ParlayPage = () => {
  const { fmt } = useOddsFormat();
  const globalSlip = useParlaySlip();
  const [legs, setLegs] = useState<ParlayLeg[]>([createLeg()]);
  const [stake, setStake] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [fetchingOdds, setFetchingOdds] = useState<Record<string, boolean>>({});
  const oddsTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hasImported = useRef(false);

  useEffect(() => {
    if (hasImported.current) return;
    if (globalSlip.legs.length > 0) {
      hasImported.current = true;
      const imported: ParlayLeg[] = globalSlip.legs.map((sl) => ({
        id: sl.id,
        sport: sl.sport as Sport,
        odds: sl.odds || -110,
        bestBook: "",
        nba: {
          player: sl.player,
          propType: sl.propType,
          line: sl.line,
          overUnder: sl.overUnder,
          opponent: sl.opponent || "",
        },
        ufc: { fighter1: "", fighter2: "", pickFighter: "fighter1" as const },
      }));
      while (imported.length < 1) imported.push(createLeg());
      setLegs(imported);
      // Fetch real odds for each imported leg
      imported.forEach((leg) => debouncedFetchOdds(leg));
    }
  }, []);

  const debouncedFetchOdds = useCallback((leg: ParlayLeg) => {
    if (leg.sport === "UFC") {
      const pickedFighter = leg.ufc.pickFighter === "fighter1" ? leg.ufc.fighter1 : leg.ufc.fighter2;
      if (!pickedFighter || pickedFighter.length < 4) return;
      if (oddsTimers.current[leg.id]) clearTimeout(oddsTimers.current[leg.id]);
      oddsTimers.current[leg.id] = setTimeout(async () => {
        setFetchingOdds(prev => ({ ...prev, [leg.id]: true }));
        try {
          const result = await fetchPlayerOdds(pickedFighter, "h2h", "win", "mma_mixed_martial_arts");
          if (result?.found && result.books?.length > 0) {
            const sorted = [...result.books].sort((a: any, b: any) => b.odds - a.odds);
            const best = sorted[0];
            setLegs(prev => prev.map(l => l.id === leg.id ? { ...l, odds: best.odds || l.odds, bestBook: best.book || "" } : l));
          }
        } catch {} finally {
          setFetchingOdds(prev => ({ ...prev, [leg.id]: false }));
        }
      }, 800);
      return;
    }
    if (!leg.nba.player || !leg.nba.line) return;
    if (leg.nba.player.length < 4) return;
    const sportKey = ODDS_SPORT_KEY[leg.sport];
    if (!sportKey) return;
    if (oddsTimers.current[leg.id]) clearTimeout(oddsTimers.current[leg.id]);
    oddsTimers.current[leg.id] = setTimeout(async () => {
      setFetchingOdds(prev => ({ ...prev, [leg.id]: true }));
      try {
        const result = await fetchPlayerOdds(leg.nba.player, leg.nba.propType, leg.nba.overUnder, sportKey);
        if (result?.found && result.books?.length > 0) {
          const sorted = [...result.books].sort((a: any, b: any) => b.price - a.price);
          const best = sorted[0];
          setLegs(prev => prev.map(l => l.id === leg.id ? { ...l, odds: best.price || l.odds, bestBook: best.bookmaker || "" } : l));
        }
      } catch {} finally {
        setFetchingOdds(prev => ({ ...prev, [leg.id]: false }));
      }
    }, 800);
  }, []);

  useEffect(() => {
    if (analysisResults?.legs) {
      setLegs(prev => prev.map((leg, idx) => {
        const result = analysisResults.legs.find((r: any) => r.legIndex === idx);
        if (result?.odds && result.odds !== leg.odds) return { ...leg, odds: result.odds };
        return leg;
      }));
    }
  }, [analysisResults]);

  const addLeg = () => { if (legs.length >= 12) return; setLegs([...legs, createLeg()]); };
  const removeLeg = (id: string) => { if (legs.length <= 1) return; setLegs(legs.filter((l) => l.id !== id)); };
  const updateLeg = (id: string, updates: Partial<ParlayLeg>) => { setLegs(legs.map((l) => (l.id === id ? { ...l, ...updates } : l))); };
  const changeSport = (id: string, sport: Sport) => { const newLeg = createLeg(sport); newLeg.id = id; setLegs(legs.map(l => l.id === id ? newLeg : l)); };

  const isLegValid = (leg: ParlayLeg) => {
    if (leg.sport === "UFC") return leg.ufc.fighter1 && leg.ufc.fighter2;
    return leg.nba.player && leg.nba.line;
  };

  const getLegPickLabel = (leg: ParlayLeg) => {
    if (leg.sport === "UFC") {
      const u = leg.ufc;
      const pick = u.pickFighter === "fighter1" ? u.fighter1 : u.fighter2;
      return `${pick} ML (${u.fighter1} vs ${u.fighter2})`;
    }
    const p = leg.nba;
    return `${p.player} ${p.overUnder.toUpperCase()} ${p.line} ${p.propType}`;
  };

  const validLegs = legs.filter(isLegValid);
  const combinedDecimal = validLegs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
  const parlayOdds = validLegs.length >= 1 ? decimalToAmerican(combinedDecimal) : 0;
  const stakeNum = parseFloat(stake) || 0;
  const potentialPayout = stakeNum * combinedDecimal;
  const profit = potentialPayout - stakeNum;
  const isSingleLeg = validLegs.length === 1;

  const handleAnalyze = async () => {
    if (validLegs.length < 1) { setError("Fill in at least 1 leg to analyze"); return; }
    setLoading(true); setError(""); setAnalysisResults(null);
    try {
      const legAnalyses = await Promise.all(validLegs.map(async (leg, idx) => {
        try {
          if (leg.sport === "UFC") {
            const data = await analyzeUfcMatchup(leg.ufc.fighter1, leg.ufc.fighter2);
            if (data.error) return { legIndex: idx, sport: leg.sport, pick: getLegPickLabel(leg), odds: leg.odds, confidence: 0, grade: "risky" as const, summary: `Could not analyze: ${data.error}`, keyStats: [], bestBook: leg.bestBook };
            const mlPick = data.ml_pick;
            const pickedFighter = leg.ufc.pickFighter === "fighter1" ? leg.ufc.fighter1 : leg.ufc.fighter2;
            const mlPickName = mlPick?.pick || "";
            const isAligned = mlPickName.toLowerCase().includes(pickedFighter.split(" ").pop()?.toLowerCase() || "");
            const rawProb = safeConfidence(mlPick?.probability, NaN);
            let conf = Number.isFinite(rawProb) ? (isAligned ? rawProb : 100 - rawProb) : 0;
            conf = safeConfidence(conf, 0);
            const grade = gradeFromConfidence(conf);
            const keyStats: string[] = [];
            const f1Stats = data.fighter1?.stats; const f2Stats = data.fighter2?.stats;
            const f1Age = data.fighter1?.age || data.fighter1?.fighter?.age;
            const f2Age = data.fighter2?.age || data.fighter2?.fighter?.age;
            if (f1Age || f2Age) keyStats.push(`Age: ${data.fighter1?.name || leg.ufc.fighter1} ${f1Age || '?'} · ${data.fighter2?.name || leg.ufc.fighter2} ${f2Age || '?'}`);
            if (f1Stats) keyStats.push(`${data.fighter1?.name}: ${f1Stats.ko_wins}KO/${f1Stats.sub_wins}SUB`);
            if (f2Stats) keyStats.push(`${data.fighter2?.name}: ${f2Stats.ko_wins}KO/${f2Stats.sub_wins}SUB`);
            if (data.combined_finish_rate) keyStats.push(`Finish%: ${data.combined_finish_rate.toFixed(0)}%`);
            const summary = isAligned ? `Data supports ${pickedFighter}. ${mlPick?.reasoning || ""}` : `Data leans towards ${mlPickName} instead. ${mlPick?.reasoning || ""}`;
            return { legIndex: idx, sport: leg.sport, pick: getLegPickLabel(leg), odds: leg.odds, confidence: conf, grade, summary, keyStats, bestBook: leg.bestBook };
          } else {
            const lineNum = parseFloat(leg.nba.line);
            const data = await analyzeProp({ player: leg.nba.player, prop_type: leg.nba.propType, line: lineNum, over_under: leg.nba.overUnder, opponent: leg.nba.opponent || undefined, sport: leg.sport.toLowerCase() });
            if (data.error) {
              const sportLabel = leg.sport;
              const summary = sportLabel === "NFL" && /not\s+supported|unsupported|unknown\s+sport/i.test(String(data.error))
                ? "NFL analysis is not yet supported. Treating leg as risky."
                : `Could not analyze: ${data.error}`;
              return { legIndex: idx, sport: leg.sport, pick: getLegPickLabel(leg), odds: leg.odds, confidence: 0, grade: "risky" as const, summary, keyStats: [], bestBook: leg.bestBook };
            }
            const conf = safeConfidence(extractConfidence(data), 0);
            const grade = gradeFromConfidence(conf);
            const reasoning: string[] = Array.isArray(data.reasoning) ? data.reasoning : (data.confidence?.reasoning || []);
            const keyStats: string[] = [];
            if (data.season_hit_rate) keyStats.push(`Season: ${data.season_hit_rate.rate}% (${data.season_hit_rate.hits}/${data.season_hit_rate.total})`);
            if (data.last_10) keyStats.push(`L10: ${data.last_10.rate}% hit`);
            if (data.last_5) keyStats.push(`L5: ${data.last_5.rate}% hit`);
            if (data.season_avg) keyStats.push(`Avg: ${data.season_avg[data.prop_type || leg.nba.propType] || "N/A"}`);
            return { legIndex: idx, sport: leg.sport, pick: getLegPickLabel(leg), odds: leg.odds, confidence: conf, grade, summary: reasoning.slice(0, 3).join(". ") + ".", keyStats, bestBook: leg.bestBook };
          }
        } catch {
          return { legIndex: idx, sport: leg.sport, pick: getLegPickLabel(leg), odds: leg.odds, confidence: 0, grade: "risky" as const, summary: "Failed to fetch analysis data.", keyStats: [], bestBook: leg.bestBook };
        }
      }));
      const overallConfRaw = legAnalyses.reduce((acc, l) => {
        const c = safeConfidence(l.confidence, 0);
        return acc * (c / 100);
      }, 1) * 100;
      const overallConf = Number.isFinite(overallConfRaw) ? Math.max(0, Math.min(100, overallConfRaw)) : 0;
      const strongLegs = legAnalyses.filter(l => l.grade === "strong").length;
      const riskyLegs = legAnalyses.filter(l => l.grade === "risky").length;
      let writeup = "";
      if (riskyLegs === 0 && strongLegs >= legAnalyses.length / 2) {
        writeup = `This is a solid parlay. ${strongLegs} of ${legAnalyses.length} legs have strong data backing. Combined confidence is ${overallConf.toFixed(1)}% with a potential ${fmt(parlayOdds)} payout. The data supports this ticket.`;
      } else if (riskyLegs >= legAnalyses.length / 2) {
        writeup = `Caution: ${riskyLegs} of ${legAnalyses.length} legs are risky based on the data. Combined confidence is only ${overallConf.toFixed(1)}%. Consider removing weak legs or adjusting your picks.`;
      } else {
        writeup = `Mixed parlay: ${strongLegs} strong, ${legAnalyses.length - strongLegs - riskyLegs} moderate, and ${riskyLegs} risky legs. Overall confidence is ${overallConf.toFixed(1)}%. The stronger legs carry this, but the weaker ones lower your hit probability.`;
      }
      setAnalysisResults({ legs: legAnalyses, overallConfidence: overallConf, overallWriteup: writeup });
    } catch {
      setError("Failed to analyze parlay. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[520px] mx-auto pb-8 relative">
      

      <div className="px-4 pt-1">
        {/* Legs */}
        <div className="space-y-3 mb-4">
          <AnimatePresence mode="popLayout">
            {legs.map((leg, idx) => (
              <motion.div
                key={leg.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -8 }}
                transition={{ duration: 0.22 }}
                className="rounded-2xl overflow-hidden"
                style={{ background: "var(--gradient-card)", border: "1px solid hsla(228, 18%, 20%, 0.4)" }}
              >
                {/* Leg header */}
                <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid hsla(228, 18%, 18%, 0.4)" }}>
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-black bg-primary/10 text-primary tabular-nums">{idx + 1}</span>
                    <div className="flex gap-0.5 bg-secondary/30 rounded-lg p-0.5">
                      {ALL_SPORTS.map(s => (
                        <button key={s} onClick={() => changeSport(leg.id, s)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                            leg.sport === s
                              ? "bg-primary/15 text-primary shadow-sm"
                              : "text-muted-foreground/40 hover:text-muted-foreground/70"
                          }`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => removeLeg(leg.id)} disabled={legs.length <= 1}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/25 hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-15 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/25">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Leg body */}
                <div className="px-4 py-3.5">
                  {leg.sport === "UFC" ? (
                    <UfcLegInput data={leg.ufc} onChange={(ufc) => {
                      updateLeg(leg.id, { ufc });
                      debouncedFetchOdds({ ...leg, ufc });
                    }} />
                  ) : (
                    <NbaLegInput
                      data={leg.nba}
                      onChange={(nba) => {
                        updateLeg(leg.id, { nba });
                        debouncedFetchOdds({ ...leg, nba });
                      }}
                      sport={leg.sport}
                    />
                  )}
                </div>

                {/* Leg footer with odds */}
                <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: "1px solid hsla(228, 18%, 16%, 0.35)" }}>
                  <div className="flex items-center gap-2">
                    {fetchingOdds[leg.id] && <Loader2 className="w-3 h-3 animate-spin text-primary/50" />}
                    {leg.bestBook && (
                      <span className="text-[9px] font-medium text-primary/80 bg-primary/8 px-2 py-0.5 rounded-full flex items-center gap-1 border border-primary/10">
                        <BookOpen className="w-2.5 h-2.5" />
                        {leg.bestBook}
                      </span>
                    )}
                  </div>
                  <span className={`text-sm font-bold tabular-nums ${leg.odds > 0 ? "text-nba-green" : "text-foreground"}`}>
                    {fmt(leg.odds)}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Add Leg */}
        <button
          onClick={addLeg}
          disabled={legs.length >= 12}
          className="w-full mb-5 py-3 border border-dashed border-border/25 rounded-2xl text-xs font-semibold text-muted-foreground/35 hover:text-primary hover:border-primary/30 hover:bg-primary/[0.03] transition-all flex items-center justify-center gap-1.5 disabled:opacity-20"
        >
          <Plus className="w-3.5 h-3.5" /> Add Leg
        </button>

        {/* Summary strip */}
        <AnimatePresence>
          {validLegs.length >= 1 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="rounded-2xl p-4 mb-5 relative overflow-hidden"
              style={{ background: "var(--gradient-card)", border: "1px solid hsla(228, 18%, 20%, 0.4)" }}
            >
              {/* Subtle glow behind */}
              <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-primary/8 blur-2xl pointer-events-none" />

              <div className="flex items-center justify-between flex-wrap gap-3 relative z-10">
                <div className="flex items-center gap-5">
                  <div className="text-center">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Target className="w-3 h-3 text-muted-foreground/40" />
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/45 font-medium">{isSingleLeg ? "Straight" : "Legs"}</span>
                    </div>
                    <span className="text-lg font-bold text-foreground tabular-nums">{validLegs.length}</span>
                  </div>
                  <div className="w-px h-8 bg-border/20" />
                  <div className="text-center">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Trophy className="w-3 h-3 text-primary/50" />
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/45 font-medium">{isSingleLeg ? "Odds" : "Parlay"}</span>
                    </div>
                    <span className="text-lg font-bold text-primary tabular-nums">{fmt(parlayOdds)}</span>
                  </div>
                  <div className="w-px h-8 bg-border/20" />
                  <div className="text-center">
                    <div className="flex items-center gap-1 mb-0.5">
                      <DollarSign className="w-3 h-3 text-nba-green/50" />
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/45 font-medium">Payout</span>
                    </div>
                    <span className="text-lg font-bold text-nba-green tabular-nums">${potentialPayout.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/45 font-medium">Stake</span>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/35">$</span>
                    <input type="number" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="10" min="0" step="5"
                      className="w-20 bg-secondary/40 border border-border/25 rounded-xl pl-5 pr-2 py-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Analyze button */}
        <motion.button
          onClick={handleAnalyze}
          disabled={loading || validLegs.length < 1}
          whileTap={{ scale: 0.98 }}
          className="w-full mb-5 py-4 font-bold text-sm rounded-2xl text-primary-foreground transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 shadow-lg shadow-primary/20"
          style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(250 70% 48%))" }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {loading ? "ANALYZING..." : isSingleLeg ? "ANALYZE BET" : "ANALYZE PARLAY"}
        </motion.button>

        {/* Loading state */}
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-12">
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 rounded-full border-2 border-primary/10" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                <Zap className="absolute inset-0 m-auto w-5 h-5 text-primary animate-pulse" />
              </div>
              <p className="text-xs text-muted-foreground/50 font-medium">Crunching data for each leg…</p>
            </div>
          </motion.div>
        )}

        {/* Error */}
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="rounded-2xl p-3.5 text-center text-xs mb-4 border border-destructive/20 bg-destructive/5">
            <span className="text-destructive font-medium">{error}</span>
          </motion.div>
        )}

        {/* Results */}
        {analysisResults && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <ParlayAnalysisResults
              legs={analysisResults.legs}
              parlayOdds={parlayOdds}
              potentialPayout={potentialPayout}
              profit={profit}
              overallConfidence={analysisResults.overallConfidence}
              stake={stakeNum}
              overallWriteup={analysisResults.overallWriteup}
            />
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default ParlayPage;
