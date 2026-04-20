import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame, ChevronRight, Sparkles, CheckCircle2, XCircle,
  BarChart3, Layers, Crosshair, Activity, Trophy, Percent,
  Users, TrendingDown, Zap, DollarSign, Target, RefreshCw
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useParlaySlip } from "@/contexts/ParlaySlipContext";

import { PnLCalendar } from "@/components/PnLCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { searchPlayers } from "@/services/api";
import { AddToSlipSheet } from "@/components/AddToSlipSheet";
import { getTeamLogoUrl } from "@/utils/teamLogos";

interface Play {
  id: string;
  sport: string;
  result: string;
  stake: number;
  odds: number;
  payout: number | null;
  created_at: string;
}

interface DailyPick {
  id: string;
  player_name: string;
  team: string | null;
  opponent: string | null;
  prop_type: string;
  line: number;
  direction: string;
  hit_rate: number;
  odds: string | null;
  reasoning: string | null;
  result: string | null;
  pick_date: string;
  created_at: string;
  sport: string;
  bet_type?: string;
  home_team?: string | null;
  away_team?: string | null;
  spread_line?: number | null;
  total_line?: number | null;
  tier?: string;
}

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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Updated just now";
  return `Updated ${hours}h ago`;
}

function CountUp({ target, duration = 1200 }: { target: number; duration?: number }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0) { setValue(target); return; }
    const steps = 60;
    const interval = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const t = step / steps;
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (step >= steps) { clearInterval(timer); setValue(target); }
    }, interval);
    return () => clearInterval(timer);
  }, [target, duration]);
  return <>{value}%</>;
}

function getConfidenceColor(rate: number): string {
  if (rate >= 75) return '#22c55e';   // green — strong
  if (rate >= 60) return '#22d3ee';   // blue — lean
  if (rate >= 50) return '#f59e0b';   // amber — slight edge
  return '#ef4444';                   // red — pass
}

function getConfidenceLabel(rate: number): string {
  if (rate >= 75) return 'STRONG';
  if (rate >= 60) return 'LEAN';
  if (rate >= 50) return 'SLIGHT EDGE';
  return 'PASS';
}

function ConfidenceRing({ rate }: { rate: number }) {
  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ - (rate / 100) * circ;
  const color = getConfidenceColor(rate);
  return (
    <div className="relative shrink-0" style={{ width: 80, height: 80 }}>
      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#1a1735" strokeWidth="5" />
        <motion.circle
          cx="40" cy="40" r={r}
          fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut", delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold tabular-nums" style={{ fontSize: 18, fontWeight: 700, color }}>
          <CountUp target={Math.round(rate)} />
        </span>
      </div>
    </div>
  );
}

