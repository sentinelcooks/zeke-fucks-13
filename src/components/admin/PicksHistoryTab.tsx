import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, RefreshCw, Check, X, Minus, RotateCcw, Flame, Snowflake, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isPicksHistoryPick } from "@/lib/pickHistoryFilters";
import { formatPropType } from "@/lib/formatPickLabel";
import { profitUnits } from "@/lib/odds";
import { exportPickHistory, type ExportablePick } from "@/lib/exportPickHistory";

interface PicksPick {
  id: string;
  pick_date: string;
  sport: string;
  league?: string | null;
  home_team: string | null;
  away_team: string | null;
  team: string | null;
  opponent: string | null;
  player_name: string;
  prop_type: string;
  bet_type: string;
  line: number;
  direction: string;
  odds: string | null;
  hit_rate: number;
  result: string | null;
  created_at: string;
  tier?: string | null;
  status?: string | null;
  model_used?: string | null;
  model_version?: string | null;
  confidence?: number | null;
  edge_value?: number | null;
  opening_odds?: string | null;
  closing_odds?: string | null;
  clv?: number | null;
  stake_units?: number | null;
  profit_units?: number | null;
  graded_at?: string | null;
}

interface Stats {
  total: number;
  resolved: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  hit_rate: number;
  avg_edge: number;
  total_profit_units: number;
  roi_pct: number;
  current_streak: { type: "W" | "L"; count: number } | null;
}

const SPORT_COLORS: Record<string, string> = {
  nba: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  mlb: "bg-red-500/15 text-red-400 border-red-500/20",
  nhl: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  ufc: "bg-red-600/15 text-red-500 border-red-600/20",
};

type Preset = "today" | "7d" | "30d" | "all" | "custom";

