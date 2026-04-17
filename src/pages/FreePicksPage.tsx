import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Flame, Clock, TrendingUp, Star, ChevronRight, Zap,
  BarChart3, Shield, MapPin, Trophy, Filter,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

import { useOddsFormat } from "@/hooks/useOddsFormat";

/* ── Types ── */
interface Pick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  direction: string;
  hit_rate: number;
  sport: string;
  team: string | null;
  opponent: string | null;
  home_team: string | null;
  away_team: string | null;
  odds: string | null;
  reasoning: string | null;
  pick_date: string;
  avg_value: number | null;
  bet_type: string | null;
  tier: string | null;
}

interface TrendProp {
  player: string;
  team: string;
  opponent: string;
  prop_type: string;
  direction: string;
  line: number;
  odds: number;
  book: string;
  streak_type: string;
  streak_label: string;
  streak_games: number;
  streak_total: number;
  hit_pct: number;
}

interface SGP {
  matchup: string;
  home_team: string;
  away_team: string;
  legs: Array<{ player: string; prop: string; direction: string; line: number; odds: number; book: string }>;
  combined_hit_pct: number;
  streak_label: string;
}

/* ── Helpers ── */
function getConfidenceColor(rate: number) {
  if (rate >= 70) return { text: "text-nba-green", bg: "bg-nba-green-dim", dot: "bg-nba-green" };
  if (rate >= 55) return { text: "text-nba-blue", bg: "bg-nba-blue-dim", dot: "bg-nba-blue" };
  if (rate >= 40) return { text: "text-nba-yellow", bg: "bg-nba-yellow-dim", dot: "bg-nba-yellow" };
  return { text: "text-nba-red", bg: "bg-nba-red-dim", dot: "bg-nba-red" };
}

function getPropLabel(pt: string): string {
  const map: Record<string, string> = {
    points: "PTS", rebounds: "REB", assists: "AST",
    "3-pointers": "3PT", steals: "STL", blocks: "BLK",
    turnovers: "TO", "pts+reb+ast": "PRA",
    hits: "HITS", home_runs: "HR", rbi: "RBI",
    strikeouts: "K", total_bases: "TB", runs: "RUNS",
    goals: "GOALS", shots_on_goal: "SOG", saves: "SAVES",
    moneyline: "ML", sig_strikes: "SIG STR", takedowns: "TD",
    ko_tko: "KO/TKO", submission: "SUB", rounds: "ROUNDS",
  };
  return map[pt] || pt.toUpperCase();
}

const PROP_FILTERS_BY_SPORT: Record<string, { value: string; label: string }[]> = {
  all: [
    { value: "all", label: "ALL" },
    { value: "points", label: "PTS" },
    { value: "rebounds", label: "REB" },
    { value: "assists", label: "AST" },
    { value: "3-pointers", label: "3PT" },
    { value: "hits", label: "HITS" },
    { value: "home_runs", label: "HR" },
    { value: "strikeouts", label: "K" },
  ],
  nba: [
    { value: "all", label: "ALL" },
    { value: "points", label: "PTS" },
    { value: "rebounds", label: "REB" },
    { value: "assists", label: "AST" },
    { value: "3-pointers", label: "3PT" },
    { value: "steals", label: "STL" },
    { value: "blocks", label: "BLK" },
    { value: "pts+reb+ast", label: "PRA" },
  ],
  mlb: [
    { value: "all", label: "ALL" },
    { value: "hits", label: "HITS" },
    { value: "home_runs", label: "HR" },
    { value: "rbi", label: "RBI" },
    { value: "strikeouts", label: "K" },
    { value: "total_bases", label: "TB" },
    { value: "runs", label: "RUNS" },
  ],
  nhl: [
    { value: "all", label: "ALL" },
    { value: "goals", label: "GOALS" },
    { value: "assists", label: "AST" },
    { value: "points", label: "PTS" },
    { value: "shots_on_goal", label: "SOG" },
    { value: "saves", label: "SAVES" },
  ],
  ufc: [
    { value: "all", label: "ALL" },
    { value: "moneyline", label: "ML" },
    { value: "sig_strikes", label: "SIG STR" },
    { value: "takedowns", label: "TD" },
    { value: "ko_tko", label: "KO/TKO" },
    { value: "submission", label: "SUB" },
    { value: "rounds", label: "ROUNDS" },
  ],
};