function CarouselWrapper({ children, pickCount }: { children: React.ReactNode; pickCount: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPaused = useRef(false);
  const animRef = useRef<number | null>(null);

  const shouldScroll = pickCount > 1;

  useEffect(() => {
    if (!shouldScroll) return;
    const container = containerRef.current;
    if (!container) return;

    let scrollPos = 0;
    const speed = 0.15;

    const tick = () => {
      if (!isPaused.current) {
        scrollPos += speed;
        if (scrollPos >= container.scrollWidth / 2) {
          scrollPos = 0;
        }
        container.scrollLeft = scrollPos;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    const pause = () => {
      isPaused.current = true;
    };

    const resume = () => {
      setTimeout(() => {
        isPaused.current = false;
      }, 2000);
    };

    container.addEventListener('touchstart', pause);
    container.addEventListener('mousedown', pause);
    window.addEventListener('touchend', resume);
    window.addEventListener('mouseup', resume);

    return () => {
      if (animRef.current !== null) {
        cancelAnimationFrame(animRef.current);
      }
      container.removeEventListener('touchstart', pause);
      container.removeEventListener('mousedown', pause);
      window.removeEventListener('touchend', resume);
      window.removeEventListener('mouseup', resume);
    };
  }, [shouldScroll]);

  if (!shouldScroll) {
    return (
      <div className="w-full overflow-hidden">
        <div className="flex flex-row overflow-hidden hide-scrollbar">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden">
      <div ref={containerRef} className="flex flex-row overflow-hidden hide-scrollbar">
        {children}{children}
      </div>
    </div>
  );
}

interface ModernHomeLayoutProps {
  plays: Play[];
  loading: boolean;
}

export function ModernHomeLayout({ plays, loading }: ModernHomeLayoutProps) {
  const navigate = useNavigate();
  const { addLeg } = useParlaySlip();
  const [slipSheetOpen, setSlipSheetOpen] = useState(false);
  const [slipSheetPick, setSlipSheetPick] = useState<import("@/components/AddToSlipSheet").SlipSheetPick | null>(null);
  
  const { user, profile } = useAuth();
  const [todayPicks, setTodayPicks] = useState<DailyPick[]>([]);
  const [dailyTierPicks, setDailyTierPicks] = useState<DailyPick[]>([]);
  const [yesterdayPicks, setYesterdayPicks] = useState<DailyPick[]>([]);
  const [picksLoading, setPicksLoading] = useState(true);
  const [userSports, setUserSports] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [headshots, setHeadshots] = useState<Record<string, string>>({});
  const [rotatingTip, setRotatingTip] = useState<{ tip: string; focus_area: string } | null>(null);
  const [rotatingTipLoading, setRotatingTipLoading] = useState(true);

  useEffect(() => {
    if (!user) { setRotatingTipLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("rotating-tip");
        if (!cancelled && !error && data?.tip) {
          setRotatingTip({ tip: data.tip, focus_area: data.focus_area });
        }
      } catch (e) {
        console.error("rotating-tip fetch failed", e);
      } finally {
        if (!cancelled) setRotatingTipLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("onboarding_responses")
      .select("sports")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.sports && Array.isArray(data.sports) && data.sports.length > 0) {
          setUserSports(data.sports.map((s: string) => s.toLowerCase()));
        }
      });
  }, [user]);

  const fetchTodayPicks = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    const [todayRes, yesterdayRes] = await Promise.all([
      supabase.from("daily_picks").select("*").eq("pick_date", today).order("hit_rate", { ascending: false }).limit(40),
      supabase.from("daily_picks").select("*").eq("pick_date", yesterday).order("created_at", { ascending: false }),
    ]);

    // hit_rate may be stored as decimal (0.55) or percent (55) — normalize threshold to 55
    const hrOk = (hr: number) => (hr > 1 ? hr >= 55 : hr >= 0.55);
    // Hard odds guard: drop any pick where |odds| >= 500 (longshot junk)
    const oddsOk = (o: string | null | undefined) => {
      if (!o) return true;
      const n = parseInt(String(o).replace(/[^\d-]/g, ""), 10);
      if (Number.isNaN(n)) return true;
      return Math.abs(n) < 500;
    };
    // STRICT: today only. No 3-day stale fallback — show empty state if no picks today.
    const allToday = ((todayRes.data as DailyPick[]) || []).filter(
      p => hrOk(p.hit_rate) && oddsOk(p.odds) && p.tier !== "pass"
    );

    const sortByPref = (arr: DailyPick[]) => {
      if (userSports.length > 0) {
        arr.sort((a, b) => {
          const aMatch = userSports.includes(a.sport?.toLowerCase()) ? 1 : 0;
          const bMatch = userSports.includes(b.sport?.toLowerCase()) ? 1 : 0;
          if (bMatch !== aMatch) return bMatch - aMatch;
          return b.hit_rate - a.hit_rate;
        });
      } else {
        arr.sort((a, b) => b.hit_rate - a.hit_rate);
      }
      return arr;
    };

    // Split by tier — top quality goes to Today's Edge, rest to Daily Picks
    const edgeTier = allToday.filter(p => p.tier === "edge");
    const dailyTier = allToday.filter(p => p.tier !== "edge");

    // STRICT: Today's Edge only shows tier="edge". No fallback to ungraded picks.
    setTodayPicks(sortByPref(edgeTier));
    setDailyTierPicks(sortByPref(dailyTier));
    setYesterdayPicks((yesterdayRes.data as DailyPick[]) || []);
    setPicksLoading(false);
    setLastRefreshed(new Date());
  }, [userSports]);

  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (supabaseUrl && anonKey) {
      fetch(`${supabaseUrl}/functions/v1/grade-picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${anonKey}` },
      }).catch(() => {});
    }

    fetchTodayPicks();

    // Auto-refresh yesterday's results every 60 seconds
    const interval = setInterval(async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const { data } = await supabase.from("daily_picks").select("*").eq("pick_date", yesterday).order("created_at", { ascending: false });
      setYesterdayPicks((data as DailyPick[]) || []);
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchTodayPicks]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("slate-scanner");
      if (error) {
        toast.error("Failed to refresh picks. Try again later.");
      } else {
        const total = data?.counts?.total ?? 0;
        const edge = data?.counts?.todaysEdge ?? 0;
        toast.success(total > 0 ? `${edge} edge picks · ${total} total generated` : "No games available for picks right now.");
      }
      await fetchTodayPicks();
    } catch {
      toast.error("Failed to refresh picks. Try again later.");
    } finally {
      setRefreshing(false);
    }
  }, [fetchTodayPicks]);

  // Fetch player headshots for prop picks only
  useEffect(() => {
    const propPicks = todayPicks.filter(p => !p.bet_type || p.bet_type === 'prop');
    if (propPicks.length === 0) return;
    const uniqueNames = [...new Set(propPicks.map(p => p.player_name))];
    const missing = uniqueNames.filter(n => !headshots[n]);
    if (missing.length === 0) return;

    Promise.allSettled(
      missing.map(name =>
        searchPlayers(name.split(" ")[1] || name, todayPicks.find(p => p.player_name === name)?.sport || "nba")
          .then((results: any[]) => {
            const match = results?.find?.((r: any) =>
              r.name?.toLowerCase() === name.toLowerCase()
            ) || results?.[0];
            return { name, headshot: match?.headshot || "" };
          })
      )
    ).then(results => {
      const map: Record<string, string> = {};
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value.headshot) {
          map[r.value.name] = r.value.headshot;
        }
      });
      if (Object.keys(map).length > 0) {
        setHeadshots(prev => ({ ...prev, ...map }));
      }
    });
  }, [todayPicks]);

  const stats = useMemo(() => {
    const wins = plays.filter(p => p.result === "win").length;
    const losses = plays.filter(p => p.result === "loss").length;
    const total = wins + losses;
    const hitRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const profit = calcProfit(plays);
    const roi = total > 0 ? Math.round((profit / plays.reduce((s, p) => s + p.stake, 0)) * 100) : 0;
    const sportCounts: Record<string, number> = {};
    plays.forEach(p => { sportCounts[p.sport] = (sportCounts[p.sport] || 0) + 1; });
    const streak = (() => {
      let s = 0;
      const sorted = [...plays].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (!sorted.length) return 0;
      const first = sorted[0].result;
      for (const p of sorted) { if (p.result === first) s++; else break; }
      return first === "win" ? s : -s;
    })();
    return { wins, losses, total, hitRate, profit, roi, sportCounts, streak };
  }, [plays]);

  const yesterdayGraded = yesterdayPicks.filter(p => p.result === "hit" || p.result === "miss");
  const yesterdayPending = yesterdayPicks.filter(p => !p.result || (p.result !== "hit" && p.result !== "miss"));
  const yesterdayHits = yesterdayGraded.filter(p => p.result === "hit").length;
  const yesterdayTotal = yesterdayGraded.length;
  const yesterdayAcc = yesterdayTotal > 0 ? Math.round((yesterdayHits / yesterdayTotal) * 100) : 0;
  const hasYesterdayData = yesterdayPicks.length > 0;

  const ringRadius = 52;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (stats.hitRate / 100) * ringCircumference;

  const quickLinks = [
    { label: "Analyze", icon: BarChart3, path: "/dashboard/analyze", gradient: "from-[hsl(142,100%,50%)] to-[hsl(158,64%,52%)]", desc: "Props & Lines" },
    { label: "Picks", icon: Sparkles, path: "/dashboard/picks", gradient: "from-[hsl(30,100%,50%)] to-[hsl(15,100%,55%)]", desc: "Today's picks" },
    { label: "Parlay", icon: Layers, path: "/dashboard/parlay", gradient: "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]", desc: "Build a slip" },
    { label: "Lines", icon: Crosshair, path: "/dashboard/moneyline", gradient: "from-[hsl(190,90%,55%)] to-[hsl(158,64%,52%)]", desc: "Moneylines" },
  ];

  return (
    <div className="relative overflow-x-hidden">
      <style>{`
        @keyframes pulse-fire { 0%,100% { transform: scale(1) } 50% { transform: scale(1.15) } }
        .hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        @keyframes live-glow {
          0%, 100% { box-shadow: 0 0 8px hsl(142 71% 45% / 0.3); }
          50% { box-shadow: 0 0 18px hsl(142 71% 45% / 0.55); }
        }
        @keyframes live-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.7); }
        }
      `}</style>

      

      <div className="w-full max-w-[430px] mx-auto px-5 pt-1 pb-6 space-y-6 relative">
        <div className="vision-orb w-64 h-64 -top-20 -right-20" style={{ background: 'hsl(142 100% 50%)' }} />
        <div className="vision-orb w-48 h-48 top-[400px] -left-16" style={{ background: 'hsl(190 90% 55%)', animationDelay: '-3s' }} />

        <motion.div {...stagger(0)} className="relative z-10">
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
            {getGreeting()}, {profile?.display_name || user?.email?.split("@")[0] || "Player"}
          </h1>
          <div className="mt-1">
            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground/60 tracking-wide"
              style={{
                background: 'hsl(250 30% 8%)',
                border: '1px solid hsl(250 20% 18%)',
                borderRadius: 20,
                padding: '3px 10px',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[hsl(158,64%,52%)] animate-glow-pulse" />
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </span>
          </div>
        </motion.div>

        <motion.div {...stagger(0.5)} className="relative z-10">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/50 mb-2.5">Quick Access</p>
          <div className="grid grid-cols-4 gap-2.5">
            {quickLinks.map((link, i) => (
              <motion.button
                key={link.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.04, type: "spring", stiffness: 300, damping: 22 }}
                onClick={() => navigate(link.path)}
                whileTap={{ scale: 0.92 }}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl active:scale-[0.97] transition-transform"
                style={{
                  background: 'linear-gradient(165deg, hsl(250 20% 13%), hsl(250 22% 9%))',
                  border: '1px solid hsl(250 20% 18% / 0.7)',
                }}
              >
                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${link.gradient} flex items-center justify-center`}
                  style={{ boxShadow: '0 6px 16px -4px hsla(228, 20%, 0%, 0.5)' }}>
                  <link.icon className="w-5 h-5 text-white" />
                </div>
                <div className="text-center">
                  <span className="block text-[11px] font-bold text-foreground/80">{link.label}</span>
                  <span className="block text-[8px] text-muted-foreground/40 mt-0.5">{link.desc}</span>
                </div>
              </motion.button>
            ))}
          </div>
        </motion.div>

        <motion.div {...stagger(1)} className="relative z-10">
          <div className="flex items-center justify-between border-b border-[hsl(250,20%,18%)]/40 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4" style={{ color: 'hsl(142 100% 50%)', animation: 'pulse-fire 3s ease-in-out infinite' }} />
              <span className="text-xs font-bold tracking-[0.15em] uppercase" style={{ color: 'hsl(142 100% 50%)' }}>Today's Edge</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/40">
                Updated {Math.max(1, Math.round((Date.now() - lastRefreshed.getTime()) / 60000))}m ago
              </span>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-1 rounded-md hover:bg-secondary/30 transition-colors disabled:opacity-50"
                title="Refresh picks"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/60 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {picksLoading ? (
            <div className="-mx-5 px-5 overflow-x-auto hide-scrollbar">
              <div className="flex gap-3 pb-2">
                {[0, 1].map(i => (
                  <div key={i} className="w-[85%] max-w-[320px] min-w-0 shrink-0 p-5 animate-pulse space-y-3" style={{
                    background: 'linear-gradient(165deg, hsl(250 20% 12%), hsl(250 22% 9%))',
                    border: '1px solid hsl(250 20% 18% / 0.6)',
                    borderRadius: 20,
                  }}>
                    <div className="w-24 h-4 rounded bg-secondary/40" />
                    <div className="w-16 h-3 rounded bg-secondary/30" />
                    <div className="w-full h-8 rounded bg-secondary/20" />
                  </div>
                ))}
              </div>
            </div>
          ) : todayPicks.length === 0 ? (
            <div className="w-full min-w-0 p-6 text-center" style={{
              background: 'linear-gradient(165deg, hsl(250 20% 12%), hsl(250 22% 9%))',
              border: '1px solid hsl(250 20% 18% / 0.6)',
              borderRadius: 20,
            }}>
              <Sparkles className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[11px] text-muted-foreground/55">No picks generated yet today. Check back soon!</p>
            </div>
          ) : (
            <div className="-mx-5 px-5 overflow-x-auto hide-scrollbar snap-x snap-mandatory">
              <div className="flex gap-3 pb-2">
                {todayPicks.slice(0, 5).map((pick, i) => {
                  const isGameBet = pick.bet_type && pick.bet_type !== 'prop';
                  // Defensive: hit_rate may be decimal (0.76) or percent (76). Normalize to percent.
                  const rawHr = pick.hit_rate ?? 0;
                  const confPercent = rawHr > 1 ? Math.round(rawHr) : Math.round(rawHr * 100);
                  // Hard skip: never render junk in Today's Edge
                  if (confPercent < 55) return null;
                  return (
                  <motion.div
                    key={`${pick.id}-${i}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.06 }}
                    className="w-[85%] max-w-[320px] min-w-0 shrink-0 snap-start flex flex-col relative overflow-hidden"
                    style={{
                      background: 'linear-gradient(165deg, hsl(250 20% 12%), hsl(250 22% 9%))',
                      border: '1px solid hsl(250 20% 18% / 0.6)',
                      borderTop: `2px solid ${isGameBet ? '#22d3ee' : '#7c6ff7'}`,
                      borderRadius: 18,
                      padding: 22,
                      boxShadow: '0 4px 24px -4px rgba(0,0,0,0.4)',
                      gap: 10,
                    }}
                  >

                    <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-[0.06] pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${isGameBet ? 'hsl(190 90% 55%)' : 'hsl(142 100% 50%)'}, transparent)` }} />

                    {/* HEADER ROW */}
                    <div className="relative z-10" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      {/* Left: Image or Sport Icon */}
                      <div style={{
                        width: 52, height: 52, borderRadius: 12, overflow: 'hidden',
                        border: '1px solid #252340', flexShrink: 0,
                        background: '#252340',
                      }}>
                        {isGameBet ? (() => {
                          const sportRaw = (pick.sport || 'nba').toLowerCase();
                          const supported = ['nba', 'mlb', 'nhl', 'nfl'];
                          const sportKey = (supported.includes(sportRaw) ? sportRaw : null) as 'nba' | 'mlb' | 'nhl' | 'nfl' | null;
                          const awayLogo = sportKey ? getTeamLogoUrl(pick.away_team || pick.opponent || '', sportKey) : '';
                          const homeLogo = sportKey ? getTeamLogoUrl(pick.home_team || pick.team || '', sportKey) : '';
                          if (sportKey && (awayLogo || homeLogo)) {
                            return (
                              <div style={{
                                width: '100%', height: '100%',
                                display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center',
                                gap: 3, padding: 4,
                              }}>
                                {awayLogo && (
                                  <img
                                    src={awayLogo}
                                    alt={pick.away_team || ''}
                                    style={{ width: 22, height: 22, objectFit: 'contain' }}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                )}
                                {homeLogo && (
                                  <img
                                    src={homeLogo}
                                    alt={pick.home_team || ''}
                                    style={{ width: 22, height: 22, objectFit: 'contain' }}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                )}
                              </div>
                            );
                          }
                          return (
                            <div style={{
                              width: '100%', height: '100%',
                              display: 'flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              gap: 2,
                            }}>
                              <span style={{ fontSize: 16 }}>
                                {pick.bet_type === 'moneyline' ? '💰' : pick.bet_type === 'spread' ? '📊' : '📈'}
                              </span>
                              <span style={{ fontSize: 8, fontWeight: 700, color: '#22d3ee', letterSpacing: 1 }}>
                                {(pick.bet_type || '').replace('_', '/').toUpperCase()}
                              </span>
                            </div>
                          );
                        })() : (
                          <>
                            {headshots[pick.player_name] ? (
                              <img
                                src={headshots[pick.player_name]}
                                alt={pick.player_name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => {
                                  const el = e.target as HTMLImageElement;
                                  el.style.display = 'none';
                                  const fallback = el.parentElement?.querySelector('.img-fallback') as HTMLElement;
                                  if (fallback) fallback.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div className="img-fallback" style={{
                              display: headshots[pick.player_name] ? 'none' : 'flex',
                              width: '100%', height: '100%',
                              alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 700, color: '#22d3ee',
                            }}>
                              {(pick.sport || 'NBA').toUpperCase()}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Middle: Name + Sport Pill + Matchup */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: isGameBet ? 15 : 17, fontWeight: 700, color: '#f0eeff',
                          lineHeight: 1.2, wordBreak: 'break-word',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}>
                          {isGameBet
                            ? `${pick.away_team || pick.opponent || ''} @ ${pick.home_team || pick.team || ''}`
                            : pick.player_name}
                        </p>
                        <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                          <span style={{
                            display: 'inline-block',
                            background: '#252340', color: '#22d3ee',
                            fontSize: 10, fontWeight: 700, letterSpacing: 1,
                            borderRadius: 20, padding: '2px 8px',
                          }}>{(pick.sport || 'NBA').toUpperCase()}</span>
                          {isGameBet && (
                            <span style={{
                              display: 'inline-block',
                              background: 'hsla(190,90%,55%,0.15)', color: '#22d3ee',
                              fontSize: 10, fontWeight: 700, letterSpacing: 1,
                              borderRadius: 20, padding: '2px 8px',
                              border: '1px solid hsla(190,90%,55%,0.25)',
                            }}>
                              {pick.bet_type === 'moneyline' ? 'ML' : pick.bet_type === 'spread' ? 'SPREAD' : 'O/U'}
                            </span>
                          )}
                        </div>
                        {!isGameBet && (
                          <p style={{
                            fontSize: 12, color: '#8b87b8',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            marginTop: 2,
                          }}>
                            {(() => {
                              const abbrev = (name: string) => {
                                const map: Record<string, string> = {
                                  "Atlanta Hawks":"ATL","Boston Celtics":"BOS","Brooklyn Nets":"BKN","Charlotte Hornets":"CHA","Chicago Bulls":"CHI","Cleveland Cavaliers":"CLE","Dallas Mavericks":"DAL","Denver Nuggets":"DEN","Detroit Pistons":"DET","Golden State Warriors":"GSW","Houston Rockets":"HOU","Indiana Pacers":"IND","Los Angeles Clippers":"LAC","Los Angeles Lakers":"LAL","LA Clippers":"LAC","LA Lakers":"LAL","Memphis Grizzlies":"MEM","Miami Heat":"MIA","Milwaukee Bucks":"MIL","Minnesota Timberwolves":"MIN","New Orleans Pelicans":"NOP","New York Knicks":"NYK","Oklahoma City Thunder":"OKC","Orlando Magic":"ORL","Philadelphia 76ers":"PHI","Phoenix Suns":"PHX","Portland Trail Blazers":"POR","Sacramento Kings":"SAC","San Antonio Spurs":"SAS","Toronto Raptors":"TOR","Utah Jazz":"UTA","Washington Wizards":"WSH",
                                  "Arizona Diamondbacks":"ARI","Atlanta Braves":"ATL","Baltimore Orioles":"BAL","Boston Red Sox":"BOS","Chicago Cubs":"CHC","Chicago White Sox":"CHW","Cincinnati Reds":"CIN","Cleveland Guardians":"CLE","Colorado Rockies":"COL","Detroit Tigers":"DET","Houston Astros":"HOU","Kansas City Royals":"KC","Los Angeles Angels":"LAA","Los Angeles Dodgers":"LAD","Miami Marlins":"MIA","Milwaukee Brewers":"MIL","Minnesota Twins":"MIN","New York Mets":"NYM","New York Yankees":"NYY","Oakland Athletics":"OAK","Athletics":"OAK","Philadelphia Phillies":"PHI","Pittsburgh Pirates":"PIT","San Diego Padres":"SD","San Francisco Giants":"SF","Seattle Mariners":"SEA","St. Louis Cardinals":"STL","Tampa Bay Rays":"TB","Texas Rangers":"TEX","Toronto Blue Jays":"TOR","Washington Nationals":"WSH",
                                  "Anaheim Ducks":"ANA","Boston Bruins":"BOS","Buffalo Sabres":"BUF","Calgary Flames":"CGY","Carolina Hurricanes":"CAR","Chicago Blackhawks":"CHI","Colorado Avalanche":"COL","Columbus Blue Jackets":"CBJ","Dallas Stars":"DAL","Detroit Red Wings":"DET","Edmonton Oilers":"EDM","Florida Panthers":"FLA","Los Angeles Kings":"LAK","Minnesota Wild":"MIN","Montreal Canadiens":"MTL","Nashville Predators":"NSH","New Jersey Devils":"NJD","New York Islanders":"NYI","New York Rangers":"NYR","Ottawa Senators":"OTT","Philadelphia Flyers":"PHI","Pittsburgh Penguins":"PIT","San Jose Sharks":"SJS","Seattle Kraken":"SEA","St. Louis Blues":"STL","Tampa Bay Lightning":"TBL","Toronto Maple Leafs":"TOR","Utah Hockey Club":"UTA","Vancouver Canucks":"VAN","Vegas Golden Knights":"VGK","Washington Capitals":"WSH","Winnipeg Jets":"WPG",
                                };
                                return map[name] || name;
                              };
                              const t = pick.team ? abbrev(pick.team) : "";
                              const o = pick.opponent ? abbrev(pick.opponent) : "";
                              return `${t}${t && o ? " vs " : ""}${o}`;
                            })()}
                          </p>
                        )}
                      </div>

                      {/* Right: Confidence Ring */}
                      <div style={{ width: 80, height: 80, flexShrink: 0 }}>
                        <ConfidenceRing rate={confPercent} />
                      </div>
                    </div>

                    {/* VERDICT BADGE */}
                    {(() => {
                      const label = getConfidenceLabel(confPercent);
                      const ou = pick.bet_type === 'over_under'
                        ? (pick.direction === "over" ? "OVER" : "UNDER")
                        : pick.bet_type === 'moneyline'
                          ? pick.player_name
                          : pick.bet_type === 'spread'
                            ? `${pick.direction === 'home' ? (pick.home_team || pick.team) : (pick.away_team || pick.opponent)} ${pick.spread_line && pick.spread_line > 0 ? '+' : ''}${pick.spread_line}`
                            : (pick.direction === "over" ? "OVER" : "UNDER");
                      const colorMap: Record<string, string> = {
                        'STRONG': '#22c55e', 'LEAN': '#22d3ee', 'SLIGHT EDGE': '#f59e0b', 'PASS': '#ef4444',
                      };
                      const dotColor = colorMap[label] || '#ef4444';
                      const bgColor = dotColor.replace('#', '').match(/.{2}/g)!;
                      const r = parseInt(bgColor[0], 16), g = parseInt(bgColor[1], 16), b = parseInt(bgColor[2], 16);
                      const badgeText = label === 'STRONG' || label === 'LEAN'
                        ? isGameBet ? `${label} ${ou}` : `${label} ${pick.direction === "over" ? "OVER" : "UNDER"}`
                        : label;
                      return (
                        <div className="relative z-10" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: `rgba(${r},${g},${b},0.15)`, border: `1px solid rgba(${r},${g},${b},0.3)`,
                          borderRadius: 20, padding: '4px 12px', alignSelf: 'flex-start',
                        }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
                            color: dotColor, textTransform: 'uppercase',
                          }}>{badgeText}</span>
                        </div>
                      );
                    })()}

                    {/* STAT + ODDS ROW */}
                    <div className="relative z-10" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        background: '#252340', color: '#f0eeff',
                        borderRadius: 20, padding: '6px 14px',
                        fontSize: 13, fontWeight: 600,
                        border: '1px solid #352f60',
                      }}>
                        {isGameBet
                          ? pick.bet_type === 'moneyline'
                            ? `Winner: ${pick.player_name}`
                            : pick.bet_type === 'spread'
                              ? `Spread ${pick.spread_line && pick.spread_line > 0 ? '+' : ''}${pick.spread_line}`
                              : `${pick.direction === "over" ? "Over" : "Under"} ${pick.total_line}`
                          : `${pick.direction === "over" ? "Over" : "Under"} ${pick.line} ${(pick.prop_type || "").replace(/_/g, " ")}`
                        }
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, letterSpacing: 1.5, color: '#555272', textTransform: 'uppercase', fontWeight: 600 }}>ODDS</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#f0eeff' }}>{pick.odds || "—"}</div>
                      </div>
                    </div>

                    {/* AI NARRATIVE */}
                    {pick.reasoning && (
                      <p className="relative z-10" style={{
                        fontStyle: 'italic', fontSize: 12, color: '#8b87b8',
                        lineHeight: 1.6, overflow: 'hidden',
                        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                        marginBottom: 0,
                      }}>
                        {pick.reasoning?.replace(/NaN%/g, 'N/A')}
                      </p>
                    )}

                    {/* BUTTONS */}
                    <div className="relative z-10" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => {
                          const isGameBet = pick.bet_type && pick.bet_type !== 'prop';
                          if (isGameBet) {
                            navigate('/dashboard/moneyline', {
                              state: {
                                autoAnalyze: true,
                                sport: pick.sport,
                                home_team: pick.home_team,
                                away_team: pick.away_team,
                              },
                            });
                          } else {
                            navigate('/dashboard/analyze', {
                              state: {
                                autoAnalyze: true,
                                sport: pick.sport,
                                player: pick.player_name,
                                prop_type: pick.prop_type,
                                line: Number(pick.line),
                                over_under: pick.direction,
                                opponent: pick.opponent || '',
                              },
                            });
                          }
                        }}
                        className="flex items-center justify-center active:opacity-70"
                        style={{
                          flex: 1, height: 42, borderRadius: 10,
                          fontSize: 13, fontWeight: 600,
                          background: '#13112b', border: '1px solid #252340', color: '#8b87b8',
                        }}
                      >
                        See why →
                      </button>
                      <button
                        onClick={() => {
                          setSlipSheetPick({
                            sport: pick.sport.toUpperCase() as "NBA" | "MLB" | "NHL" | "UFC" | "NFL",
                            player: pick.player_name,
                            propType: pick.prop_type,
                            line: String(pick.line),
                            overUnder: pick.direction as "over" | "under",
                            opponent: pick.opponent || "",
                            odds: parseInt(pick.odds || "-110"),
                          });
                          setSlipSheetOpen(true);
                        }}
                        className="flex items-center justify-center active:opacity-80"
                        style={{
                          flex: 1, height: 42, borderRadius: 10,
                          fontSize: 13, fontWeight: 600,
                          background: 'linear-gradient(135deg, #7c6ff7, #22d3ee)', color: '#f0eeff',
                        }}
                      >
                        + Add to Slip
                      </button>
                    </div>
                  </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>

        <motion.div {...stagger(2)} className="relative z-10 w-full min-w-0 overflow-hidden" style={{
          background: 'linear-gradient(165deg, hsl(250 20% 12%), hsl(250 22% 9%))',
          border: '1px solid hsl(250 20% 18% / 0.6)',
          borderRadius: 20,
          padding: 16,
        }}>
          <div className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full opacity-[0.04] pointer-events-none"
            style={{ background: 'radial-gradient(circle, hsl(142 71% 45%), transparent)' }} />
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase mb-3" style={{ color: 'hsl(142 100% 50%)' }}>
            {yesterdayPending.length > 0 ? "Yesterday's Picks" : "Yesterday's Results"}
          </p>
          {hasYesterdayData ? (
            <>
              <div className="space-y-0">
                {yesterdayGraded
                  .slice(0, 10)
                  .map(pick => {
                    const propAbbrev: Record<string, string> = {
                      points: "PTS", rebounds: "REB", assists: "AST",
                      "3-pointers": "3PM", threes: "3PM", steals: "STL",
                      blocks: "BLK", hits: "H", runs: "R", rbi: "RBI", rbis: "RBI",
                      strikeouts: "K", hr: "HR", home_runs: "HR",
                      total_bases: "TB", stolen_bases: "SB",
                      goals: "G", shots_on_goal: "SOG", saves: "SV",
                    };
                    const abbr = propAbbrev[pick.prop_type?.toLowerCase()] || (pick.prop_type || "").replace(/_/g, " ").toUpperCase();
                    const isHit = pick.result === "hit";
                    return (
                      <div key={pick.id} className="flex items-center justify-between py-2.5 last:border-0" style={{ borderBottom: '1px solid hsl(250 20% 18% / 0.4)' }}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isHit ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'hsl(142 71% 45%)' }} />
                          ) : (
                            <XCircle className="w-4 h-4 shrink-0" style={{ color: 'hsl(0 84% 60%)' }} />
                          )}
                          <span className="truncate" style={{ fontSize: 13, fontWeight: 700, color: 'hsl(250 80% 97%)' }}>{pick.player_name}</span>
                        </div>
                        <span className="tabular-nums shrink-0 ml-2" style={{ fontSize: 11, fontWeight: 700, color: isHit ? 'hsl(142 71% 45%)' : 'hsl(0 84% 60%)' }}>
                          {pick.direction === "over" ? "O" : "U"} {pick.line} {abbr} — {isHit ? "HIT" : "MISS"}
                        </span>
                      </div>
                    );
                  })}
                {yesterdayPending.slice(0, 5).map(pick => {
                  const propAbbrev: Record<string, string> = {
                    points: "PTS", rebounds: "REB", assists: "AST",
                    "3-pointers": "3PM", threes: "3PM", steals: "STL",
                    blocks: "BLK", hits: "H", runs: "R", rbi: "RBI", rbis: "RBI",
                    strikeouts: "K", hr: "HR", home_runs: "HR",
                    total_bases: "TB", stolen_bases: "SB",
                    goals: "G", shots_on_goal: "SOG", saves: "SV",
                  };
                  const abbr = propAbbrev[pick.prop_type?.toLowerCase()] || (pick.prop_type || "").replace(/_/g, " ").toUpperCase();
                  return (
                    <div key={pick.id} className="flex items-center justify-between py-2.5 last:border-0" style={{ borderBottom: '1px solid hsl(250 20% 18% / 0.4)' }}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-4 h-4 shrink-0 rounded-full" style={{ border: '2px solid hsl(45 93% 58%)', background: 'transparent' }} />
                        <span className="truncate" style={{ fontSize: 13, fontWeight: 700, color: 'hsl(250 80% 97%)' }}>{pick.player_name}</span>
                      </div>
                      <span className="tabular-nums shrink-0 ml-2" style={{ fontSize: 11, fontWeight: 700, color: 'hsl(45 93% 58%)' }}>
                        {pick.direction === "over" ? "O" : "U"} {pick.line} {abbr} — PENDING
                      </span>
                    </div>
                  );
                })}
              </div>
              {yesterdayTotal > 0 && yesterdayPending.length === 0 ? (
                <p className="text-center mt-3" style={{ fontSize: 12, fontWeight: 700, color: 'hsl(142 71% 45%)' }}>
                  Sentinel went {yesterdayHits}/{yesterdayTotal} yesterday • {yesterdayAcc}% accuracy
                </p>
              ) : yesterdayPending.length > 0 ? (
                <p className="text-center mt-3" style={{ fontSize: 12, fontWeight: 600, color: 'hsl(45 93% 58%)' }}>
                  {yesterdayPending.length} pick{yesterdayPending.length > 1 ? "s" : ""} still pending — games in progress
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex items-center gap-3 py-3 px-2" style={{
              background: 'hsl(250 18% 10%)',
              borderRadius: 14,
            }}>
              <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center" style={{
                background: 'hsl(250 20% 14%)',
                border: '1px solid hsl(250 20% 18% / 0.5)',
              }}>
                <Target className="w-4 h-4 text-muted-foreground/40" />
              </div>
              <div className="min-w-0">
                <p style={{ fontSize: 13, fontWeight: 700, color: 'hsl(250 80% 97%)' }}>Results processing</p>
                <p style={{ fontSize: 11, color: 'hsl(250 15% 50%)', lineHeight: 1.4 }}>Yesterday's picks are being graded — check back shortly.</p>
              </div>
            </div>
          )}
        </motion.div>

        <motion.div {...stagger(2.5)} className="relative z-10 w-full min-w-0" style={{
          background: 'linear-gradient(165deg, hsl(250 20% 12%), hsl(250 22% 9%))',
          border: '1px solid hsl(250 76% 62% / 0.12)',
          borderRadius: 20,
          padding: 16,
        }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" style={{ color: 'hsl(142 100% 50%)' }} />
              <p className="text-[10px] tracking-[0.15em] uppercase font-bold" style={{ color: 'hsl(142 100% 50%)' }}>AI Daily Tip</p>
            </div>
            {rotatingTip?.focus_area && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{
                background: 'hsl(142 100% 50% / 0.12)',
                color: 'hsl(142 100% 50%)',
                border: '1px solid hsl(142 100% 50% / 0.25)',
              }}>{rotatingTip.focus_area}</span>
            )}
          </div>
          {rotatingTipLoading ? (
            <div className="space-y-1.5">
              <div className="h-2.5 rounded animate-pulse" style={{ background: 'hsl(250 18% 18%)', width: '95%' }} />
              <div className="h-2.5 rounded animate-pulse" style={{ background: 'hsl(250 18% 18%)', width: '70%' }} />
            </div>
          ) : (
            <p style={{ fontSize: 12, color: 'hsl(250 20% 62%)', lineHeight: 1.55 }}>
              {rotatingTip?.tip ?? "Prime-time props with 65%+ hit rates are today's strongest edges. Check the Parlay Builder for correlated plays."}
            </p>
          )}
        </motion.div>

        <div className="grid grid-cols-2 gap-3">
          <motion.div {...stagger(3)} className="vision-card p-3.5 flex flex-col items-center justify-center relative overflow-hidden min-w-0" style={{ borderRadius: 20 }}>
            <div className="vision-orb w-20 h-20 top-0 left-0" style={{ background: 'hsl(142 100% 50%)', animationDelay: '-2s' }} />
            <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-1 relative z-10">Performance</p>
            <div className="relative w-24 h-24 my-1">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r={ringRadius} fill="none" stroke="hsla(228, 18%, 15%, 0.6)" strokeWidth="6" />
                <motion.circle
                  cx="60" cy="60" r={ringRadius}
                  fill="none" stroke="url(#ringGradientModern)" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  initial={{ strokeDashoffset: ringCircumference }}
                  animate={{ strokeDashoffset: ringOffset }}
                  transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
                />
                <defs>
                  <linearGradient id="ringGradientModern" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="hsl(142 100% 50%)" />
                    <stop offset="100%" stopColor="hsl(190 90% 55%)" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.span className="text-xl font-extrabold text-foreground tabular-nums"
                  initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5, type: "spring" }}
                >
                  {stats.hitRate}%
                </motion.span>
                <span className="text-[8px] text-muted-foreground/55 font-medium">Win Rate</span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-0.5 relative z-10">
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground/65">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(142,71%,45%)] animate-glow-pulse" /> {stats.wins}W
              </span>
              <span className="flex items-center gap-1 text-[9px] text-muted-foreground/65">
                <span className="w-1.5 h-1.5 rounded-full bg-[hsl(0,84%,60%)]" /> {stats.losses}L
              </span>
            </div>
          </motion.div>

          <motion.div {...stagger(4)} className="vision-card p-3.5 min-w-0" style={{ borderRadius: 20 }}>
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
                        style={{ background: 'linear-gradient(90deg, hsl(142 100% 50%), hsl(158 64% 52%))' }}
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

        <PnLCalendar plays={plays} />

      </div>
      <AddToSlipSheet open={slipSheetOpen} onOpenChange={setSlipSheetOpen} pick={slipSheetPick} />
    </div>
  );
}
