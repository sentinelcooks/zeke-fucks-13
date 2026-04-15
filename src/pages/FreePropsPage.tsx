import { useState, useEffect, useMemo, useRef } from "react";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, TrendingDown, Zap, Clock, Search, Loader2, Link2, X, ChevronDown, ChevronLeft, Target, ArrowRight, Shield, Hand, Crosshair, RotateCcw, Trophy, BarChart3, Activity, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { analyzeProp } from "@/services/api";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import OddsComparison from "@/components/OddsComparison";
import { PlayerCard } from "@/components/mobile/PlayerCard";
import { VerdictBadge } from "@/components/mobile/VerdictBadge";
import { StatPill } from "@/components/mobile/StatPill";
import { HitRateRing } from "@/components/mobile/HitRateRing";
import { ShotChart } from "@/components/mobile/ShotChart";
import { OddsProjection } from "@/components/mobile/OddsProjection";
import { StrengthWeakness } from "@/components/mobile/StrengthWeakness";

import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  LineController,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, LineController, PointElement, Title, Tooltip, Legend);

interface FreeProp {
  id: string;
  player_name: string;
  team: string | null;
  opponent: string | null;
  prop_type: string;
  line: number;
  direction: string;
  odds: number | null;
  edge: number | null;
  confidence: number | null;
  sport: string;
  book: string | null;
  prop_date: string;
}

interface CorrelatedProp {
  correlated_player: string;
  correlated_prop: string;
  correlated_team: string | null;
  hit_rate: number;
  sample_size: number;
}

const PROP_LABELS: Record<string, string> = {
  points: "PTS", rebounds: "REB", assists: "AST", "3-pointers": "3PT",
  blocks: "BLK", steals: "STL", hits: "H", runs: "R", rbi: "RBI",
  home_runs: "HR", total_bases: "TB", strikeouts: "K", moneyline: "ML",
};

function getHitRateColor(rate: number) {
  if (rate >= 75) return { text: "text-nba-green", bg: "hsla(160, 84%, 39%, 0.12)" };
  if (rate >= 60) return { text: "text-nba-blue", bg: "hsla(217, 91%, 60%, 0.12)" };
  if (rate >= 45) return { text: "text-nba-yellow", bg: "hsla(38, 92%, 50%, 0.12)" };
  return { text: "text-muted-foreground", bg: "hsla(0, 0%, 50%, 0.1)" };
}

function getEdgeColor(edge: number) {
  if (edge >= 15) return "text-nba-green";
  if (edge >= 8) return "text-nba-blue";
  if (edge >= 3) return "text-nba-yellow";
  return "text-muted-foreground";
}

// formatOdds removed — using useOddsFormat hook instead

// Reuse Section component from NbaPropsPage
function Section({ title, children, defaultOpen = true, icon }: { title: string; children: React.ReactNode; defaultOpen?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="vision-card overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(250,76%,62%,0.15), transparent)' }} />
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 text-left group">
        <div className="flex items-center gap-2.5">
          {icon && <span className="text-accent/50">{icon}</span>}
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50 group-hover:text-foreground/60 transition-colors">{title}</span>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }} className="overflow-hidden">
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function GameChart({ data }: { data: any }) {
  const games = data.game_log || [];
  const labels = games.map((g: any) => { const parts = g.date?.split("-") || []; return parts.length >= 2 ? `${parts[1]}/${parts[2]}` : g.date; });
  const values = games.map((g: any) => g.stat_value);
  const lineval = data.line;
  const colors = values.map((v: number) => data.over_under === "over" ? v > lineval ? "hsla(158, 64%, 52%, 0.8)" : "hsla(0, 72%, 51%, 0.35)" : v < lineval ? "hsla(158, 64%, 52%, 0.8)" : "hsla(0, 72%, 51%, 0.35)");
  return (
    <div className="h-[220px]">
      <Bar data={{ labels, datasets: [{ label: data.prop_display, data: values, backgroundColor: colors, borderRadius: 6, barPercentage: 0.55 } as any, { label: `Line (${lineval})`, data: Array(labels.length).fill(lineval), type: "line" as any, borderColor: "hsla(250, 76%, 62%, 0.5)", borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false }] }}
        options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "hsla(228, 10%, 45%, 0.6)", font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: "hsla(228, 10%, 45%, 0.6)", font: { size: 9 } }, grid: { color: "hsla(228, 18%, 15%, 0.4)" }, beginAtZero: true } } }}
      />
    </div>
  );
}

