import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { 
  Flame, Users, Target, DollarSign, ChevronRight, 
  TrendingUp, TrendingDown, BarChart3, Crosshair, Layers,
  Zap, Activity, Clock, Sparkles,
  Trophy, Percent
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { PnLCalendar } from "@/components/PnLCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { ModernHomeLayout } from "@/components/home/ModernHomeLayout";

interface Play {
  id: string;
  sport: string;
  result: string;
  stake: number;
  odds: number;
  payout: number | null;
  created_at: string;
}

interface Pick {
  id: string;
  player_name: string;
  pick_date: string;
}

// Faster stagger — 0.03s instead of 0.07s
const stagger = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.03, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
});

function calcProfit(plays: Play[]): number {
  return plays.reduce((sum, p) => {
    if (p.result === "win") return sum + (p.payout || 0);
    if (p.result === "loss") return sum - p.stake;
    return sum;
  }, 0);
}

function AnimatedNumber({ value, prefix = "", suffix = "" }: { value: number | string; prefix?: string; suffix?: string }) {
  return (
    <motion.span
      key={String(value)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="inline-block"
    >
      {prefix}{value}{suffix}
    </motion.span>
  );
}

interface AiRecommendations {
  welcome_message?: string;
  daily_tip?: string;
  recommended_features?: string[];
  focus_sport?: string;
  risk_level?: string;
  bankroll_tip?: string;
}

// Skeleton loader for stat cards
function StatCardSkeleton() {
  return (
    <div className="vision-card-animated p-3 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-secondary/40" />
        <div className="w-14 h-4 rounded-md bg-secondary/30" />
      </div>
      <div className="w-16 h-7 rounded bg-secondary/30 mb-1" />
      <div className="w-12 h-3 rounded bg-secondary/20" />
    </div>
  );
}

const HomePage = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [plays, setPlays] = useState<Play[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiRecs, setAiRecs] = useState<AiRecommendations | null>(null);
  const [homeTheme, setHomeTheme] = useState<"modern" | "classic">(() => {
    return (localStorage.getItem("sentinel_home_theme") as "modern" | "classic") || "modern";
  });

  useEffect(() => {
    const handler = () => {
      setHomeTheme((localStorage.getItem("sentinel_home_theme") as "modern" | "classic") || "modern");
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      const [playsRes, picksRes, onboardingRes] = await Promise.all([
        supabase.from("plays").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("daily_picks").select("id, player_name, pick_date").eq("pick_date", new Date().toISOString().split("T")[0]),
        supabase.from("onboarding_responses" as any).select("ai_recommendations").eq("user_id", user.id).single(),
      ]);
      setPlays((playsRes.data as Play[]) || []);
      setPicks((picksRes.data as Pick[]) || []);
      if ((onboardingRes.data as any)?.ai_recommendations) {
        setAiRecs((onboardingRes.data as any).ai_recommendations as AiRecommendations);
      }
      setLoading(false);
    };
    fetchData();
  }, [user]);

  const stats = useMemo(() => {
    const wins = plays.filter(p => p.result === "win").length;
    const losses = plays.filter(p => p.result === "loss").length;
    const total = wins + losses;
    const hitRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const profit = calcProfit(plays);
    const last7 = plays.filter(p => {
      const d = new Date(p.created_at);
      const week = new Date();
      week.setDate(week.getDate() - 7);
      return d >= week;
    });
    const last7Wins = last7.filter(p => p.result === "win").length;
    const last7Losses = last7.filter(p => p.result === "loss").length;
    const last7Total = last7Wins + last7Losses;
    const roi = total > 0 ? Math.round((profit / plays.reduce((s, p) => s + p.stake, 0)) * 100) : 0;
    const sportCounts: Record<string, number> = {};
    plays.forEach(p => { sportCounts[p.sport] = (sportCounts[p.sport] || 0) + 1; });
    const streak = (() => {
      let s = 0;
      const sorted = [...plays].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (!sorted.length) return 0;
      const first = sorted[0].result;
      for (const p of sorted) {
        if (p.result === first) s++;
        else break;
      }
      return first === "win" ? s : -s;
    })();
    const bestDay = (() => {
      const dayMap: Record<string, number> = {};
      plays.forEach(p => {
        const day = p.created_at.split("T")[0];
        if (!dayMap[day]) dayMap[day] = 0;
        if (p.result === "win") dayMap[day] += (p.payout || 0);
        else if (p.result === "loss") dayMap[day] -= p.stake;
      });
      let best = 0;
      Object.values(dayMap).forEach(v => { if (v > best) best = v; });
      return best;
    })();

    return { wins, losses, total, hitRate, profit, last7Wins, last7Losses, last7Total, roi, sportCounts, todayPicks: picks.length, streak, bestDay };
  }, [plays, picks]);

  // Modern layout — after all hooks
  if (homeTheme === "modern") {
    return <ModernHomeLayout plays={plays} loading={loading} />;
  }

  const isNewUser = stats.total < 5;

  const quickLinks = [
    { label: "Analyze", icon: BarChart3, path: "/dashboard/nba", gradient: "from-[hsl(250,76%,62%)] to-[hsl(210,100%,60%)]", desc: "Props & Lines" },
    { label: "Picks", icon: Sparkles, path: "/dashboard/picks", gradient: "from-[hsl(30,100%,50%)] to-[hsl(15,100%,55%)]", desc: "Today's picks" },
    { label: "Parlay", icon: Layers, path: "/dashboard/parlay", gradient: "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]", desc: "Build a slip" },
    { label: "Lines", icon: Crosshair, path: "/dashboard/moneyline", gradient: "from-[hsl(190,90%,55%)] to-[hsl(210,100%,60%)]", desc: "Moneylines" },
  ];

  const statCards = [
    { 
      icon: Flame, label: "Today's Picks", value: stats.todayPicks || "—", 
      gradient: "from-[hsl(250,76%,62%)] to-[hsl(280,70%,55%)]",
      glow: "hsla(250,76%,62%,0.15)",
      sub: "active today",
      path: "/dashboard/picks",
    },
    { 
      icon: Users, label: "Total Plays", value: stats.total, 
      gradient: "from-[hsl(190,90%,55%)] to-[hsl(210,100%,60%)]",
      glow: "hsla(190,90%,55%,0.15)",
      sub: `${stats.wins}W / ${stats.losses}L`,
      path: "/dashboard/tracker",
    },
    { 
      icon: Target, label: "Hit Rate", value: `${stats.hitRate}%`, 
      gradient: "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]",
      glow: "hsla(158,64%,52%,0.15)",
      sub: stats.hitRate >= 55 ? "above avg" : "tracking",
      path: "/dashboard/tracker",
    },
    { 
      icon: DollarSign, label: "Net Profit", 
      value: `${stats.profit >= 0 ? "+" : ""}$${Math.abs(stats.profit).toFixed(0)}`, 
      gradient: stats.profit >= 0 ? "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]" : "from-[hsl(0,72%,51%)] to-[hsl(340,65%,47%)]",
      glow: stats.profit >= 0 ? "hsla(158,64%,52%,0.15)" : "hsla(0,72%,51%,0.15)",
      sub: `${stats.roi}% ROI`,
      path: "/dashboard/tracker",
    },
  ];

  const ringRadius = 52;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (stats.hitRate / 100) * ringCircumference;

  return (
    <div className="px-4 pt-1 pb-4 space-y-3 relative overflow-hidden">
      {/* Ambient background orbs — clamped to container */}
      <div className="vision-orb w-64 h-64 -top-20 -right-20" style={{ background: 'hsl(250 76% 62%)' }} />
      <div className="vision-orb w-48 h-48 top-[400px] -left-16" style={{ background: 'hsl(190 90% 55%)', animationDelay: '-3s' }} />

      <MobileHeader title="Dashboard" />

      {/* ── QUICK ACCESS — shown first for new users ── */}
      {isNewUser && (
        <motion.div {...stagger(0)}>
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2">Get Started</p>
          <div className="grid grid-cols-4 gap-2">
            {quickLinks.map((link, i) => (
              <motion.button
                key={link.label}
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: i * 0.04, type: "spring", stiffness: 300, damping: 20 }}
                onClick={() => navigate(link.path)}
                whileTap={{ scale: 0.92 }}
                className="vision-card p-3 flex flex-col items-center gap-2 group active:scale-[0.97]"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${link.gradient} flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all group-hover:scale-105`}
                  style={{ boxShadow: '0 4px 12px -2px hsla(228, 20%, 0%, 0.3)' }}>
                  <link.icon className="w-5 h-5 text-white" />
                </div>
                <div className="text-center">
                  <span className="text-[9px] font-semibold text-foreground/60 block">{link.label}</span>
                  <span className="text-[7px] text-muted-foreground/35">{link.desc}</span>
                </div>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── STAT CARDS ── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2 relative z-10">
          {[0,1,2,3].map(i => <StatCardSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 relative z-10">
          {statCards.map((s, i) => (
            <motion.button 
              key={s.label} 
              {...stagger(isNewUser ? i + 4 : i)} 
              className="vision-card-animated p-3 group cursor-pointer min-w-0 text-left active:scale-[0.97] transition-transform"
              onClick={() => navigate(s.path)}
              whileTap={{ scale: 0.97 }}
            >
              {/* Corner glow */}
              <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-[0.06] pointer-events-none"
                style={{ background: `radial-gradient(circle, ${s.glow.replace('0.15', '1')}, transparent)` }} />
              
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2.5">
                  <div 
                    className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg transition-all group-hover:shadow-xl group-hover:scale-105`}
                    style={{ boxShadow: `0 4px 14px -2px ${s.glow}` }}
                  >
                    <s.icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-md text-muted-foreground/65 uppercase tracking-wider"
                    style={{ background: 'hsla(228, 20%, 15%, 0.5)' }}>
                    {s.sub}
                  </span>
                </div>
                <p className="text-xl font-extrabold text-foreground tabular-nums tracking-tight">
                  <AnimatedNumber value={s.value} />
                </p>
                <p className="text-[9px] text-muted-foreground/65 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</p>
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* ── WELCOME + STREAK ── */}
      <motion.div {...stagger(isNewUser ? 8 : 4)} className="relative rounded-2xl overflow-hidden p-4 vision-grain" style={{
        background: 'linear-gradient(127.09deg, hsla(250, 76%, 62%, 0.15) 19.41%, hsla(210, 100%, 60%, 0.06) 76.65%)',
        border: '1px solid hsla(250, 76%, 62%, 0.15)',
      }}>
        <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.08] pointer-events-none" style={{ background: 'radial-gradient(circle, hsl(250 76% 62%), transparent 70%)' }} />
        
        <div className="relative z-10 flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-muted-foreground/65 font-bold uppercase tracking-[0.15em]">Welcome back</p>
            <h2 className="text-lg font-extrabold gradient-text mt-0.5 truncate">{profile?.display_name || user?.email?.split("@")[0] || "User"}</h2>
            <p className="text-[11px] text-muted-foreground/65 mt-1.5 leading-relaxed line-clamp-2">
              {aiRecs?.welcome_message || "Check your latest picks and analytics below."}
            </p>
            <button
              onClick={() => navigate("/dashboard/picks")}
              className="flex items-center gap-1.5 text-accent text-[11px] font-bold mt-2 active:opacity-70 group"
            >
              View picks <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {stats.streak !== 0 && (
            <motion.div
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.3 }}
              className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl relative overflow-hidden shrink-0 ml-3 ${
                stats.streak > 0 ? "bg-nba-green/8" : "bg-nba-red/8"
              }`}
              style={{
                border: `1px solid ${stats.streak > 0 ? "hsla(158, 64%, 52%, 0.15)" : "hsla(0, 72%, 51%, 0.15)"}`,
              }}
            >
              <Zap className={`w-3 h-3 ${stats.streak > 0 ? "text-nba-green" : "text-nba-red"}`} />
              <span className={`text-base font-black tabular-nums ${stats.streak > 0 ? "text-nba-green" : "text-nba-red"}`}>
                {Math.abs(stats.streak)}
              </span>
              <span className="text-[7px] font-bold uppercase tracking-wider text-muted-foreground/55">
                {stats.streak > 0 ? "Win" : "Loss"}
              </span>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* ── AI DAILY TIP — Compact ── */}
      {aiRecs?.daily_tip && (
        <motion.div 
          {...stagger(isNewUser ? 9 : 5)}
          className="relative rounded-xl overflow-hidden p-3 vision-grain"
          style={{
            background: 'linear-gradient(127deg, hsla(158, 64%, 52%, 0.08) 0%, hsla(190, 90%, 55%, 0.04) 100%)',
            border: '1px solid hsla(158, 64%, 52%, 0.1)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)] flex items-center justify-center shrink-0 shadow-lg">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-0.5">AI Tip</p>
              <p className="text-[11px] text-foreground/80 leading-relaxed font-medium">{aiRecs.daily_tip}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── PNL CALENDAR — Collapsed for new users ── */}
      {!isNewUser && <PnLCalendar plays={plays} />}

      {/* ── PERFORMANCE + SPORT BREAKDOWN ── */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Performance Ring */}
        <motion.div {...stagger(isNewUser ? 10 : 6)} className="vision-card p-3.5 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="vision-orb w-20 h-20 top-0 left-0" style={{ background: 'hsl(250 76% 62%)', animationDelay: '-2s' }} />
          <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-1 relative z-10">Performance</p>
          <div className="relative w-24 h-24 my-1">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r={ringRadius} fill="none" stroke="hsla(228, 18%, 15%, 0.6)" strokeWidth="6" />
              <motion.circle
                cx="60" cy="60" r={ringRadius}
                fill="none"
                stroke="url(#ringGradient)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                initial={{ strokeDashoffset: ringCircumference }}
                animate={{ strokeDashoffset: ringOffset }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
              />
              <defs>
                <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="hsl(250 76% 62%)" />
                  <stop offset="100%" stopColor="hsl(190 90% 55%)" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span 
                className="text-xl font-extrabold text-foreground tabular-nums"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5, type: "spring" }}
              >
                {stats.hitRate}%
              </motion.span>
              <span className="text-[8px] text-muted-foreground/55 font-medium">Win Rate</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-0.5 relative z-10">
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground/65">
              <span className="w-1.5 h-1.5 rounded-full bg-nba-green animate-glow-pulse" /> {stats.wins}W
            </span>
            <span className="flex items-center gap-1 text-[9px] text-muted-foreground/65">
              <span className="w-1.5 h-1.5 rounded-full bg-nba-red" /> {stats.losses}L
            </span>
          </div>
        </motion.div>

        {/* Sport Breakdown */}
        <motion.div {...stagger(isNewUser ? 11 : 7)} className="vision-card p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <p className="text-[11px] font-bold text-foreground">Sports</p>
              <p className="text-[8px] text-muted-foreground/55">Distribution</p>
            </div>
            <span className="text-base font-extrabold gradient-text-accent tabular-nums">{Object.keys(stats.sportCounts).length}</span>
          </div>
          {Object.keys(stats.sportCounts).length > 0 ? (
            <div className="space-y-2.5 mt-1">
              {Object.entries(stats.sportCounts).map(([sport, count], i) => (
                <div key={sport}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] font-semibold text-foreground/70 uppercase tracking-wide">{sport}</span>
                    <span className="text-[9px] text-muted-foreground/65 tabular-nums">{count}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'hsla(228, 18%, 15%, 0.6)' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(count / stats.total) * 100}%` }}
                      transition={{ duration: 0.6, delay: 0.2 + i * 0.08 }}
                      className="h-full rounded-full"
                      style={{ background: 'linear-gradient(90deg, hsl(250 76% 62%), hsl(210 100% 60%))' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <Activity className="w-4 h-4 text-muted-foreground/65 mb-1.5" />
              <p className="text-[9px] text-muted-foreground/55">No plays yet</p>
            </div>
          )}
        </motion.div>
      </div>

      {/* ── 7-DAY PERFORMANCE ── */}
      <motion.div {...stagger(isNewUser ? 12 : 8)} className="vision-card p-4 relative overflow-hidden">
        <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full opacity-[0.04] pointer-events-none"
          style={{ background: 'radial-gradient(circle, hsl(158 64% 52%), transparent)' }} />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[hsl(250,76%,62%)] to-[hsl(210,100%,60%)] flex items-center justify-center shadow-lg">
                <Activity className="w-3.5 h-3.5 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-bold text-foreground">Last 7 Days</p>
                <p className="text-[8px] text-muted-foreground/55">Active performance</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: "Plays", value: stats.last7Total, color: "text-foreground", icon: Users },
              { label: "Wins", value: stats.last7Wins, color: "text-nba-green", icon: Trophy },
              { label: "Losses", value: stats.last7Losses, color: "text-nba-red", icon: TrendingDown },
              { label: "ROI", value: `${stats.roi}%`, color: stats.roi >= 0 ? "text-nba-green" : "text-nba-red", icon: Percent },
            ].map((s, i) => (
              <motion.div 
                key={s.label} 
                className="text-center p-2.5 rounded-xl relative overflow-hidden"
                style={{ background: 'hsla(228, 20%, 12%, 0.4)', border: '1px solid hsla(228, 20%, 20%, 0.15)' }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.05 }}
              >
                <s.icon className={`w-3 h-3 mx-auto mb-1 ${s.color} opacity-40`} />
                <motion.p 
                  className={`text-base font-extrabold tabular-nums ${s.color}`}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.5 + i * 0.05, type: "spring" }}
                >
                  {s.value}
                </motion.p>
                <p className="text-[7px] text-muted-foreground/55 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</p>
              </motion.div>
            ))}
          </div>

          <div className="gradient-divider my-3" />

          {/* Best day + streak summary */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-accent/40" />
              <span className="text-[9px] text-muted-foreground/35">
                {stats.bestDay > 0 ? `Best day: +$${stats.bestDay.toFixed(0)}` : stats.last7Total > 0 
                  ? `${Math.round((stats.last7Wins / Math.max(stats.last7Total, 1)) * 100)}% weekly hit rate`
                  : "No plays this week"
                }
              </span>
            </div>
            {stats.streak !== 0 && (
              <span className={`text-[9px] font-bold tabular-nums ${stats.streak > 0 ? "text-nba-green" : "text-nba-red"}`}>
                {Math.abs(stats.streak)} {stats.streak > 0 ? "win" : "loss"} streak
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── QUICK ACCESS — shown at bottom for experienced users ── */}
      {!isNewUser && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2">Quick Access</p>
          <div className="grid grid-cols-4 gap-2">
            {quickLinks.map((link, i) => (
              <motion.button
                key={link.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + i * 0.04, type: "spring", stiffness: 300, damping: 20 }}
                onClick={() => navigate(link.path)}
                whileTap={{ scale: 0.92 }}
                className="vision-card p-3 flex flex-col items-center gap-2 group active:scale-[0.97]"
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${link.gradient} flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all`}
                  style={{ boxShadow: '0 4px 12px -2px hsla(228, 20%, 0%, 0.3)' }}>
                  <link.icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-[9px] font-semibold text-foreground/50">{link.label}</span>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