function computeEdge(hitRate: number): number {
  return Math.max(0, Math.round((hitRate - 50) * 0.8 * 10) / 10);
}

const STREAK_ICONS: Record<string, typeof Flame> = {
  recent_form: Flame,
  vs_opponent: Shield,
  home_away: MapPin,
};
const STREAK_COLORS: Record<string, string> = {
  recent_form: "from-[hsl(30,100%,50%)] to-[hsl(15,100%,55%)]",
  vs_opponent: "from-[hsl(142,100%,50%)] to-[hsl(158,64%,52%)]",
  home_away: "from-[hsl(190,90%,55%)] to-[hsl(158,64%,52%)]",
};

const stagger = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.04, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
});

type SportFilter = "all" | "nba" | "mlb" | "nhl" | "ufc";
type SortMode = "high" | "low";
type TabType = "picks" | "100club" | "sgp" | "trends";

const TABS: { key: TabType; label: string; icon: typeof Zap }[] = [
  { key: "picks", label: "Picks", icon: Zap },
  { key: "100club", label: "100%", icon: Trophy },
  { key: "sgp", label: "SGP", icon: Star },
  { key: "trends", label: "Trends", icon: TrendingUp },
];

const FreePicksPage = () => {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [trends, setTrends] = useState<TrendProp[]>([]);
  const [sgps, setSgps] = useState<SGP[]>([]);
  const [club100, setClub100] = useState<TrendProp[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [propFilter, setPropFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("high");
  const [pickDate, setPickDate] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabType>("picks");
  const navigate = useNavigate();
  const { fmt: formatOdds } = useOddsFormat();

  // Reset prop filter when sport changes
  useEffect(() => { setPropFilter("all"); }, [sportFilter]);

  // Fetch picks
  useEffect(() => {
    const fetchPicks = async () => {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      let { data } = await supabase
        .from("daily_picks")
        .select("*")
        .eq("pick_date", today)
        .order("hit_rate", { ascending: false });

      if (data && data.length > 0) {
        setPicks(data as Pick[]);
        setPickDate(today);
      } else {
        const { data: recent } = await supabase
          .from("daily_picks")
          .select("*")
          .order("pick_date", { ascending: false })
          .order("hit_rate", { ascending: false })
          .limit(50);
        if (recent && recent.length > 0) {
          const latestDate = recent[0].pick_date;
          setPicks(recent.filter((p: any) => p.pick_date === latestDate) as Pick[]);
          setPickDate(latestDate);
        } else {
          setPicks([]);
          setPickDate(today);
        }
      }
      setLoading(false);
    };
    fetchPicks();
  }, []);

  // Fetch trends
  useEffect(() => {
    const fetchTrends = async () => {
      setTrendsLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("trends-api");
        if (error) throw error;
        setTrends(data.trends || []);
        setSgps(data.sgps || []);
        setClub100(data.club100 || []);
      } catch (e) {
        console.error("Trends fetch error:", e);
      } finally {
        setTrendsLoading(false);
      }
    };
    fetchTrends();
  }, []);

  // Apply filters — only show 50%+ confidence picks
  let filtered = picks.filter(p => p.hit_rate >= 50);
  if (sportFilter !== "all") filtered = filtered.filter(p => p.sport === sportFilter);
  if (propFilter !== "all") filtered = filtered.filter(p => p.prop_type === propFilter);
  filtered = [...filtered].sort((a, b) =>
    sortMode === "high" ? b.hit_rate - a.hit_rate : a.hit_rate - b.hit_rate
  );

  const isStale = pickDate && pickDate !== new Date().toISOString().slice(0, 10);
  const formattedDate = pickDate ? new Date(pickDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";

  const totalCount = picks.length + trends.length + club100.length + sgps.length;

  return (
    <div className="flex flex-col min-h-full relative">
      {/* Ambient orbs */}
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: "hsl(142 100% 50%)" }} />
      <div className="vision-orb w-36 h-36 top-[600px] -left-12" style={{ background: "hsl(30 100% 50%)", animationDelay: "-3s" }} />

      

      <div className="px-4 pt-3 pb-2 space-y-2 relative z-10">
        {/* Main category tabs */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            const count = tab.key === "picks" ? picks.length
              : tab.key === "100club" ? club100.length
              : tab.key === "sgp" ? sgps.length
              : trends.length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold tracking-wide transition-all ${
                  active
                    ? "text-white shadow-lg shadow-accent/20"
                    : "text-muted-foreground/50 hover:text-muted-foreground/70"
                }`}
                style={active
                  ? { background: "linear-gradient(135deg, hsl(142 100% 50%), hsl(158 64% 52%))" }
                  : { background: "hsla(228, 20%, 12%, 0.6)", border: "1px solid hsla(228, 20%, 18%, 0.3)" }
                }
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {count > 0 && (
                  <span className={`text-[9px] px-1 py-0.5 rounded-md font-bold ${
                    active ? "bg-white/20" : "bg-secondary"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filters — only show on Picks tab */}
        {activeTab === "picks" && (
          <>
            <div className="flex p-0.5 bg-secondary rounded-lg overflow-x-auto scrollbar-hide">
              {(["all", "nba", "mlb", "nhl", "ufc"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSportFilter(f)}
                  className={`relative flex-1 py-1.5 text-[13px] font-semibold text-center rounded-md transition-all ${
                    sportFilter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {f === "all" ? "All" : f.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex p-0.5 bg-secondary rounded-lg flex-1 overflow-x-auto scrollbar-hide">
                {(PROP_FILTERS_BY_SPORT[sportFilter] || PROP_FILTERS_BY_SPORT.all).map((pf) => (
                  <button
                    key={pf.value}
                    onClick={() => setPropFilter(pf.value)}
                    className={`relative flex-1 py-1.5 text-[11px] font-bold text-center rounded-md transition-all ${
                      propFilter === pf.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                    }`}
                  >
                    {pf.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSortMode(sortMode === "high" ? "low" : "high")}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {sortMode === "high" ? "HIGH–LOW" : "LOW–HIGH"}
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Stats bar */}
      {activeTab === "picks" && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>{isStale ? `Last updated ${formattedDate}` : "Updated daily"}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-nba-green font-medium">
              <Zap className="w-3.5 h-3.5" />
              <span>{filtered.length} picks</span>
            </div>
          </div>
          {isStale && (
            <div className="mt-1.5 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-medium text-nba-yellow" style={{ background: "hsla(43, 96%, 56%, 0.08)", border: "1px solid hsla(43, 96%, 56%, 0.12)" }}>
              <span>⚠️</span>
              <span>No picks for today yet — showing most recent from {formattedDate}</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ Content ═══ */}
      <div className="flex-1 px-4 pb-28 space-y-3 relative z-10">

        {/* ── PICKS TAB ── */}
        {activeTab === "picks" && (
          loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-8 h-8 border-[2.5px] border-secondary border-t-accent rounded-full animate-spin mb-3" />
              <p className="text-[13px] text-muted-foreground">Loading picks...</p>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState message={propFilter !== "all" ? "Try a different prop filter" : "Check back soon — picks are generated daily"} />
          ) : (
            <div className="ios-card overflow-hidden divide-y divide-border">
              {filtered.map((pick, i) => {
                const conf = getConfidenceColor(pick.hit_rate);
                const edge = computeEdge(pick.hit_rate);
                return (
                  <motion.button
                    key={pick.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => navigate("/dashboard/analyze")}
                    className="w-full text-left ios-row active:bg-card-hover transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
                        <span className="text-[15px] font-semibold text-foreground truncate">{pick.player_name}</span>
                        <span className="text-[11px] font-medium text-muted-foreground uppercase">{pick.sport}</span>
                        {(pick as any).bet_type && (pick as any).bet_type !== "prop" && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent uppercase tracking-wide">
                            {(pick as any).bet_type === "moneyline" ? "ML" : (pick as any).bet_type}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pl-3.5">
                        <span className={`text-[12px] font-bold ${pick.direction === "over" ? "text-nba-green" : "text-nba-red"}`}>
                          {pick.direction === "over" ? "↗" : "↘"}{pick.direction.toUpperCase()}
                        </span>
                        <span className="text-[13px] text-foreground/80 tabular-nums">
                          {pick.line} {getPropLabel(pick.prop_type)}
                        </span>
                        {pick.odds && <span className="text-[11px] text-muted-foreground tabular-nums">{pick.odds}</span>}
                      </div>
                      {pick.opponent && (
                        <div className="pl-3.5 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">vs {pick.opponent}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className={`text-[15px] font-bold tabular-nums ${conf.text}`}>{pick.hit_rate}%</span>
                      <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">confidence</span>
                      {edge > 0 && <span className="text-[10px] font-semibold text-nba-green">{edge}% edge</span>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/65 shrink-0" />
                  </motion.button>
                );
              })}
            </div>
          )
        )}

        {/* ── 100% CLUB TAB ── */}
        {activeTab === "100club" && (
          trendsLoading ? <LoadingSpinner /> : club100.length === 0 ? (
            <EmptyState message="No 100% club props right now" />
          ) : (
            <div className="space-y-3">
              <SectionHeader icon={Trophy} gradient="from-[hsl(43,96%,56%)] to-[hsl(30,90%,50%)]" title="100% Club" subtitle="Props hitting in 100% of recent games" />
              {club100.map((prop, i) => {
                const Icon = STREAK_ICONS[prop.streak_type] || Flame;
                const gradient = STREAK_COLORS[prop.streak_type] || STREAK_COLORS.recent_form;
                return (
                  <motion.div key={`club-${i}`} {...stagger(i)} className="vision-card p-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 opacity-[0.04] pointer-events-none"
                      style={{ background: "radial-gradient(circle, hsl(43 96% 56%), transparent 70%)" }} />
                    <div className="flex items-start justify-between relative z-10">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[13px] font-extrabold text-foreground">{prop.player}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold text-muted-foreground/50 uppercase"
                            style={{ background: "hsla(228, 20%, 15%, 0.5)" }}>
                            vs {prop.opponent.split(" ").pop()}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/60">
                          <span className={prop.direction === "over" ? "text-nba-green" : "text-nba-red"}>
                            {prop.direction === "over" ? "Over" : "Under"}
                          </span>{" "}{prop.line} {prop.prop_type}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-[13px] font-extrabold text-foreground tabular-nums">{formatOdds(prop.odds)}</span>
                        <p className="text-[8px] text-muted-foreground/55 mt-0.5">{prop.book}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: "1px solid hsla(228, 20%, 18%, 0.3)" }}>
                      <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                        <Icon className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-[10px] text-muted-foreground/50">
                        Hit in <span className="text-foreground font-bold">{prop.streak_games}</span> of last {prop.streak_total} games
                      </span>
                      <span className="ml-auto text-[11px] font-extrabold text-nba-green tabular-nums">100%</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )
        )}

        {/* ── SGP TAB ── */}
        {activeTab === "sgp" && (
          trendsLoading ? <LoadingSpinner /> : sgps.length === 0 ? (
            <EmptyState message="No SGP combos available right now" />
          ) : (
            <div className="space-y-3">
              <SectionHeader icon={Zap} gradient="from-[hsl(142,100%,50%)] to-[hsl(158,64%,52%)]" title="Same-Game Parlays" subtitle="High-confidence SGP combos" />
              {sgps.map((sgp, si) => (
                <motion.div key={`sgp-${si}`} {...stagger(si)} className="vision-card p-4 relative overflow-hidden">
                  <div className="absolute -top-6 -right-6 w-20 h-20 opacity-[0.05] pointer-events-none"
                    style={{ background: "radial-gradient(circle, hsl(142 100% 50%), transparent)" }} />
                  <div className="flex items-center justify-between mb-3 relative z-10">
                    <span className="text-[12px] font-extrabold text-foreground">{sgp.matchup}</span>
                    <span className="text-[11px] font-extrabold text-nba-green tabular-nums">{sgp.combined_hit_pct}%</span>
                  </div>
                  <div className="space-y-2 relative z-10">
                    {sgp.legs.map((leg, li) => (
                      <div key={li} className="flex items-center justify-between px-3 py-2 rounded-xl"
                        style={{ background: "hsla(228, 20%, 10%, 0.5)", border: "1px solid hsla(228, 20%, 18%, 0.2)" }}>
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-3.5 h-3.5 text-accent/60" />
                          <span className="text-[11px] font-bold text-foreground">{leg.player}</span>
                          <span className={`text-[10px] font-semibold ${leg.direction === "over" ? "text-nba-green" : "text-nba-red"}`}>
                            {leg.direction === "over" ? "Over" : "Under"} {leg.line} {leg.prop}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-foreground/70 tabular-nums">{formatOdds(leg.odds)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-2" style={{ borderTop: "1px solid hsla(228, 20%, 18%, 0.2)" }}>
                    <Star className="w-3.5 h-3.5 text-[hsl(43,96%,56%)]" />
                    <span className="text-[9px] text-muted-foreground/65">{sgp.streak_label}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          )
        )}

        {/* ── TRENDS TAB ── */}
        {activeTab === "trends" && (
          trendsLoading ? <LoadingSpinner /> : trends.length === 0 ? (
            <EmptyState message="No player trends available right now" />
          ) : (
            <div className="space-y-3">
              <SectionHeader icon={TrendingUp} gradient="from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]" title="Player Trends" subtitle="Streaking props across all games" />
              {trends.slice(0, 20).map((prop, i) => {
                const Icon = STREAK_ICONS[prop.streak_type] || Flame;
                const gradient = STREAK_COLORS[prop.streak_type] || STREAK_COLORS.recent_form;
                return (
                  <motion.div key={`trend-${i}`} {...stagger(i)} className="vision-card p-3.5 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold text-foreground truncate">{prop.player}</span>
                        <span className="text-[8px] text-muted-foreground/55">vs {prop.opponent.split(" ").pop()}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground/50">
                        <span className={prop.direction === "over" ? "text-nba-green" : "text-nba-red"}>
                          {prop.direction === "over" ? "▲" : "▼"} {prop.line}
                        </span>{" "}{prop.prop_type} · {prop.streak_label}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[12px] font-extrabold text-foreground tabular-nums">{formatOdds(prop.odds)}</span>
                      <p className="text-[9px] text-nba-green font-bold">{prop.streak_games}/{prop.streak_total}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
};

/* ── Shared sub-components ── */
function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-8 h-8 border-[2.5px] border-secondary border-t-accent rounded-full animate-spin mb-3" />
      <p className="text-[11px] text-muted-foreground/65">Loading...</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="vision-card p-8 text-center">
      <Star className="w-10 h-10 text-muted-foreground/65 mx-auto mb-3" />
      <p className="text-[13px] text-muted-foreground">{message}</p>
    </motion.div>
  );
}

function SectionHeader({ icon: Icon, gradient, title, subtitle }: { icon: typeof Flame; gradient: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div>
        <h2 className="text-sm font-extrabold text-foreground tracking-tight">{title}</h2>
        <p className="text-[9px] text-muted-foreground/55">{subtitle}</p>
      </div>
    </div>
  );
}

export default FreePicksPage;