export const PicksHistoryTab: React.FC<{ password: string }> = ({ password }) => {
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState<PicksPick[]>([]);
  const [preset, setPreset] = useState<Preset>("all");
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [sport, setSport] = useState<string>("all");
  const [model, setModel] = useState<string>("all");
  const [resultFilter, setResultFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-onboarding", {
        body: { password, action: "list_picks_history" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const filtered = ((data.picks || []) as PicksPick[]).filter(isPicksHistoryPick);
      console.log("[PicksHistory] rows after filter", filtered.length, filtered.slice(0, 3));
      setPicks(filtered);
    } catch (e) {
      console.error("Failed to load picks history:", e);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (preset === "today") return { startDate: today, endDate: new Date() };
    if (preset === "7d") {
      const s = new Date(today); s.setDate(s.getDate() - 7);
      return { startDate: s, endDate: new Date() };
    }
    if (preset === "30d") {
      const s = new Date(today); s.setDate(s.getDate() - 30);
      return { startDate: s, endDate: new Date() };
    }
    if (preset === "custom") return { startDate: customStart, endDate: customEnd };
    return { startDate: undefined, endDate: undefined };
  }, [preset, customStart, customEnd]);

  const modelOptions = useMemo(
    () => Array.from(new Set(picks.map((p) => p.model_used).filter((m): m is string => !!m))).sort(),
    [picks]
  );

  const matchResultFilter = (raw: string | null, want: string) => {
    const r = (raw || "pending").toLowerCase();
    if (want === "all") return true;
    if (want === "win") return r === "hit" || r === "win";
    if (want === "loss") return r === "miss" || r === "loss";
    if (want === "push") return r === "push";
    if (want === "pending") return r === "pending" || !raw;
    return true;
  };

  const filtered = useMemo(() => {
    return picks.filter((p) => {
      if (sport !== "all" && (p.sport || "").toLowerCase() !== sport) return false;
      if (model !== "all" && (p.model_used || "") !== model) return false;
      if (!matchResultFilter(p.result, resultFilter)) return false;
      if (startDate) {
        const pd = new Date(p.pick_date + "T00:00:00");
        if (pd < startDate) return false;
      }
      if (endDate) {
        const pd = new Date(p.pick_date + "T00:00:00");
        const e = new Date(endDate); e.setHours(23, 59, 59, 999);
        if (pd > e) return false;
      }
      return true;
    });
  }, [picks, sport, model, resultFilter, startDate, endDate]);

  const stats: Stats = useMemo(() => {
    let wins = 0, losses = 0, pushes = 0, pending = 0;
    let edgeSum = 0, edgeCount = 0;
    let profitSum = 0, stakeSum = 0;
    for (const p of filtered) {
      const r = (p.result || "pending").toLowerCase();
      if (r === "hit" || r === "win") wins++;
      else if (r === "miss" || r === "loss") losses++;
      else if (r === "push") pushes++;
      else pending++;
      if (typeof p.edge_value === "number") { edgeSum += p.edge_value; edgeCount++; }
      const stake = typeof p.stake_units === "number" ? p.stake_units : 1;
      const profit = typeof p.profit_units === "number"
        ? p.profit_units
        : profitUnits(p.odds, p.result, stake);
      if (profit !== null && r !== "pending") {
        profitSum += profit;
        stakeSum += stake;
      }
    }
    const resolved = wins + losses;
    const hit_rate = resolved > 0 ? (wins / resolved) * 100 : 0;
    const avg_edge = edgeCount > 0 ? edgeSum / edgeCount : 0;
    const roi_pct = stakeSum > 0 ? (profitSum / stakeSum) * 100 : 0;

    const chrono = [...filtered].reverse();
    let streakType: "W" | "L" | null = null;
    let streakCount = 0;
    for (const p of chrono) {
      const r = (p.result || "").toLowerCase();
      let t: "W" | "L" | null = null;
      if (r === "hit" || r === "win") t = "W";
      else if (r === "miss" || r === "loss") t = "L";
      else continue;
      if (streakType === t) streakCount++;
      else { streakType = t; streakCount = 1; }
    }
    return {
      total: filtered.length, resolved, wins, losses, pushes, pending,
      hit_rate, avg_edge, total_profit_units: profitSum, roi_pct,
      current_streak: streakType ? { type: streakType, count: streakCount } : null,
    };
  }, [filtered]);

  const handleExport = (format: "csv" | "json") =>
    exportPickHistory(filtered as ExportablePick[], format, "picks_history");

  const updateResult = async (pick_id: string, result: string) => {
    setPicks((prev) => prev.map((p) => (p.id === pick_id ? { ...p, result } : p)));
    try {
      const { data, error } = await supabase.functions.invoke("admin-onboarding", {
        body: { password, action: "update_picks_result", pick_id, result },
      });
      if (error || data?.error) throw new Error(data?.error || "Failed");
    } catch (e) {
      console.error("Failed to update:", e);
      load();
    }
  };

  const hitRateColor = stats.hit_rate >= 55 ? "text-green-500"
    : stats.hit_rate >= 50 ? "text-yellow-500"
    : "text-destructive";

  const presetBtn = (p: Preset, label: string) => (
    <button
      key={p}
      onClick={() => setPreset(p)}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
        preset === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
      )}
    >{label}</button>
  );

  const resultBadge = (result: string | null) => {
    const r = (result || "pending").toLowerCase();
    if (r === "hit" || r === "win") return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">✓ Win</span>;
    if (r === "miss" || r === "loss") return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/20">✗ Loss</span>;
    if (r === "push") return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">Push</span>;
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">Pending</span>;
  };

  const tierBadge = (tier: string | null | undefined) => {
    const t = String(tier || "").toLowerCase();
    if (!t) return null;
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border uppercase">{t}</span>;
  };

  const renderMatchup = (p: PicksPick) => {
    if (p.bet_type === "moneyline" || p.bet_type === "spread" || p.bet_type === "total") {
      return `${p.away_team || "—"} @ ${p.home_team || "—"}`;
    }
    return `${p.player_name}${p.team ? ` (${p.team}${p.opponent ? ` vs ${p.opponent}` : ""})` : ""}`;
  };

  const renderPick = (p: PicksPick) => {
    if (p.bet_type === "moneyline") return `${p.team || ""} ML`;
    if (p.bet_type === "spread") return `${p.team || ""} ${p.line > 0 ? "+" : ""}${p.line}`;
    if (p.bet_type === "total") return `${p.direction.toUpperCase()} ${p.line}`;
    return `${formatPropType(p.prop_type)} ${p.direction.toUpperCase()} ${p.line}`;
  };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div className="glass-card rounded-xl p-4 col-span-2 sm:col-span-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Hit Rate</p>
          <p className={cn("text-3xl font-extrabold tabular-nums", hitRateColor)}>{stats.hit_rate.toFixed(1)}%</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{stats.wins}/{stats.resolved} resolved</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Total</p>
          <p className="text-2xl font-extrabold text-foreground tabular-nums">{stats.total}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">W / L / P</p>
          <p className="text-2xl font-extrabold text-foreground tabular-nums">
            <span className="text-green-500">{stats.wins}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-destructive">{stats.losses}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-muted-foreground">{stats.pushes}</span>
          </p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Pending</p>
          <p className="text-2xl font-extrabold text-yellow-500 tabular-nums">{stats.pending}</p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Streak</p>
          {stats.current_streak ? (
            <p className={cn(
              "text-2xl font-extrabold tabular-nums inline-flex items-center gap-1.5",
              stats.current_streak.type === "W"
                ? (stats.current_streak.count >= 3 ? "text-green-500" : "text-foreground")
                : "text-destructive"
            )}>
              {stats.current_streak.type === "W"
                ? (stats.current_streak.count >= 3 ? <Flame className="w-5 h-5" /> : null)
                : <Snowflake className="w-5 h-5" />}
              {stats.current_streak.type}{stats.current_streak.count}
            </p>
          ) : (
            <p className="text-2xl font-extrabold text-muted-foreground">—</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Avg Edge</p>
          <p className={cn(
            "text-2xl font-extrabold tabular-nums",
            stats.avg_edge >= 0 ? "text-green-500" : "text-destructive"
          )}>
            {stats.avg_edge >= 0 ? "+" : ""}{stats.avg_edge.toFixed(2)}%
          </p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Profit (units)</p>
          <p className={cn(
            "text-2xl font-extrabold tabular-nums",
            stats.total_profit_units >= 0 ? "text-green-500" : "text-destructive"
          )}>
            {stats.total_profit_units >= 0 ? "+" : ""}{stats.total_profit_units.toFixed(2)}u
          </p>
        </div>
        <div className="glass-card rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">ROI</p>
          <p className={cn(
            "text-2xl font-extrabold tabular-nums",
            stats.roi_pct >= 0 ? "text-green-500" : "text-destructive"
          )}>
            {stats.roi_pct >= 0 ? "+" : ""}{stats.roi_pct.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {presetBtn("today", "Today")}
          {presetBtn("7d", "7d")}
          {presetBtn("30d", "30d")}
          {presetBtn("all", "All")}
          {presetBtn("custom", "Custom")}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("text-xs", !customStart && "text-muted-foreground")}>
                  <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                  {customStart ? format(customStart, "MMM d, yyyy") : "Start"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customStart} onSelect={setCustomStart} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">–</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("text-xs", !customEnd && "text-muted-foreground")}>
                  <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                  {customEnd ? format(customEnd, "MMM d, yyyy") : "End"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          </div>
        )}
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className="bg-input text-foreground rounded-lg py-1.5 px-3 text-xs border border-border focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          <option value="all">All Sports</option>
          <option value="nba">NBA</option>
          <option value="mlb">MLB</option>
          <option value="nhl">NHL</option>
          <option value="ufc">UFC</option>
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="bg-input text-foreground rounded-lg py-1.5 px-3 text-xs border border-border focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          <option value="all">All Models</option>
          {modelOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value)}
          className="bg-input text-foreground rounded-lg py-1.5 px-3 text-xs border border-border focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          <option value="all">All Results</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="push">Pushes</option>
          <option value="pending">Pending</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs gap-1.5" disabled={filtered.length === 0}>
                <Download className="w-3.5 h-3.5" /> Export
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-32 p-1">
              <button
                onClick={() => handleExport("csv")}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors"
              >Export CSV</button>
              <button
                onClick={() => handleExport("json")}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors"
              >Export JSON</button>
            </PopoverContent>
          </Popover>
          <button onClick={load} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center">No non-edge picks in this range.</p>
        )}
        {!loading && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sport</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tier</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Matchup</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pick</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Model</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Conf</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Edge</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Odds</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">CLV</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">P/L</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Result</th>
                  <th className="text-right py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Grade</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const sportKey = (p.sport || "").toLowerCase();
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-4 text-[11px] text-muted-foreground whitespace-nowrap">
                        {format(new Date(p.pick_date + "T00:00:00"), "MMM d")}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase",
                          SPORT_COLORS[sportKey] || "bg-muted text-muted-foreground border-border")}>
                          {p.sport}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">{tierBadge(p.tier)}</td>
                      <td className="py-2.5 px-4 text-xs text-foreground/90 max-w-[220px] truncate">{renderMatchup(p)}</td>
                      <td className="py-2.5 px-4 text-xs font-medium text-foreground">{renderPick(p)}</td>
                      <td className="py-2.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {p.model_used || "—"}
                        {p.model_version && <span className="text-muted-foreground/60"> v{p.model_version}</span>}
                      </td>
                      <td className="py-2.5 px-4 text-xs tabular-nums text-foreground/80">{Math.round(p.hit_rate)}%</td>
                      <td className={cn(
                        "py-2.5 px-4 text-xs tabular-nums",
                        typeof p.edge_value === "number"
                          ? (p.edge_value >= 0 ? "text-green-500" : "text-destructive")
                          : "text-muted-foreground"
                      )}>
                        {typeof p.edge_value === "number"
                          ? `${p.edge_value >= 0 ? "+" : ""}${p.edge_value.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-xs tabular-nums text-muted-foreground">{p.odds || "—"}</td>
                      <td className={cn(
                        "py-2.5 px-4 text-xs tabular-nums",
                        typeof p.clv === "number"
                          ? (p.clv >= 0 ? "text-green-500" : "text-destructive")
                          : "text-muted-foreground"
                      )}>
                        {typeof p.clv === "number"
                          ? `${p.clv >= 0 ? "+" : ""}${p.clv.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className={cn(
                        "py-2.5 px-4 text-xs tabular-nums",
                        typeof p.profit_units === "number"
                          ? (p.profit_units >= 0 ? "text-green-500" : "text-destructive")
                          : "text-muted-foreground"
                      )}>
                        {typeof p.profit_units === "number"
                          ? `${p.profit_units >= 0 ? "+" : ""}${p.profit_units.toFixed(2)}u`
                          : "—"}
                      </td>
                      <td className="py-2.5 px-4">{resultBadge(p.result)}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => updateResult(p.id, "hit")} title="Mark Win"
                            className="w-6 h-6 rounded flex items-center justify-center text-green-500 hover:bg-green-500/10 transition-colors">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => updateResult(p.id, "miss")} title="Mark Loss"
                            className="w-6 h-6 rounded flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => updateResult(p.id, "push")} title="Mark Push"
                            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => updateResult(p.id, "pending")} title="Reset"
                            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