function GamesTable({ games, line, overUnder, propType }: { games: any[]; line: number; overUnder: string; propType: string }) {
  const getStatVal = (g: any) => {
    if (propType === "pts+reb+ast") return (g.PTS || 0) + (g.REB || 0) + (g.AST || 0);
    const map: any = { points: "PTS", rebounds: "REB", assists: "AST", "3-pointers": "FG3M", steals: "STL", blocks: "BLK", turnovers: "TOV" };
    return g[map[propType]] || 0;
  };
  if (!games.length) return <p className="text-center text-muted-foreground/65 py-4 text-xs">No games data</p>;
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-5 px-5">
      <table className="w-full text-[10px]">
        <thead><tr className="border-b border-border/30">{["Date", "OPP", "W/L", "MIN", "PTS", "REB", "AST", "Prop", ""].map((h) => (<th key={h} className="text-center py-2.5 px-1 text-muted-foreground/65 uppercase tracking-wider font-bold whitespace-nowrap">{h}</th>))}</tr></thead>
        <tbody>
          {games.slice(0, 10).map((g: any, i: number) => {
            const sv = getStatVal(g);
            const isHit = overUnder === "over" ? sv > line : sv < line;
            return (
              <tr key={i} className="border-b border-border/15 hover:bg-[hsla(228,20%,14%,0.4)] transition-colors">
                <td className="text-center py-2.5 px-1 whitespace-nowrap text-muted-foreground/50">{g.date?.slice(5)}</td>
                <td className="text-center py-2.5 px-1 whitespace-nowrap font-medium text-foreground/80">{g.matchup?.replace(/.*(?:vs\.|@)\s*/, "")}</td>
                <td className={`text-center py-2.5 px-1 font-bold ${g.result === "W" ? "text-nba-green" : "text-nba-red"}`}>{g.result}</td>
                <td className="text-center py-2.5 px-1 text-muted-foreground/50">{g.MIN}</td>
                <td className="text-center py-2.5 px-1 text-foreground/70">{g.PTS}</td>
                <td className="text-center py-2.5 px-1 text-foreground/70">{g.REB}</td>
                <td className="text-center py-2.5 px-1 text-foreground/70">{g.AST}</td>
                <td className="text-center py-2.5 px-1 font-bold text-foreground">{sv}</td>
                <td className={`text-center py-2.5 px-1 font-black text-sm ${isHit ? "text-nba-green" : "text-nba-red"}`}>{isHit ? "✓" : "✗"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getReasoningType(r: string) {
  const lower = r.toLowerCase();
  if (lower.includes("warning") || lower.includes("caution") || lower.includes("monitor")) return "yellow";
  if (lower.includes("low") || lower.includes("cold") || lower.includes("below") || lower.includes("unfavorable") || lower.includes("down") || lower.includes("do not bet")) return "red";
  if (lower.includes("high") || lower.includes("hot") || lower.includes("above") || lower.includes("favorable") || lower.includes("strong") || lower.includes("smash")) return "green";
  return "neutral";
}

const FreePropsPage = () => {
  const { fmt: formatOdds } = useOddsFormat();
  const [props, setProps] = useState<FreeProp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "nba" | "mlb" | "ufc">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [propTypeFilter, setPropTypeFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  // Detail view state
  const [selectedProp, setSelectedProp] = useState<FreeProp | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [correlations, setCorrelations] = useState<CorrelatedProp[]>([]);
  const [corrLoading, setCorrLoading] = useState(false);

  useEffect(() => {
    const loadProps = async () => {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("free_props")
        .select("*")
        .eq("prop_date", today)
        .order("confidence", { ascending: false });

      const fetched = (data as FreeProp[]) || [];

      if (fetched.length === 0) {
        try {
          const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
          await fetch(`https://${projectId}.supabase.co/functions/v1/free-props`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "generate" }),
          });
          const { data: retry } = await supabase
            .from("free_props")
            .select("*")
            .eq("prop_date", today)
            .order("confidence", { ascending: false });
          setProps((retry as FreeProp[]) || []);
        } catch (e) { console.error(e); }
      } else {
        setProps(fetched);
      }
      setLoading(false);
    };
    loadProps();
  }, []);

  // Available prop types for the current sport filter
  const availablePropTypes = useMemo(() => {
    const sportProps = props.filter(p => filter === "all" || p.sport === filter);
    const types = [...new Set(sportProps.map(p => p.prop_type))];
    return types.sort();
  }, [props, filter]);

  // Reset prop type filter when sport changes
  useEffect(() => {
    setPropTypeFilter("all");
  }, [filter]);

  const filtered = useMemo(() => {
    const result = props.filter(p => {
      if (filter !== "all" && p.sport !== filter) return false;
      if (propTypeFilter !== "all" && p.prop_type !== propTypeFilter) return false;
      if (searchQuery && !p.player_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
    result.sort((a, b) => sortOrder === "desc" ? (b.confidence || 0) - (a.confidence || 0) : (a.confidence || 0) - (b.confidence || 0));
    return result;
  }, [props, filter, propTypeFilter, searchQuery, sortOrder]);

  const handlePropClick = async (prop: FreeProp) => {
    setSelectedProp(prop);
    setAnalysisData(null);
    setCorrelations([]);

    setAnalysisLoading(true);
    try {
      const data = await analyzeProp({
        player: prop.player_name,
        prop_type: prop.prop_type,
        line: prop.line,
        over_under: prop.direction === "over" || prop.direction === "win" ? "over" : "under",
        opponent: prop.opponent || undefined,
        sport: prop.sport,
      });
      if (!data.error) {
        setAnalysisData(data);
        // Fetch correlated props for NBA
        if (prop.sport === "nba") {
          setCorrLoading(true);
          const playerTeam = data.team || data.player_info?.team || prop.team || "";
          supabase.functions.invoke("correlated-props", {
            body: { player: prop.player_name, prop: prop.prop_type, line: prop.line, team: playerTeam },
          }).then(({ data: corrData, error: corrErr }) => {
            if (!corrErr && Array.isArray(corrData)) setCorrelations(corrData);
            setCorrLoading(false);
          }).catch(() => setCorrLoading(false));
        }
      }
    } catch (e) { console.error(e); }
    setAnalysisLoading(false);
  };

  // ── Detail View (mirrors NbaPropsPage results exactly) ──
  if (selectedProp) {
    const prop = selectedProp;
    const results = analysisData;
    const h2h = results?.head_to_head || {};
    const prev = results?.prev_season_h2h || {};
    const propType = prop.prop_type;
    const overUnder = prop.direction === "over" || prop.direction === "win" ? "over" : "under";
    const lineNum = prop.line;

    return (
      <div className="flex flex-col min-h-full relative">
        <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(250 76% 62%)' }} />
        

        <div className="px-4 pt-3 pb-28 space-y-3 relative z-10">
          <button
            onClick={() => { setSelectedProp(null); setAnalysisData(null); setCorrelations([]); }}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-accent/70 mb-2 active:opacity-60"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Props
          </button>

          {/* Loading */}
          {analysisLoading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-20">
              <div className="relative w-16 h-16 mb-5">
                <motion.div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
                <motion.div className="absolute inset-2 rounded-full border border-transparent border-b-[hsl(210,100%,60%)]" animate={{ rotate: -360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }} />
              </div>
              <motion.p className="text-foreground/60 text-sm font-medium" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>Crunching numbers...</motion.p>
            </motion.div>
          )}

          {/* Full Results - Same as NbaPropsPage */}
          {results && !analysisLoading && (
            <ErrorBoundary>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                {/* Analysis Complete Banner */}
                <motion.div initial={{ opacity: 0, y: -8, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="flex items-center justify-between p-3 rounded-xl"
                  style={{ background: 'linear-gradient(135deg, hsla(158, 64%, 52%, 0.08), hsla(210, 100%, 60%, 0.04))', border: '1px solid hsla(158, 64%, 52%, 0.12)' }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-bold text-nba-green uppercase tracking-wider">Analysis Complete</span>
                  </div>
                  {prop.edge != null && prop.edge > 0 && (
                    <span className={`text-[10px] font-bold ${getEdgeColor(prop.edge)}`}>{prop.edge.toFixed(1)}% edge</span>
                  )}
                </motion.div>

                {results.player && (
                  <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                    <PlayerCard name={results.player.full_name} team={results.player.team_name} position={results.player.position} jersey={results.player.jersey} headshotUrl={results.player.headshot_url} />
                  </motion.div>
                )}

                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15, type: "spring" }}>
                  <VerdictBadge confidence={results.confidence} verdict={results.verdict} overUnder={results.over_under} line={results.line} propDisplay={results.prop_display} />
                </motion.div>

                <div className="grid grid-cols-4 gap-2">
                  <StatPill label="Season" value={results.season_hit_rate?.avg ?? "--"} delay={0.2} />
                  <StatPill label="L10" value={results.last_10?.avg ?? "--"} delay={0.25} />
                  <StatPill label="L5" value={results.last_5?.avg ?? "--"} delay={0.3} />
                  <StatPill label="H2H" value={h2h.avg ?? "--"} delay={0.35} />
                </div>

                {results.season_averages && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="vision-card p-4">
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-3 block">Season Averages</span>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { label: "PPG", value: results.season_averages?.pts },
                        { label: "RPG", value: results.season_averages?.reb },
                        { label: "APG", value: results.season_averages?.ast },
                        { label: "3PM", value: results.season_averages?.fg3m },
                        { label: "MPG", value: results.season_averages?.min },
                      ].map((s, i) => (
                        <motion.div key={s.label} className="text-center py-2 rounded-lg" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}
                          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 + i * 0.04 }}>
                          <span className="block text-sm font-extrabold tabular-nums text-foreground/80">{s.value ?? "--"}</span>
                          <span className="block text-[8px] text-muted-foreground/35 font-bold uppercase">{s.label}</span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}

                <Section title="Hit Rates" icon={<Target className="w-3.5 h-3.5" />}>
                  <div className="flex justify-around overflow-x-auto scrollbar-hide py-2">
                    <HitRateRing rate={results.season_hit_rate?.rate || 0} hits={results.season_hit_rate?.hits || 0} total={results.season_hit_rate?.total || 0} label="Season" delay={0} />
                    <HitRateRing rate={results.last_10?.rate || 0} hits={results.last_10?.hits || 0} total={results.last_10?.total || 0} label="L10" delay={0.1} />
                    <HitRateRing rate={results.last_5?.rate || 0} hits={results.last_5?.hits || 0} total={results.last_5?.total || 0} label="L5" delay={0.2} />
                    <HitRateRing rate={h2h.rate || 0} hits={h2h.hits || 0} total={h2h.total || 0} label="H2H" delay={0.3} />
                  </div>
                </Section>

                <Section title="Odds & EV Analysis" icon={<Zap className="w-3.5 h-3.5" />}>
                  <OddsProjection
                    playerName={prop.player_name}
                    propType={propType}
                    line={lineNum}
                    overUnder={overUnder}
                    modelHitRate={results.confidence}
                    seasonHitRate={results.season_hit_rate?.rate}
                    last10HitRate={results.last_10?.rate}
                    last5HitRate={results.last_5?.rate}
                    h2hHitRate={h2h.rate}
                  />
                </Section>

                <OddsComparison playerName={prop.player_name} propType={propType} line={lineNum} overUnder={overUnder} sport={prop.sport as "nba" | "mlb" | "nhl" | "nfl" | "ufc"} modelHitRate={results.confidence} />

                <Section title={prop.sport === "mlb" ? "Hit Zones" : prop.sport === "nhl" ? "Scoring Zones" : propType === "3pm" ? "3PT Zones" : propType === "rebounds" ? "Rebound Zones" : propType === "assists" ? "Assist Zones" : "Scoring Zones"} defaultOpen={false}>
                  <ShotChart propType={propType} playerName={prop.player_name} analysisData={results} sport={prop.sport} />
                </Section>

                {results.next_game && (
                  <Section title="Matchup Analysis">
                    <StrengthWeakness playerName={results.player?.full_name || prop.player_name} opponentName={results.next_game?.opponent_name || "Opponent"} sport={prop.sport as "nba" | "mlb" | "nhl" | "ufc"} />
                  </Section>
                )}

                <Section title="Game Log" icon={<BarChart3 className="w-3.5 h-3.5" />}>
                  <GameChart data={results} />
                </Section>

                {results.next_game && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vision-card p-5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">Next Game</span>
                    <p className="text-lg font-bold text-foreground mt-1.5">{results.next_game.is_home ? "vs" : "@"} {results.next_game.opponent_name}</p>
                    <p className="text-xs text-muted-foreground/50 mt-0.5">{results.next_game.date}</p>
                  </motion.div>
                )}

                <Section title={h2h.opponent ? `H2H vs ${h2h.opponent}` : "Head-to-Head"} defaultOpen={false}>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { label: "This Season", rate: h2h.rate, total: h2h.total },
                      { label: "Last Season", rate: prev.rate, total: prev.total },
                      { label: "Combined", rate: results.h2h_combined?.rate, total: results.h2h_combined?.total },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground/65">{s.label}</span>
                        <span className={`block text-xl font-extrabold tabular-nums ${(s.rate || 0) >= 65 ? "text-nba-green" : (s.rate || 0) >= 50 ? "text-nba-blue" : (s.rate || 0) >= 35 ? "text-nba-yellow" : "text-nba-red"}`}>{s.rate ?? "--"}%</span>
                        <span className="block text-[9px] text-muted-foreground/55">{s.total || 0} games</span>
                      </div>
                    ))}
                  </div>
                  <GamesTable games={[...(h2h.games || []), ...(prev.games || [])]} line={results.line} overUnder={results.over_under} propType={results.prop_type} />
                </Section>

                <Section title="Injury Report" defaultOpen={true}>
                  <div className="space-y-5">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">Player</span>
                      {results.player_injuries?.length > 0 ? (
                        results.player_injuries.map((inj: any, i: number) => (
                          <div key={i} className="flex items-center gap-2.5 mt-2 py-2 border-b border-border/15">
                            <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-destructive/15 text-nba-red">{inj.status?.toUpperCase()}</span>
                            <span className="text-xs text-foreground/60">{inj.detail || "No details"}</span>
                          </div>
                        ))
                      ) : <p className="text-xs text-nba-green mt-2 font-semibold">Healthy ✓</p>}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">Teammates</span>
                      {results.teammate_injuries?.length > 0 ? (
                        <div className="mt-2 space-y-1">
                          {results.teammate_injuries.map((inj: any, idx: number) => {
                            const statusColor = ["out", "doubtful"].includes(inj.status?.toLowerCase()) ? "text-nba-red" : "text-nba-yellow";
                            const statusBg = ["out", "doubtful"].includes(inj.status?.toLowerCase()) ? "bg-destructive/15" : "bg-yellow-500/10";
                            return (
                              <div key={idx} className="flex items-center gap-2 py-2 border-b border-border/10 last:border-0">
                                <span className="text-xs font-semibold text-foreground/80">{inj.player_name}</span>
                                {inj.position && <span className="text-[9px] text-muted-foreground/65">({inj.position})</span>}
                                <span className={`text-[9px] font-bold px-2 py-1 rounded-lg ml-auto ${statusBg} ${statusColor}`}>{inj.status}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : <p className="text-xs text-muted-foreground/65 mt-2">None reported</p>}
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">Opponent</span>
                      {results.opponent_injuries?.length > 0 ? (
                        <div className="mt-2 space-y-1">
                          {results.opponent_injuries.map((inj: any, idx: number) => {
                            const statusColor = ["out", "doubtful"].includes(inj.status?.toLowerCase()) ? "text-nba-red" : "text-nba-yellow";
                            const statusBg = ["out", "doubtful"].includes(inj.status?.toLowerCase()) ? "bg-destructive/15" : "bg-yellow-500/10";
                            return (
                              <div key={idx} className="flex items-center gap-2 py-2 border-b border-border/10 last:border-0">
                                <span className="text-xs font-semibold text-foreground/80">{inj.player_name}</span>
                                {inj.position && <span className="text-[9px] text-muted-foreground/65">({inj.position})</span>}
                                <span className={`text-[9px] font-bold px-2 py-1 rounded-lg ml-auto ${statusBg} ${statusColor}`}>{inj.status}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : <p className="text-xs text-muted-foreground/65 mt-2">None reported</p>}
                    </div>
                    {results.injury_insights?.length > 0 && (
                      <div className="mt-2 pt-4 border-t border-border/15">
                        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent/70">AI Impact Analysis</span>
                        <div className="mt-2 space-y-2">
                          {results.injury_insights.map((insight: string, idx: number) => (
                            <div key={idx} className="text-xs leading-relaxed text-foreground/60 py-0.5">{insight}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Section>

                {results.minutes_trend && results.minutes_trend.trend !== "insufficient_data" && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vision-card p-5 relative overflow-hidden">
                    <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-[0.06] pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${results.minutes_trend.trend === "up" ? "hsl(158 64% 52%)" : results.minutes_trend.trend === "down" ? "hsl(0 72% 51%)" : "hsl(210 100% 60%)"}, transparent)` }} />
                    <div className="flex items-center gap-2.5 mb-3">
                      <Activity className="w-3.5 h-3.5 text-accent/40" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">{prop.sport === "mlb" ? "At-Bats Trend" : prop.sport === "nhl" ? "TOI Trend" : "Minutes Trend"}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-extrabold relative overflow-hidden ${
                        results.minutes_trend.trend === "up" ? "text-nba-green" : results.minutes_trend.trend === "down" ? "text-nba-red" : "text-muted-foreground"
                      }`} style={{
                        background: results.minutes_trend.trend === "up" ? "hsla(158,64%,52%,0.08)" : results.minutes_trend.trend === "down" ? "hsla(0,72%,51%,0.08)" : "hsla(228,20%,12%,0.5)",
                        border: `1px solid ${results.minutes_trend.trend === "up" ? "hsla(158,64%,52%,0.15)" : results.minutes_trend.trend === "down" ? "hsla(0,72%,51%,0.15)" : "hsla(228,20%,20%,0.2)"}`,
                      }}>
                        {results.minutes_trend.trend === "up" ? "↑" : results.minutes_trend.trend === "down" ? "↓" : "→"}
                      </div>
                      <div>
                        <p className="text-base font-bold text-foreground tabular-nums">{results.minutes_trend.avg_min} {prop.sport === "mlb" ? "AB avg" : prop.sport === "nhl" ? "TOI avg" : "min avg"}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground/35">Recent: <span className="text-foreground/60 font-semibold">{results.minutes_trend.recent_avg}</span></span>
                          <span className="text-[10px] text-muted-foreground/45">·</span>
                          <span className="text-[10px] text-muted-foreground/35">Earlier: <span className="text-foreground/60 font-semibold">{results.minutes_trend.early_avg}</span></span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}


                {/* Correlated Props */}
                {prop.sport === "nba" && (
                  <Section title="Correlated Props" icon={<Link2 className="w-3.5 h-3.5" />}>
                    {corrLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 text-accent animate-spin" />
                        <span className="text-[11px] text-muted-foreground/50 ml-2">Finding correlations...</span>
                      </div>
                    ) : correlations.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-accent/50 mb-2">
                          When {prop.player_name.split(" ").pop()} {(PROP_LABELS[prop.prop_type] || prop.prop_type).toUpperCase()} hits, these also hit:
                        </p>
                        {correlations.map((c, ci) => (
                          <motion.div key={ci} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: ci * 0.04 }}
                            className="flex items-center justify-between py-2.5 px-3 rounded-xl" style={{ background: 'hsla(228, 20%, 8%, 0.5)' }}>
                            <div>
                              <span className="text-[13px] font-bold text-foreground">{c.correlated_player}</span>
                              {c.correlated_team && <span className="text-[10px] text-muted-foreground/50 ml-1.5">{c.correlated_team}</span>}
                              <div className="text-[10px] text-muted-foreground/50 mt-0.5">{(PROP_LABELS[c.correlated_prop] || c.correlated_prop).toUpperCase()}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-[9px] text-muted-foreground/35">{c.sample_size}G</span>
                              <span className={`text-[16px] font-black tabular-nums ${c.hit_rate >= 80 ? "text-nba-green" : c.hit_rate >= 60 ? "text-nba-blue" : "text-nba-yellow"}`}>{c.hit_rate}%</span>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground/65 text-center py-4">No strong correlations found for this prop</p>
                    )}
                  </Section>
                )}
              </motion.div>
            </ErrorBoundary>
          )}

          {!analysisLoading && !results && (
            <div className="text-center py-10">
              <p className="text-[12px] text-muted-foreground/65">Could not load analysis</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="flex flex-col min-h-full">
      

      <div className="px-4 pt-3 pb-2 space-y-3">
        {/* Sport Filter */}
        <div className="flex p-0.5 rounded-xl" style={{ background: 'hsla(228, 20%, 12%, 0.6)', border: '1px solid hsla(228, 25%, 18%, 0.3)' }}>
          {(["all", "nba", "mlb", "ufc"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`relative flex-1 py-1.5 text-[12px] font-bold uppercase tracking-wider text-center rounded-lg transition-all ${
                filter === f ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              {filter === f && (
                <motion.div
                  layoutId="free-props-filter"
                  className="absolute inset-0 rounded-lg"
                  style={{ background: 'hsla(250, 76%, 62%, 0.15)', border: '1px solid hsla(250, 76%, 62%, 0.2)' }}
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                />
              )}
              <span className="relative z-10">{f === "all" ? "All" : f.toUpperCase()}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/65" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search player..."
            className="w-full pl-9 pr-8 py-2 rounded-xl text-[13px] text-foreground placeholder:text-muted-foreground/55 outline-none transition-all"
            style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 25%, 18%, 0.25)' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-3.5 h-3.5 text-muted-foreground/65" />
            </button>
          )}
        </div>

        {/* Prop Type Filter & Sort */}
        <div className="flex items-center gap-2">
          <div className="flex-1 overflow-x-auto scrollbar-hide">
            <div className="flex gap-1.5">
              <button
                onClick={() => setPropTypeFilter("all")}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  propTypeFilter === "all" ? "text-foreground" : "text-muted-foreground/50"
                }`}
                style={{
                  background: propTypeFilter === "all" ? 'hsla(250, 76%, 62%, 0.15)' : 'hsla(228, 20%, 12%, 0.4)',
                  border: `1px solid ${propTypeFilter === "all" ? 'hsla(250, 76%, 62%, 0.25)' : 'hsla(228, 25%, 18%, 0.2)'}`,
                }}
              >
                All
              </button>
              {availablePropTypes.map(pt => (
                <button
                  key={pt}
                  onClick={() => setPropTypeFilter(pt)}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                    propTypeFilter === pt ? "text-foreground" : "text-muted-foreground/50"
                  }`}
                  style={{
                    background: propTypeFilter === pt ? 'hsla(250, 76%, 62%, 0.15)' : 'hsla(228, 20%, 12%, 0.4)',
                    border: `1px solid ${propTypeFilter === pt ? 'hsla(250, 76%, 62%, 0.25)' : 'hsla(228, 25%, 18%, 0.2)'}`,
                  }}
                >
                  {PROP_LABELS[pt] || pt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setSortOrder(prev => prev === "desc" ? "asc" : "desc")}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 transition-all active:scale-95"
            style={{ background: 'hsla(228, 20%, 12%, 0.4)', border: '1px solid hsla(228, 25%, 18%, 0.2)' }}
          >
            <BarChart3 className="w-3 h-3" />
            {sortOrder === "desc" ? "High→Low" : "Low→High"}
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            <Clock className="w-3 h-3" />
            <span>Updated daily</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'hsla(160, 84%, 55%, 0.8)' }}>
            <Zap className="w-3 h-3" />
            <span>{filtered.length} props</span>
          </div>
        </div>
      </div>

      {/* Props List */}
      <div className="flex-1 px-4 pb-28">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-accent animate-spin mb-3" />
            <p className="text-[12px] text-muted-foreground/50">Loading today's props...</p>
          </div>
        ) : filtered.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
            <p className="text-[14px] font-semibold text-foreground/60 mb-1">No props available</p>
            <p className="text-[12px] text-muted-foreground/65">Props will appear when games are scheduled</p>
          </motion.div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((prop, i) => {
              const hitRate = prop.confidence || 0;
              const highConfidence = hitRate >= 65;
              return (
                <motion.button
                  key={prop.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.015 }}
                  onClick={() => handlePropClick(prop)}
                  className={`w-full text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-transform ${highConfidence ? "ring-1 ring-emerald-500/20" : ""}`}
                  style={{
                    background: highConfidence ? 'hsla(158, 64%, 39%, 0.06)' : 'hsla(228, 20%, 10%, 0.5)',
                    border: `1px solid ${highConfidence ? 'hsla(158, 64%, 39%, 0.15)' : 'hsla(228, 25%, 18%, 0.2)'}`,
                  }}
                >
                  <div className="flex items-center p-3 gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[14px] font-bold text-foreground truncate">{prop.player_name}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md text-muted-foreground/60"
                          style={{ background: 'hsla(228, 20%, 20%, 0.4)' }}>
                          {prop.sport}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold ${prop.direction === "over" || prop.direction === "win" ? "text-nba-green" : "text-nba-red"}`}>
                          {(prop.direction === "over" || prop.direction === "win")
                            ? <TrendingUp className="w-3 h-3 inline mr-0.5" />
                            : <TrendingDown className="w-3 h-3 inline mr-0.5" />}
                          {prop.direction.toUpperCase()}
                        </span>
                        <span className="text-[12px] text-foreground/70 font-medium tabular-nums">
                          {prop.line > 0 ? prop.line : ""} {PROP_LABELS[prop.prop_type] || prop.prop_type.toUpperCase()}
                        </span>
                        {prop.odds != null && (
                          <span className="text-[11px] text-muted-foreground/50 tabular-nums">{formatOdds(prop.odds)}</span>
                        )}
                      </div>
                      {prop.opponent && (
                        <span className="text-[10px] text-muted-foreground/65 mt-0.5 block truncate">vs {prop.opponent}</span>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {/* Confidence % - primary */}
                      <div className="flex flex-col items-center px-2.5 py-1.5 rounded-xl" style={{ background: getHitRateColor(hitRate).bg }}>
                        <span className={`text-[16px] font-black tabular-nums leading-none ${getHitRateColor(hitRate).text}`}>{hitRate}%</span>
                        <span className={`text-[7px] font-bold uppercase tracking-widest mt-0.5 ${getHitRateColor(hitRate).text}`}>Confidence</span>
                      </div>
                      {highConfidence && (
                        <span className="text-[9px] font-bold text-nba-green flex items-center gap-0.5">
                          <Sparkles className="w-2.5 h-2.5" /> High Conf.
                        </span>
                      )}
                      {/* Edge - secondary */}
                      {prop.edge != null && prop.edge > 0 && (
                        <span className={`text-[10px] font-bold tabular-nums ${getEdgeColor(prop.edge)}`}>
                          {prop.edge.toFixed(1)}% edge
                        </span>
                      )}
                    </div>

                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/45 shrink-0" />
                  </div>

                  {/* Mini bar chart */}
                  <div className="px-3 pb-2">
                    <div className="flex gap-[2px] h-[14px] items-end">
                      {Array.from({ length: 10 }, (_, j) => {
                        const height = 30 + Math.random() * 70;
                        const isHit = Math.random() > 0.35;
                        return (
                          <div
                            key={j}
                            className="flex-1 rounded-sm"
                            style={{
                              height: `${height}%`,
                              background: isHit ? 'hsla(160, 84%, 39%, 0.7)' : 'hsla(0, 72%, 51%, 0.5)',
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FreePropsPage;
