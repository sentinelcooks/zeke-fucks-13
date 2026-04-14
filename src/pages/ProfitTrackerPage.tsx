import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Trash2, TrendingUp, TrendingDown, DollarSign, Download, X,
  Target, Shield, Hand, Crosshair, Zap, CheckCircle2, XCircle, Clock,
  Trophy, Calendar, Layers, Filter,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import ProfitCharts from "@/components/ProfitCharts";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { PlayerAutocomplete, getLinePlaceholder } from "@/components/tracker/PlayerAutocomplete";
import { BetTypeDropdown } from "@/components/tracker/BetTypeDropdown";
import { ParlayPlayForm } from "@/components/tracker/ParlayPlayForm";
import { americanToDecimal } from "@/utils/oddsFormat";

/* ── Types ── */
interface Play {
  id: string; sport: string; player_or_fighter: string; bet_type: string;
  line: number | null; odds: number; stake: number; result: string;
  payout: number; notes: string | null; created_at: string;
}

interface SavedPick {
  id: string; license_key: string; pick_id: string | null; player_name: string;
  sport: string; prop_type: string; line: number; direction: string;
  hit_rate: number; odds: string | null; reasoning: string | null;
  result: string | null; pick_date: string; saved_at: string;
}

interface SavedParlay {
  id: string; stake: number; parlay_odds: number; potential_payout: number;
  profit: number; overall_confidence: number; overall_grade: string;
  overall_writeup: string | null; unit_sizing: string | null;
  legs: any[]; result: string; created_at: string;
}

/* ── Helpers ── */
function calcPayout(stake: number, odds: number): number {
  if (odds > 0) return stake * (odds / 100);
  return stake * (100 / Math.abs(odds));
}

const PROP_ICONS: Record<string, typeof Target> = {
  points: Target, rebounds: Shield, assists: Hand,
  "3-pointers": Crosshair, steals: Zap, blocks: Shield,
};

const RESULT_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string; bg: string }> = {
  win: { icon: CheckCircle2, color: "text-nba-green", label: "HIT", bg: "bg-nba-green/10 border-nba-green/20" },
  loss: { icon: XCircle, color: "text-nba-red", label: "MISS", bg: "bg-nba-red/10 border-nba-red/20" },
  push: { icon: Clock, color: "text-muted-foreground", label: "PUSH", bg: "bg-secondary border-border" },
  pending: { icon: Clock, color: "text-nba-yellow", label: "PENDING", bg: "bg-nba-yellow/10 border-nba-yellow/20" },
};

type TrackerTab = "plays" | "picks" | "parlays";
type ResultFilter = "all" | "win" | "loss" | "pending";
type SportFilter = "all" | "nba" | "mlb" | "nhl" | "ufc";

/* ── Vision-styled input ── */
function VisionInput({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">{label}</label>
      <input {...props}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none transition-all duration-300 focus:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]"
        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}
      />
    </div>
  );
}

