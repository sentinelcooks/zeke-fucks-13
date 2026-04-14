import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Flame, Shield, MapPin, TrendingUp, Zap, Filter, ChevronRight, Trophy, Star, BarChart3 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useOddsFormat } from "@/hooks/useOddsFormat";

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

const STREAK_ICONS: Record<string, typeof Flame> = {
  recent_form: Flame,
  vs_opponent: Shield,
  home_away: MapPin,
};

const STREAK_COLORS: Record<string, string> = {
  recent_form: "from-[hsl(30,100%,50%)] to-[hsl(15,100%,55%)]",
  vs_opponent: "from-[hsl(250,76%,62%)] to-[hsl(280,70%,55%)]",
  home_away: "from-[hsl(190,90%,55%)] to-[hsl(210,100%,60%)]",
};

const CATEGORIES = [
  { key: "all", label: "All", icon: TrendingUp },
  { key: "100club", label: "100% Club", icon: Trophy },
  { key: "sgp", label: "SGP", icon: Zap },
];

const stagger = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.04, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
});

const TrendsPage = () => {
  const [trends, setTrends] = useState<TrendProp[]>([]);
  const [sgps, setSgps] = useState<SGP[]>([]);
  const [club100, setClub100] = useState<TrendProp[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchTrends = async () => {
      try {
        const { data, error: err } = await supabase.functions.invoke("trends-api");
        if (err) throw err;
        setTrends(data.trends || []);
        setSgps(data.sgps || []);
        setClub100(data.club100 || []);
      } catch (e) {
        console.error("Trends fetch error:", e);
        setError("Failed to load trends");
      } finally {
        setLoading(false);
      }
    };
    fetchTrends();
  }, []);

  const { fmt: formatOdds } = useOddsFormat();

  return (
    <div className="px-4 pt-2 pb-28 space-y-4 relative">
      {/* Ambient orbs */}
      <div className="vision-orb w-64 h-64 -top-20 -right-20" style={{ background: "hsl(30 100% 50%)" }} />
      <div className="vision-orb w-48 h-48 top-[500px] -left-16" style={{ background: "hsl(250 76% 62%)", animationDelay: "-3s" }} />

      <MobileHeader title="Trends" subtitle="Streaks & hot props" />

      {/* Category Tabs */}
      <div className="flex gap-2 relative z-10">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = category === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-bold tracking-wide transition-all ${
                active
                  ? "bg-gradient-to-r from-accent to-[hsl(var(--nba-blue))] text-white shadow-lg shadow-accent/20"
                  : "text-muted-foreground/50 hover:text-muted-foreground/70"
              }`}
              style={!active ? { background: "hsla(228, 20%, 12%, 0.6)", border: "1px solid hsla(228, 20%, 18%, 0.3)" } : undefined}
            >
              <Icon className="w-3.5 h-3.5" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-10 h-10 border-3 border-border border-t-accent rounded-full animate-spin mb-3" />
          <p className="text-[11px] text-muted-foreground/65">Loading trends...</p>
        </div>
      )}

      {error && (
        <div className="vision-card p-4 text-center">
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      )}

      {/* 100% CLUB SECTION */}
      {!loading && (category === "all" || category === "100club") && club100.length > 0 && (
        <motion.div {...stagger(0)} className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(43,96%,56%)] to-[hsl(30,90%,50%)] flex items-center justify-center shadow-lg"
              style={{ boxShadow: "0 4px 12px -2px hsla(43,96%,56%,0.3)" }}>
              <Trophy className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-foreground tracking-tight">100% Club</h2>
              <p className="text-[9px] text-muted-foreground/55">Props hitting in 100% of games</p>
            </div>
          </div>

          {club100.map((prop, i) => {
            const Icon = STREAK_ICONS[prop.streak_type] || Flame;
            const gradient = STREAK_COLORS[prop.streak_type] || STREAK_COLORS.recent_form;
            return (
              <motion.div
                key={`club-${i}`}
                {...stagger(i + 1)}
                className="vision-card p-4 relative overflow-hidden group"
                whileHover={{ scale: 1.01 }}
              >
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
                      </span>
                      {" "}{prop.line} {prop.prop_type}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-[13px] font-extrabold text-foreground tabular-nums">{formatOdds(prop.odds)}</span>
                    <p className="text-[8px] text-muted-foreground/55 mt-0.5">{prop.book}</p>
                  </div>
                </div>

                {/* Streak badge */}
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
        </motion.div>
      )}

      {/* SGP SECTION */}
      {!loading && (category === "all" || category === "sgp") && sgps.length > 0 && (
        <motion.div {...stagger(2)} className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(250,76%,62%)] to-[hsl(210,100%,60%)] flex items-center justify-center shadow-lg"
              style={{ boxShadow: "0 4px 12px -2px hsla(250,76%,62%,0.3)" }}>
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-foreground tracking-tight">Same-Game Parlays</h2>
              <p className="text-[9px] text-muted-foreground/55">High-confidence SGP combos</p>
            </div>
          </div>

          {sgps.map((sgp, si) => (
            <motion.div
              key={`sgp-${si}`}
              {...stagger(si + 1)}
              className="vision-card p-4 relative overflow-hidden"
            >
              <div className="absolute -top-6 -right-6 w-20 h-20 opacity-[0.05] pointer-events-none"
                style={{ background: "radial-gradient(circle, hsl(250 76% 62%), transparent)" }} />

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
        </motion.div>
      )}

      {/* ALL TRENDS */}
      {!loading && category === "all" && trends.length > 0 && (
        <motion.div {...stagger(4)} className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)] flex items-center justify-center shadow-lg">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-foreground tracking-tight">Player Trends</h2>
              <p className="text-[9px] text-muted-foreground/55">Streaking props across all games</p>
            </div>
          </div>

          {trends.slice(0, 15).map((prop, i) => {
            const Icon = STREAK_ICONS[prop.streak_type] || Flame;
            const gradient = STREAK_COLORS[prop.streak_type] || STREAK_COLORS.recent_form;
            return (
              <motion.div
                key={`trend-${i}`}
                {...stagger(i)}
                className="vision-card p-3.5 flex items-center gap-3"
              >
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
                    </span>
                    {" "}{prop.prop_type} · {prop.streak_label}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[12px] font-extrabold text-foreground tabular-nums">{formatOdds(prop.odds)}</span>
                  <p className="text-[9px] text-nba-green font-bold">{prop.streak_games}/{prop.streak_total}</p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {!loading && trends.length === 0 && club100.length === 0 && sgps.length === 0 && (
        <div className="vision-card p-8 text-center">
          <TrendingUp className="w-8 h-8 text-muted-foreground/65 mx-auto mb-3" />
          <p className="text-[12px] text-muted-foreground/65 font-medium">No trends available right now</p>
          <p className="text-[10px] text-muted-foreground/50 mt-1">Check back when games are scheduled</p>
        </div>
      )}
    </div>
  );
};

export default TrendsPage;
