import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, RefreshCw, Check, X, Minus, RotateCcw, Flame, Snowflake } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isEdgeHistoryPick } from "@/lib/pickHistoryFilters";

interface EdgePick {
  id: string;
  pick_date: string;
  sport: string;
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
}

interface Stats {
  total: number;
  resolved: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  hit_rate: number;
  current_streak: { type: "W" | "L"; count: number } | null;
}

const SPORT_COLORS: Record<string, string> = {
  nba: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  mlb: "bg-red-500/15 text-red-400 border-red-500/20",
  nhl: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  ufc: "bg-red-600/15 text-red-500 border-red-600/20",
};

type Preset = "today" | "7d" | "30d" | "all" | "custom";

export const EdgeHistoryTab: React.FC<{ password: string }> = ({ password }) => {
  const [loading, setLoading] = useState(false);
  const [picks, setPicks] = useState<EdgePick[]>([]);
  const [preset, setPreset] = useState<Preset>("all");
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [sport, setSport] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-onboarding", {
        body: { password, action: "list_edge_history" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const filtered = ((data.picks || []) as EdgePick[]).filter(isEdgeHistoryPick);
      console.log("[EdgeHistory] rows after filter", filtered.length, filtered.slice(0, 3));
      setPicks(filtered);
    } catch (e) {
      console.error("Failed to load edge history:", e);
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

  const filtered = useMemo(() => {
    return picks.filter((p) => {
      if (sport !== "all" && (p.sport || "").toLowerCase() !== sport) return false;
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
  }, [picks, sport, startDate, endDate]);

  const stats: Stats = useMemo(() => {
    let wins = 0, losses = 0, pushes = 0, pending = 0;
    for (const p of filtered) {
      const r = (p.result || "pending").toLowerCase();
      if (r === "hit" || r === "win") wins++;
      else if (r === "miss" || r === "loss") losses++;
      else if (r === "push") pushes++;
      else pending++;
    }
    const resolved = wins + losses;
    const hit_rate = resolved > 0 ? (wins / resolved) * 100 : 0;
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
      total: filtered.length, resolved, wins, losses, pushes, pending, hit_rate,
      current_streak: streakType ? { type: streakType, count: streakCount } : null,
    };
  }, [filtered]);

  const updateResult = async (pick_id: string, result: string) => {
    // optimistic
    setPicks((prev) => prev.map((p) => (p.id === pick_id ? { ...p, result } : p)));
    try {
      const { data, error } = await supabase.functions.invoke("admin-onboarding", {
        body: { password, action: "update_edge_result", pick_id, result },
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

  const renderMatchup = (p: EdgePick) => {
    if (p.bet_type === "moneyline" || p.bet_type === "spread" || p.bet_type === "total") {
      return `${p.away_team || "—"} @ ${p.home_team || "—"}`;
    }
    return `${p.player_name}${p.team ? ` (${p.team}${p.opponent ? ` vs ${p.opponent}` : ""})` : ""}`;
  };

  const renderPick = (p: EdgePick) => {
    if (p.bet_type === "moneyline") return `${p.team || ""} ML`;
    if (p.bet_type === "spread") return `${p.team || ""} ${p.line > 0 ? "+" : ""}${p.line}`;
    if (p.bet_type === "total") return `${p.direction.toUpperCase()} ${p.line}`;
    return `${p.prop_type} ${p.direction.toUpperCase()} ${p.line}`;
  };

  return (
    <>
      {/* Stats header */}
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

      {/* Filters */}
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
        <button onClick={load} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground ml-auto">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="text-muted-foreground text-sm py-8 text-center">No edge picks in this range.</p>
        )}
        {!loading && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sport</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Matchup</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pick</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Conf</th>
                  <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Odds</th>
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
                      <td className="py-2.5 px-4 text-xs text-foreground/90 max-w-[220px] truncate">{renderMatchup(p)}</td>
                      <td className="py-2.5 px-4 text-xs font-medium text-foreground">{renderPick(p)}</td>
                      <td className="py-2.5 px-4 text-xs tabular-nums text-foreground/80">{Math.round(p.hit_rate)}%</td>
                      <td className="py-2.5 px-4 text-xs tabular-nums text-muted-foreground">{p.odds || "—"}</td>
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