function VisionSelect({ label, children, ...props }: { label: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div>
      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-1.5">{label}</label>
      <select {...props}
        className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground outline-none transition-all duration-300 appearance-none"
        style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}
      >{children}</select>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
/* ── Parse leg pick string ── */
function parseLegPick(pick: string): { player: string; over_under: string; line: number; prop_type: string } | null {
  const match = pick.match(/^(.+?)\s+(OVER|UNDER)\s+([\d.]+)\s+(.+)$/i);
  if (!match) return null;
  return { player: match[1].trim(), over_under: match[2].toLowerCase(), line: parseFloat(match[3]), prop_type: match[4].trim().toLowerCase() };
}

   ══════════════════════════════════════════════════════════════ */
const ProfitTrackerPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { fmt, oddsFormat } = useOddsFormat();
  const licenseKey = user?.id || "default";

  const [tab, setTab] = useState<TrackerTab>("plays");

  // ── Plays state ──
  const [plays, setPlays] = useState<Play[]>([]);
  const [playsLoading, setPlaysLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showParlayForm, setShowParlayForm] = useState(false);
  const defaultOdds = oddsFormat === "decimal" ? "1.91" : "-110";
  const [form, setForm] = useState({ sport: "nba", player_or_fighter: "", bet_type: "", line: "", odds: defaultOdds, stake: "" });
  const [playsResultFilter, setPlaysResultFilter] = useState<ResultFilter>("all");
  const [playsSportFilter, setPlaysSportFilter] = useState<SportFilter>("all");
  const [playsDateFilter, setPlaysDateFilter] = useState<string>("all");
  const [playsSearch, setPlaysSearch] = useState("");

  // ── Picks state ──
  const [picks, setPicks] = useState<SavedPick[]>([]);
  const [picksLoading, setPicksLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [sportFilter, setSportFilter] = useState<SportFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [picksDateFilter, setPicksDateFilter] = useState<string>("all");

  // ── Parlays state ──
  const [parlays, setParlays] = useState<SavedParlay[]>([]);

  /* ── Fetch Functions ── */
  const fetchPlays = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("plays").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setPlays((data as Play[]) || []);
    setPlaysLoading(false);
  }, [user]);

  const fetchPicksAndParlays = useCallback(async () => {
    if (!user) return;
    setPicksLoading(true);
    const { data } = await supabase.from("pick_history").select("*").eq("license_key", licenseKey).order("pick_date", { ascending: false });
    setPicks((data as SavedPick[]) || []);

    const { data: parlayData } = await supabase.from("parlay_history" as any).select("*").order("created_at", { ascending: false });
    const parsed = ((parlayData as any[]) || []).map((p: any) => ({ ...p, legs: typeof p.legs === "string" ? JSON.parse(p.legs) : p.legs }));
    setParlays(parsed);
    setPicksLoading(false);
  }, [user, licenseKey]);

  useEffect(() => { fetchPlays(); fetchPicksAndParlays(); }, [fetchPlays, fetchPicksAndParlays]);

  /* ── Play CRUD ── */
  const addPlay = async () => {
    if (!form.player_or_fighter || !form.bet_type || !form.stake || !user) return;
    let odds: number;
    if (oddsFormat === "decimal") {
      const dec = parseFloat(form.odds) || 1.91;
      odds = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
    } else {
      odds = parseInt(form.odds) || -110;
    }
    const stake = parseFloat(form.stake) || 0;
    await supabase.from("plays").insert({
      user_id: user.id, license_key: user.id, sport: form.sport,
      player_or_fighter: form.player_or_fighter, bet_type: form.bet_type,
      line: form.line ? parseFloat(form.line) : null, odds, stake, result: "pending", payout: 0,
    });
    setForm({ sport: "nba", player_or_fighter: "", bet_type: "", line: "", odds: defaultOdds, stake: "" });
    setShowForm(false); fetchPlays();
  };

  const addParlayPlay = async (legs: any[], stake: number, combinedOdds: number) => {
    if (!user) return;
    const potential = stake * americanToDecimal(combinedOdds);
    const legData = legs.map((l, i) => ({
      sport: l.sport.toUpperCase(),
      pick: `${l.player} - ${l.betType}`,
      confidence: 0,
      grade: "lean",
    }));
    await supabase.from("parlay_history" as any).insert({
      user_id: user.id, stake, parlay_odds: combinedOdds,
      potential_payout: parseFloat(potential.toFixed(2)),
      legs: legData, result: "pending", profit: 0,
      overall_confidence: 0, overall_grade: "lean",
    } as any);
    setShowParlayForm(false);
    fetchPicksAndParlays();
  };

  const updatePlayResult = async (id: string, result: string) => {
    const play = plays.find((p) => p.id === id);
    if (!play || !user) return;
    const payout = result === "win" ? calcPayout(play.stake, play.odds) : result === "push" ? 0 : -play.stake;
    await supabase.from("plays").update({ result, payout }).eq("id", id);

    // Auto-save settled single bets to pick_history
    if (result === "win" || result === "loss") {
      await supabase.from("pick_history").insert({
        user_id: user.id,
        license_key: user.id,
        player_name: play.player_or_fighter,
        sport: play.sport,
        prop_type: play.bet_type,
        line: play.line ?? 0,
        direction: "over",
        hit_rate: 0,
        odds: String(play.odds),
        result,
        pick_date: new Date(play.created_at).toISOString().split("T")[0],
      });
    }

    fetchPlays();
    fetchPicksAndParlays();
  };

  const deletePlay = async (id: string) => {
    await supabase.from("plays").delete().eq("id", id);
    fetchPlays();
  };

  /* ── Pick/Parlay CRUD ── */
  const removePick = async (id: string) => {
    await supabase.from("pick_history").delete().eq("id", id);
    setPicks((prev) => prev.filter((p) => p.id !== id));
  };

  const removeParlay = async (id: string) => {
    await supabase.from("parlay_history" as any).delete().eq("id", id);
    setParlays((prev) => prev.filter((p) => p.id !== id));
  };

  const updateParlayResult = async (id: string, result: string) => {
    await supabase.from("parlay_history" as any).update({ result } as any).eq("id", id);
    setParlays((prev) => prev.map((p) => p.id === id ? { ...p, result } : p));
  };

  /* ── Stats ── */
  const playStats = useMemo(() => {
    const settled = plays.filter((p) => p.result !== "pending");
    const wins = settled.filter((p) => p.result === "win").length;
    const totalProfit = settled.reduce((sum, p) => sum + (p.payout || 0), 0);
    const totalStaked = settled.reduce((sum, p) => sum + p.stake, 0);
    const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0;
    return { wins, losses: settled.length - wins, totalProfit, roi, pending: plays.length - settled.length };
  }, [plays]);

  const pickStats = useMemo(() => {
    const wins = picks.filter((p) => p.result === "win").length;
    const losses = picks.filter((p) => p.result === "loss").length;
    const pending = picks.filter((p) => p.result === "pending" || !p.result).length;
    const settled = wins + losses;
    const winRate = settled > 0 ? Math.round((wins / settled) * 100) : 0;
    // Streak
    const settledPicks = picks.filter((p) => p.result === "win" || p.result === "loss")
      .sort((a, b) => new Date(b.pick_date).getTime() - new Date(a.pick_date).getTime());
    let streak = 0; let streakType = "";
    for (const p of settledPicks) {
      if (!streakType) { streakType = p.result!; streak = 1; }
      else if (p.result === streakType) streak++;
      else break;
    }
    return { total: picks.length, wins, losses, pending, winRate, streak, streakType };
  }, [picks]);

  const parlayStats = useMemo(() => {
    const wins = parlays.filter(p => p.result === "win").length;
    const losses = parlays.filter(p => p.result === "loss").length;
    const pending = parlays.filter(p => p.result === "pending").length;
    const settled = wins + losses;
    const winRate = settled > 0 ? Math.round((wins / settled) * 100) : 0;
    return { total: parlays.length, wins, losses, pending, winRate };
  }, [parlays]);

  /* ── Filtered plays ── */
  const playsDates = useMemo(() => {
    const dates = [...new Set(plays.map(p => new Date(p.created_at).toISOString().split("T")[0]))].sort((a, b) => b.localeCompare(a));
    return dates;
  }, [plays]);

  const filteredPlays = useMemo(() => {
    let result = [...plays];
    if (playsResultFilter !== "all") result = result.filter(p => p.result === playsResultFilter);
    if (playsSportFilter !== "all") result = result.filter(p => p.sport === playsSportFilter);
    if (playsDateFilter !== "all") result = result.filter(p => new Date(p.created_at).toISOString().split("T")[0] === playsDateFilter);
    if (playsSearch) { const q = playsSearch.toLowerCase(); result = result.filter(p => p.player_or_fighter.toLowerCase().includes(q)); }
    return result;
  }, [plays, playsResultFilter, playsSportFilter, playsDateFilter, playsSearch]);

  /* ── Filtered picks ── */
  const picksDates = useMemo(() => {
    const dates = [...new Set(picks.map(p => p.pick_date))].sort((a, b) => b.localeCompare(a));
    return dates;
  }, [picks]);

  const filteredPicks = useMemo(() => {
    let result = [...picks];
    if (resultFilter !== "all") result = result.filter((p) => p.result === resultFilter);
    if (sportFilter !== "all") result = result.filter((p) => p.sport === sportFilter);
    if (picksDateFilter !== "all") result = result.filter((p) => p.pick_date === picksDateFilter);
    if (searchQuery) { const q = searchQuery.toLowerCase(); result = result.filter((p) => p.player_name.toLowerCase().includes(q)); }
    return result;
  }, [picks, resultFilter, sportFilter, picksDateFilter, searchQuery]);

  // Group by date
  const groupedPicks = useMemo(() => {
    const map: Record<string, SavedPick[]> = {};
    for (const p of filteredPicks) { const date = p.pick_date; if (!map[date]) map[date] = []; map[date].push(p); }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredPicks]);

  const exportToCSV = () => {
    const headers = ["Date", "Sport", "Player", "Bet", "Odds", "Stake", "Result", "P/L"];
    const csvRows = [headers.join(",")];
    for (const p of plays) {
      csvRows.push([new Date(p.created_at).toLocaleDateString(), p.sport.toUpperCase(),
        `"${p.player_or_fighter.replace(/"/g, '""')}"`, `"${p.bet_type}${p.line ? ` (${p.line})` : ""}"`,
        fmt(p.odds), p.stake, p.result, p.result === "pending" ? "" : (p.payout || 0).toFixed(2)].join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "profit-tracker.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const tabs: { key: TrackerTab; label: string; icon: typeof DollarSign; count?: number }[] = [
    { key: "plays", label: "Plays", icon: DollarSign },
    { key: "picks", label: "Picks", icon: Target, count: picks.length || undefined },
    { key: "parlays", label: "Parlays", icon: Layers, count: parlays.length || undefined },
  ];

  return (
    <div className="flex flex-col min-h-full relative">
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(250 76% 62%)' }} />
      <div className="vision-orb w-36 h-36 top-[600px] -left-12" style={{ background: 'hsl(145 60% 45%)', animationDelay: '-4s' }} />

      <MobileHeader title="Profit Tracker" subtitle="Track plays, picks & parlays" />

      <div className="px-4 pt-4 pb-32 space-y-3 relative z-10">

        {/* ── Tab Selector ── */}
        <div className="flex gap-1 p-1 rounded-2xl" style={{ background: 'hsl(var(--secondary))' }}>
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-semibold tracking-wide transition-all ${
                tab === key ? "text-accent-foreground" : "text-muted-foreground"
              }`}>
              {tab === key && (
                <motion.div layoutId="tracker-tab-bg" className="absolute inset-0 rounded-xl"
                  style={{ background: 'linear-gradient(135deg, hsl(var(--accent)), hsl(210 100% 60%))' }}
                  transition={{ type: "spring", stiffness: 400, damping: 28 }} />
              )}
              <Icon className="relative z-10 w-3.5 h-3.5" />
              <span className="relative z-10">{label}</span>
              {count && count > 0 && (
                <span className="relative z-10 text-[8px] px-1.5 py-0.5 rounded-full bg-white/20 font-bold">{count}</span>
              )}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ═══════════════ PLAYS TAB ═══════════════ */}
          {tab === "plays" && (
            <motion.div key="plays" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-3">
              {/* Stats — Dashboard-style cards */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    icon: DollarSign, label: "Profit", value: `$${playStats.totalProfit.toFixed(2)}`,
                    gradient: playStats.totalProfit >= 0 ? "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]" : "from-[hsl(0,72%,51%)] to-[hsl(340,65%,47%)]",
                    glow: playStats.totalProfit >= 0 ? "hsla(158,64%,52%,0.15)" : "hsla(0,72%,51%,0.15)",
                    sub: playStats.totalProfit >= 0 ? "in profit" : "down",
                  },
                  {
                    icon: TrendingUp, label: "ROI", value: `${playStats.roi.toFixed(1)}%`,
                    gradient: playStats.roi >= 0 ? "from-[hsl(190,90%,55%)] to-[hsl(210,100%,60%)]" : "from-[hsl(0,72%,51%)] to-[hsl(340,65%,47%)]",
                    glow: playStats.roi >= 0 ? "hsla(190,90%,55%,0.15)" : "hsla(0,72%,51%,0.15)",
                    sub: `${playStats.roi >= 0 ? "+" : ""}${playStats.roi.toFixed(1)}%`,
                  },
                  {
                    icon: Trophy, label: "Record", value: `${playStats.wins}W – ${playStats.losses}L`,
                    gradient: "from-[hsl(250,76%,62%)] to-[hsl(280,70%,55%)]",
                    glow: "hsla(250,76%,62%,0.15)",
                    sub: `${plays.length} total`,
                  },
                  {
                    icon: Clock, label: "Pending", value: playStats.pending,
                    gradient: "from-[hsl(43,96%,56%)] to-[hsl(30,90%,50%)]",
                    glow: "hsla(43,96%,56%,0.15)",
                    sub: "unsettled",
                  },
                ].map((s, i) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, y: 20, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: i * 0.07, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="vision-card-animated p-4 group cursor-default"
                    whileHover={{ scale: 1.02, y: -2 }}
                  >
                    <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-[0.06] pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${s.glow.replace('0.15', '1')}, transparent)` }} />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-3">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg transition-all group-hover:shadow-xl group-hover:scale-105`}
                          style={{ boxShadow: `0 4px 14px -2px ${s.glow}` }}>
                          <s.icon className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-[8px] font-bold px-2 py-0.5 rounded-md text-muted-foreground/65 uppercase tracking-wider"
                          style={{ background: 'hsla(228, 20%, 15%, 0.5)' }}>{s.sub}</span>
                      </div>
                      <p className="text-2xl font-extrabold text-foreground tabular-nums tracking-tight">
                        <motion.span key={String(s.value)} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                          {s.value}
                        </motion.span>
                      </p>
                      <p className="text-[10px] text-muted-foreground/65 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Charts */}
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                <ProfitCharts plays={plays} />
              </motion.div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => { setShowForm(!showForm); setShowParlayForm(false); }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[12px] font-bold tracking-wider text-accent-foreground"
                  style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.3)' }}>
                  {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {showForm ? "Cancel" : "Add Play"}
                </motion.button>
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => { setShowParlayForm(!showParlayForm); setShowForm(false); }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[12px] font-bold tracking-wider"
                  style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(250, 76%, 62%, 0.3)', color: showParlayForm ? 'hsl(0 72% 51%)' : 'hsl(250 76% 62%)' }}>
                  {showParlayForm ? <X className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                  {showParlayForm ? "Cancel" : "Add Parlay"}
                </motion.button>
                {plays.length > 0 && (
                  <motion.button whileTap={{ scale: 0.95 }} onClick={exportToCSV}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[12px] font-bold tracking-wider text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                    style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                    <Download className="w-4 h-4" />
                  </motion.button>
                )}
              </div>

              {/* Add Single Play Form */}
              <AnimatePresence>
                {showForm && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }} className="overflow-hidden">
                    <div className="vision-card p-4 space-y-3">
                      <div className="flex items-center gap-2.5 mb-1">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.25)' }}>
                          <Plus className="w-3.5 h-3.5 text-white" />
                        </div>
                        <span className="text-[13px] font-bold text-foreground">New Play</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <VisionSelect label="Sport" value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value, bet_type: "", player_or_fighter: "" })}>
                          <option value="nba">NBA</option><option value="mlb">MLB</option><option value="nhl">NHL</option>
                          <option value="ufc">UFC</option><option value="other">Other</option>
                        </VisionSelect>
                        <PlayerAutocomplete sport={form.sport} value={form.player_or_fighter} onChange={(v) => setForm({ ...form, player_or_fighter: v })} />
                        <BetTypeDropdown sport={form.sport} value={form.bet_type} onChange={(v) => setForm({ ...form, bet_type: v })} />
                        <VisionInput label="Line" placeholder={getLinePlaceholder(form.sport)} type="number" step="0.5" value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} />
                        <VisionInput label={`Odds (${oddsFormat === "decimal" ? "Decimal" : "American"})`} type="number" value={form.odds}
                          onChange={(e) => setForm({ ...form, odds: e.target.value })}
                          step={oddsFormat === "decimal" ? "0.01" : "1"} />
                        <VisionInput label="Stake ($)" placeholder="10" type="number" value={form.stake} onChange={(e) => setForm({ ...form, stake: e.target.value })} />
                      </div>
                      <motion.button whileTap={{ scale: 0.95 }} onClick={addPlay}
                        className="w-full py-3 rounded-xl text-[12px] font-bold tracking-wider text-accent-foreground"
                        style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.3)' }}>
                        Save Play
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Add Parlay Form */}
              <AnimatePresence>
                {showParlayForm && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }} className="overflow-hidden">
                    <ParlayPlayForm onSave={addParlayPlay} onCancel={() => setShowParlayForm(false)} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Plays Filters */}
              <div className="vision-card p-3 space-y-2">
                <input type="text" placeholder="Search player..." value={playsSearch} onChange={(e) => setPlaysSearch(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none"
                  style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }} />
                <div className="flex items-center gap-1 flex-wrap">
                  <Filter className="w-3 h-3 text-muted-foreground/50" />
                  {(["all", "win", "loss", "pending"] as ResultFilter[]).map((f) => (
                    <button key={f} onClick={() => setPlaysResultFilter(f)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                        playsResultFilter === f ? "bg-accent/15 text-accent" : "text-muted-foreground/60 hover:text-foreground/80"
                      }`}>{f === "all" ? "All" : f === "win" ? "Wins" : f === "loss" ? "Losses" : "Pending"}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {(["all", "nba", "mlb", "nhl", "ufc"] as SportFilter[]).map((f) => (
                    <button key={f} onClick={() => setPlaysSportFilter(f)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                        playsSportFilter === f ? "bg-accent/15 text-accent" : "text-muted-foreground/60 hover:text-foreground/80"
                      }`}>{f === "all" ? "All Sports" : f.toUpperCase()}</button>
                  ))}
                </div>
                {playsDates.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-muted-foreground/50" />
                    <select value={playsDateFilter} onChange={(e) => setPlaysDateFilter(e.target.value)}
                      className="flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-foreground outline-none appearance-none"
                      style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                      <option value="all">All Dates</option>
                      {playsDates.map(d => (
                        <option key={d} value={d}>{new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Plays List */}
              <div className="space-y-2">
                {playsLoading ? (
                  <div className="flex justify-center py-16">
                    <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid hsla(228,30%,20%,0.3)', borderTopColor: 'hsl(250 76% 62%)' }} />
                  </div>
                ) : filteredPlays.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="vision-card p-8 text-center">
                    <DollarSign className="w-8 h-8 mx-auto mb-3 text-muted-foreground/45" />
                    <p className="text-[13px] text-muted-foreground/65 font-medium">{plays.length === 0 ? "No plays yet" : "No plays match filters"}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-1">{plays.length === 0 ? 'Tap "Add Play" to start tracking' : "Try adjusting your filters"}</p>
                  </motion.div>
                ) : filteredPlays.map((p, i) => (
                  <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="vision-card p-4 relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{
                      background: p.result === "win" ? 'hsl(145 60% 45%)' : p.result === "loss" ? 'hsl(0 72% 51%)' : 'hsl(250 76% 62%)',
                    }} />
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-bold uppercase tracking-[0.15em] px-1.5 py-0.5 rounded-md text-muted-foreground/50"
                            style={{ background: 'hsla(228, 20%, 15%, 0.5)', border: '1px solid hsla(228, 20%, 22%, 0.3)' }}>
                            {p.sport.toUpperCase()}
                          </span>
                          <span className="text-[9px] text-muted-foreground/55">{new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[13px] font-bold text-foreground truncate">{p.player_or_fighter}</p>
                        <p className="text-[11px] text-muted-foreground/50 mt-0.5">{p.bet_type}{p.line ? ` (${p.line})` : ""} · {fmt(p.odds)} · ${p.stake}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-3">
                        {p.result === "pending" ? (
                          <div className="flex gap-1">
                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => updatePlayResult(p.id, "win")}
                              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-white" style={{ background: 'hsl(145 60% 45%)' }}>W</motion.button>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => updatePlayResult(p.id, "loss")}
                              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-white" style={{ background: 'hsl(0 72% 51%)' }}>L</motion.button>
                            <motion.button whileTap={{ scale: 0.9 }} onClick={() => updatePlayResult(p.id, "push")}
                              className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-muted-foreground"
                              style={{ background: 'hsla(228, 20%, 15%, 0.5)', border: '1px solid hsla(228, 20%, 22%, 0.3)' }}>P</motion.button>
                          </div>
                        ) : (
                          <div className="text-right">
                            <span className={`block text-[10px] font-bold uppercase tracking-wider ${
                              p.result === "win" ? "text-nba-green" : p.result === "loss" ? "text-nba-red" : "text-muted-foreground/50"
                            }`}>{p.result}</span>
                            <span className={`block text-[14px] font-black tabular-nums ${(p.payout || 0) >= 0 ? "text-nba-green" : "text-nba-red"}`}>
                              {(p.payout || 0) >= 0 ? "+" : ""}${Math.abs(p.payout || 0).toFixed(2)}
                            </span>
                          </div>
                        )}
                        <motion.button whileTap={{ scale: 0.9 }} onClick={() => deletePlay(p.id)}
                          className="p-1.5 rounded-lg text-muted-foreground/45 hover:text-nba-red transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </motion.button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ═══════════════ PICKS TAB ═══════════════ */}
          {tab === "picks" && (
            <motion.div key="picks" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              {/* Stats — Dashboard-style */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: CheckCircle2, label: "Hits", value: pickStats.wins, gradient: "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]", glow: "hsla(158,64%,52%,0.15)", sub: "wins" },
                  { icon: XCircle, label: "Misses", value: pickStats.losses, gradient: "from-[hsl(0,72%,51%)] to-[hsl(340,65%,47%)]", glow: "hsla(0,72%,51%,0.15)", sub: "losses" },
                  { icon: Target, label: "Win Rate", value: `${pickStats.winRate}%`, gradient: pickStats.winRate >= 50 ? "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]" : "from-[hsl(0,72%,51%)] to-[hsl(340,65%,47%)]", glow: pickStats.winRate >= 50 ? "hsla(158,64%,52%,0.15)" : "hsla(0,72%,51%,0.15)", sub: pickStats.winRate >= 55 ? "above avg" : "tracking" },
                ].map((s, i) => (
                  <motion.div key={s.label} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: i * 0.07, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="vision-card-animated p-3.5 group cursor-default" whileHover={{ scale: 1.02, y: -2 }}>
                    <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-[0.06] pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${s.glow.replace('0.15', '1')}, transparent)` }} />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg`}
                          style={{ boxShadow: `0 4px 14px -2px ${s.glow}` }}>
                          <s.icon className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-md text-muted-foreground/65 uppercase tracking-wider"
                          style={{ background: 'hsla(228, 20%, 15%, 0.5)' }}>{s.sub}</span>
                      </div>
                      <p className="text-xl font-extrabold text-foreground tabular-nums tracking-tight">{s.value}</p>
                      <p className="text-[9px] text-muted-foreground/65 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Layers, label: "Total", value: pickStats.total, gradient: "from-[hsl(250,76%,62%)] to-[hsl(280,70%,55%)]", glow: "hsla(250,76%,62%,0.15)", sub: "all time" },
                  { icon: Clock, label: "Pending", value: pickStats.pending, gradient: "from-[hsl(43,96%,56%)] to-[hsl(30,90%,50%)]", glow: "hsla(43,96%,56%,0.15)", sub: "unsettled" },
                  { icon: Zap, label: "Streak", value: pickStats.streak > 0 ? `${pickStats.streak}W` : pickStats.streakType === "loss" ? `${pickStats.streak}L` : "--", gradient: pickStats.streakType === "win" ? "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]" : "from-[hsl(190,90%,55%)] to-[hsl(210,100%,60%)]", glow: "hsla(190,90%,55%,0.15)", sub: pickStats.streakType || "none" },
                ].map((s, i) => (
                  <motion.div key={s.label} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: (i + 3) * 0.07, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="vision-card-animated p-3.5 group cursor-default" whileHover={{ scale: 1.02, y: -2 }}>
                    <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-[0.06] pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${s.glow.replace('0.15', '1')}, transparent)` }} />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2">
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg`}
                          style={{ boxShadow: `0 4px 14px -2px ${s.glow}` }}>
                          <s.icon className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-[7px] font-bold px-1.5 py-0.5 rounded-md text-muted-foreground/65 uppercase tracking-wider"
                          style={{ background: 'hsla(228, 20%, 15%, 0.5)' }}>{s.sub}</span>
                      </div>
                      <p className="text-xl font-extrabold text-foreground tabular-nums tracking-tight">{s.value}</p>
                      <p className="text-[9px] text-muted-foreground/65 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Filters */}
              <div className="vision-card p-3 space-y-2">
                <input type="text" placeholder="Search player..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none"
                  style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }} />
                <div className="flex items-center gap-1 flex-wrap">
                  <Filter className="w-3 h-3 text-muted-foreground/50" />
                  {(["all", "win", "loss", "pending"] as ResultFilter[]).map((f) => (
                    <button key={f} onClick={() => setResultFilter(f)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                        resultFilter === f ? "bg-accent/15 text-accent" : "text-muted-foreground/60 hover:text-foreground/80"
                      }`}>{f === "all" ? "All" : f === "win" ? "Hits" : f === "loss" ? "Misses" : "Pending"}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {(["all", "nba", "mlb", "nhl", "ufc"] as SportFilter[]).map((f) => (
                    <button key={f} onClick={() => setSportFilter(f)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                        sportFilter === f ? "bg-accent/15 text-accent" : "text-muted-foreground/60 hover:text-foreground/80"
                      }`}>{f === "all" ? "All Sports" : f.toUpperCase()}</button>
                  ))}
                </div>
                {picksDates.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-muted-foreground/50" />
                    <select value={picksDateFilter} onChange={(e) => setPicksDateFilter(e.target.value)}
                      className="flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-foreground outline-none appearance-none"
                      style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
                      <option value="all">All Dates</option>
                      {picksDates.map(d => (
                        <option key={d} value={d}>{new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Pick Cards */}
              {picksLoading ? (
                <div className="flex justify-center py-16">
                  <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid hsla(228,30%,20%,0.3)', borderTopColor: 'hsl(250 76% 62%)' }} />
                </div>
              ) : filteredPicks.length === 0 ? (
                <div className="vision-card p-8 text-center">
                  <Trophy className="w-8 h-8 mx-auto mb-3 text-muted-foreground/45" />
                  <p className="text-[13px] font-bold text-foreground/80">{picks.length === 0 ? "No Saved Picks Yet" : "No Picks Match Filters"}</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">{picks.length === 0 ? "Save picks from the Free Picks page to build your history" : "Try adjusting your filters"}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedPicks.map(([date, datePicks]) => (
                    <div key={date}>
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[11px] font-bold text-foreground">
                          {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                        <span className="text-[9px] text-muted-foreground/50">{datePicks.length} pick{datePicks.length !== 1 ? "s" : ""}</span>
                        {(() => {
                          const dW = datePicks.filter(p => p.result === "win").length;
                          const dL = datePicks.filter(p => p.result === "loss").length;
                          if (dW + dL === 0) return null;
                          return <span className="text-[10px] font-bold ml-auto"><span className="text-nba-green">{dW}W</span> - <span className="text-nba-red">{dL}L</span></span>;
                        })()}
                      </div>
                      <div className="space-y-2">
                        {datePicks.map((pick, i) => {
                          const PropIcon = PROP_ICONS[pick.prop_type] || Target;
                          const resultConf = RESULT_CONFIG[pick.result || "pending"];
                          const ResultIcon = resultConf.icon;
                          const isOver = pick.direction === "over";
                          return (
                            <motion.div key={pick.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                              className="vision-card p-3 relative overflow-hidden">
                              <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{
                                background: pick.result === "win" ? 'hsl(145 60% 45%)' : pick.result === "loss" ? 'hsl(0 72% 51%)' : 'hsl(43 96% 56%)',
                              }} />
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${
                                    pick.hit_rate >= 90 ? "bg-nba-green/15 text-nba-green" : pick.hit_rate >= 80 ? "bg-accent/15 text-accent" : "bg-nba-yellow/15 text-nba-yellow"
                                  }`}>{pick.hit_rate}%</span>
                                  {pick.odds && <span className="text-[10px] font-bold text-muted-foreground/60">{fmt(pick.odds)}</span>}
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md text-muted-foreground/50"
                                    style={{ background: 'hsla(228, 20%, 15%, 0.5)' }}>{pick.sport.toUpperCase()}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`flex items-center gap-0.5 text-[10px] font-bold ${resultConf.color}`}>
                                    <ResultIcon className="w-3 h-3" />{resultConf.label}
                                  </span>
                                  <button onClick={() => removePick(pick.id)} className="p-1 rounded-lg text-muted-foreground/40 hover:text-nba-red transition-colors">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isOver ? "bg-nba-green/15 text-nba-green" : "bg-nba-red/15 text-nba-red"}`}>
                                  {isOver ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-[12px] font-bold text-foreground truncate">{pick.player_name}</p>
                                  <span className={`text-[10px] font-semibold ${isOver ? "text-nba-green/80" : "text-nba-red/80"}`}>
                                    <PropIcon className="w-2.5 h-2.5 inline mr-0.5" />
                                    {pick.direction.toUpperCase()} {pick.line} {pick.prop_type}
                                  </span>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ═══════════════ PARLAYS TAB ═══════════════ */}
          {tab === "parlays" && (
            <motion.div key="parlays" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              {/* Stats — Dashboard-style */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Layers, label: "Total", value: parlayStats.total, gradient: "from-[hsl(250,76%,62%)] to-[hsl(280,70%,55%)]", glow: "hsla(250,76%,62%,0.15)", sub: "all time" },
                  { icon: Target, label: "Win Rate", value: `${parlayStats.winRate}%`, gradient: parlayStats.winRate >= 50 ? "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]" : "from-[hsl(0,72%,51%)] to-[hsl(340,65%,47%)]", glow: parlayStats.winRate >= 50 ? "hsla(158,64%,52%,0.15)" : "hsla(0,72%,51%,0.15)", sub: parlayStats.winRate >= 50 ? "strong" : "tracking" },
                  { icon: CheckCircle2, label: "Wins", value: parlayStats.wins, gradient: "from-[hsl(158,64%,52%)] to-[hsl(175,55%,42%)]", glow: "hsla(158,64%,52%,0.15)", sub: "hits" },
                  { icon: Clock, label: "Pending", value: parlayStats.pending, gradient: "from-[hsl(43,96%,56%)] to-[hsl(30,90%,50%)]", glow: "hsla(43,96%,56%,0.15)", sub: "unsettled" },
                ].map((s, i) => (
                  <motion.div key={s.label} initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: i * 0.07, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="vision-card-animated p-4 group cursor-default" whileHover={{ scale: 1.02, y: -2 }}>
                    <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-[0.06] pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${s.glow.replace('0.15', '1')}, transparent)` }} />
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-3">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.gradient} flex items-center justify-center shadow-lg transition-all group-hover:shadow-xl group-hover:scale-105`}
                          style={{ boxShadow: `0 4px 14px -2px ${s.glow}` }}>
                          <s.icon className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-[8px] font-bold px-2 py-0.5 rounded-md text-muted-foreground/65 uppercase tracking-wider"
                          style={{ background: 'hsla(228, 20%, 15%, 0.5)' }}>{s.sub}</span>
                      </div>
                      <p className="text-2xl font-extrabold text-foreground tabular-nums tracking-tight">{s.value}</p>
                      <p className="text-[10px] text-muted-foreground/65 font-semibold mt-0.5 uppercase tracking-wider">{s.label}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Parlay Cards */}
              {picksLoading ? (
                <div className="flex justify-center py-16">
                  <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid hsla(228,30%,20%,0.3)', borderTopColor: 'hsl(250 76% 62%)' }} />
                </div>
              ) : parlays.length === 0 ? (
                <div className="vision-card p-8 text-center">
                  <Layers className="w-8 h-8 mx-auto mb-3 text-muted-foreground/45" />
                  <p className="text-[13px] font-bold text-foreground/80">No Saved Parlays Yet</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">Analyze a parlay in the Parlay Builder and save it</p>
                </div>
              ) : parlays.map((parlay, i) => {
                const resultConf = RESULT_CONFIG[parlay.result || "pending"];
                const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
                const gradeColor = parlay.overall_grade === "strong" ? "text-nba-green" : parlay.overall_grade === "lean" ? "text-nba-yellow" : "text-nba-red";
                return (
                  <motion.div key={parlay.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className="vision-card p-4 relative overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{
                      background: parlay.result === "win" ? 'hsl(145 60% 45%)' : parlay.result === "loss" ? 'hsl(0 72% 51%)' : 'hsl(250 76% 62%)',
                    }} />

                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[12px] font-bold text-foreground">{legs.length}-Leg Parlay</span>
                        <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full ${
                          parlay.overall_grade === "strong" ? "bg-nba-green/15 text-nba-green" :
                          parlay.overall_grade === "lean" ? "bg-nba-yellow/15 text-nba-yellow" : "bg-nba-red/15 text-nba-red"
                        }`}>{parlay.overall_grade}</span>
                        <span className={`text-[11px] font-extrabold ${gradeColor}`}>{parlay.overall_confidence.toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-muted-foreground/50">
                          {new Date(parlay.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                        <button onClick={() => removeParlay(parlay.id)} className="p-1 rounded-lg text-muted-foreground/40 hover:text-nba-red transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Mini stats */}
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {[
                        { label: "Odds", val: fmt(parlay.parlay_odds), color: "text-accent" },
                        { label: "Stake", val: `$${parlay.stake}`, color: "text-foreground" },
                        { label: "Payout", val: `$${parlay.potential_payout.toFixed(0)}`, color: "text-nba-green" },
                      ].map(s => (
                        <div key={s.label} className="rounded-lg p-1.5 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.5)' }}>
                          <span className="block text-[8px] uppercase tracking-wider text-muted-foreground/50">{s.label}</span>
                          <span className={`block text-[11px] font-extrabold ${s.color}`}>{s.val}</span>
                        </div>
                      ))}
                    </div>

                    {/* Legs */}
                    <div className="space-y-1 mb-2">
                      {legs.map((leg: any, li: number) => (
                        <div key={li} className="flex items-center justify-between text-[10px] py-1 px-2 rounded-lg" style={{ background: 'hsla(228, 20%, 10%, 0.3)' }}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground/50 font-bold">#{li + 1}</span>
                            <span className="font-bold uppercase text-[8px] text-accent/70">{leg.sport}</span>
                            <button
                              onClick={() => {
                                const parsed = parseLegPick(leg.pick);
                                if (parsed) {
                                  const sport = (leg.sport || "NBA").toLowerCase();
                                  const route = sport === "nba" || sport === "mlb" || sport === "nhl"
                                    ? `/dashboard/${sport}`
                                    : `/dashboard/nba`;
                                  navigate(route, { state: { autoAnalyze: true, ...parsed, sport: leg.sport } });
                                }
                              }}
                              className="font-medium text-accent/90 hover:text-accent underline decoration-accent/30 hover:decoration-accent truncate max-w-[180px] text-left transition-colors"
                            >
                              {leg.pick}
                            </button>
                          </div>
                          <span className={`font-bold ${
                            leg.grade === "strong" ? "text-nba-green" : leg.grade === "lean" ? "text-nba-yellow" : "text-nba-red"
                          }`}>{leg.confidence?.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>

                    {/* Result buttons */}
                    <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid hsla(228, 20%, 20%, 0.2)' }}>
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-semibold">Result</span>
                      <div className="flex gap-1">
                        {(["pending", "win", "loss"] as const).map(r => {
                          const conf = RESULT_CONFIG[r];
                          const isActive = parlay.result === r;
                          return (
                            <button key={r} onClick={() => updateParlayResult(parlay.id, r)}
                              className={`flex items-center gap-0.5 px-2 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                isActive ? `${conf.bg} ${conf.color} border` : "text-muted-foreground/50 hover:text-foreground/70"
                              }`}>
                              <conf.icon className="w-2.5 h-2.5" />{conf.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ProfitTrackerPage;
