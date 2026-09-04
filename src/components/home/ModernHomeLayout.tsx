import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Flame, ChevronRight, Sparkles, CheckCircle2, XCircle,
  BarChart3, Crosshair, DollarSign, Target
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { premiumRequestHeaders } from "@/lib/premiumRequestHeaders";
import { useNavigate } from "react-router-dom";

import { PnLCalendar } from "@/components/PnLCalendar";
import { useAuth } from "@/contexts/AuthContext";
import { searchPlayers } from "@/services/api";
import { AddToSlipSheet } from "@/components/AddToSlipSheet";
import { getTeamLogoUrl } from "@/utils/teamLogos";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { isEdgeHistoryPick, isPicksHistoryPick, isActiveTodayPick } from "@/lib/pickHistoryFilters";
import { todayInTZ, getGameDate, isTodayGamePick, isResultFinal, shiftYmd } from "@/lib/gameDate";
import { formatPropType } from "@/lib/formatPickLabel";
import { resolveDisplayName } from "@/lib/displayName";
import { normalizeConfidencePercent, normalizeVerdict } from "@/lib/matchupGrade";
import {
  modelScorePercent,
  selectTodaysEdgePicks,
  type EdgePresentation,
} from "@/lib/todaysEdgeSelection";

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
  confidence?: number | null;
  verdict?: string | null;
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
  status?: string | null;
  event_id?: string | null;
  commence_time?: string | null;
  game_date?: string | null;
  model_used?: string | null;
  model_diagnostics?: Record<string, unknown> | null;
  score_kind?: string | null;
  calibration_status?: string | null;
  calibrated_probability?: number | null;
  edgePresentation?: EdgePresentation;
  edgeWarning?: string | null;
}

function canonicalGameMarket(betType?: string): string | null {
  const normalized = String(betType ?? "").toLowerCase();
  if (normalized === "over_under") return "total";
  return ["moneyline", "spread", "total"].includes(normalized) ? normalized : null;
}

function normalizedIdentity(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function todayPickDedupeKey(pick: DailyPick): string {
  const gameMarket = canonicalGameMarket(pick.bet_type);
  if (gameMarket) {
    const eventIdentity = pick.event_id
      ? `event:${normalizedIdentity(pick.event_id)}`
      : `matchup:${normalizedIdentity(pick.away_team || pick.opponent)}@${normalizedIdentity(pick.home_team || pick.team)}:${getGameDate(pick) ?? ""}`;
    return `game|${pick.sport}|${eventIdentity}|${gameMarket}`;
  }

  return pick.event_id
    ? `${pick.event_id}|${pick.player_name}|${pick.prop_type}|${pick.direction}|${pick.line}`
    : `${pick.sport}|${getGameDate(pick) ?? ""}|${pick.home_team ?? pick.team ?? ""}|${pick.away_team ?? pick.opponent ?? ""}|${pick.player_name}|${pick.prop_type}|${pick.direction}|${pick.line}`;
}

function comparePickQuality(left: DailyPick, right: DailyPick): number {
  const leftConfidence = normalizeConfidencePercent(left.confidence ?? left.hit_rate ?? 0);
  const rightConfidence = normalizeConfidencePercent(right.confidence ?? right.hit_rate ?? 0);
  if (leftConfidence !== rightConfidence) return leftConfidence - rightConfidence;

  const leftEdge = Number(left.model_diagnostics?.modelEdge ?? 0);
  const rightEdge = Number(right.model_diagnostics?.modelEdge ?? 0);
  if (Number.isFinite(leftEdge) && Number.isFinite(rightEdge) && leftEdge !== rightEdge) {
    return leftEdge - rightEdge;
  }

  const decimalOdds = (odds: string | null) => {
    const american = Number(String(odds ?? "").replace(/[^\d-]/g, ""));
    if (!Number.isFinite(american) || american === 0) return 0;
    return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  };
  return decimalOdds(left.odds) - decimalOdds(right.odds);
}

function selectedTeamForGameLogo(pick: DailyPick): string {
  const market = canonicalGameMarket(pick.bet_type);
  if (market === "spread" || market === "moneyline") {
    if (pick.team) return pick.team;
    if (pick.direction === "home") return pick.home_team ?? "";
    if (pick.direction === "away") return pick.away_team ?? "";
  }
  return pick.home_team || pick.team || pick.away_team || pick.opponent || "";
}

function teamInitials(team: string, sport: string): string {
  const initials = team
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  return initials || sport.slice(0, 3).toUpperCase();
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

function CompactScore({ rate, isModelScore = false }: { rate: number; isModelScore?: boolean }) {
  return (
    <div className="shrink-0 pt-1 text-right">
      <p className="text-lg font-extrabold tabular-nums text-foreground">{rate}{isModelScore ? "" : "%"}</p>
      <p className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50">{isModelScore ? "MODEL SCORE" : "Confidence"}</p>
    </div>
  );
}

interface ModernHomeLayoutProps {
  plays: Play[];
  loading: boolean;
}

export function ModernHomeLayout({ plays, loading }: ModernHomeLayoutProps) {
  const navigate = useNavigate();
  const [slipSheetOpen, setSlipSheetOpen] = useState(false);
  const [slipSheetPick, setSlipSheetPick] = useState<import("@/components/AddToSlipSheet").SlipSheetPick | null>(null);
  
  const { user, profile } = useAuth();
  const { fmt: formatOddsFn } = useOddsFormat();
  const [todayPicks, setTodayPicks] = useState<DailyPick[]>([]);
  const [dailyTierPicks, setDailyTierPicks] = useState<DailyPick[]>([]);
  const [yesterdayPicks, setYesterdayPicks] = useState<DailyPick[]>([]);
  const [picksLoading, setPicksLoading] = useState(true);
  const [lineupError, setLineupError] = useState<string | null>(null);
  const [lineupScanPending, setLineupScanPending] = useState(false);
  const [userSports, setUserSports] = useState<string[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [headshots, setHeadshots] = useState<Record<string, string>>({});
  const [activeDailyEdge, setActiveDailyEdge] = useState(0);
  const [activeLineupIndex, setActiveLineupIndex] = useState(0);
  const todayPickRequestId = useRef(0);
  const lineupPollTimeout = useRef<number | null>(null);

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

  const sortByPref = useCallback((arr: DailyPick[]) => {
    const scoreOf = (p: DailyPick) => (p.confidence != null ? p.confidence : (p.hit_rate > 1 ? p.hit_rate / 100 : p.hit_rate)) ?? 0;
    if (userSports.length > 0) {
      arr.sort((a, b) => {
        const aMatch = userSports.includes(a.sport?.toLowerCase()) ? 1 : 0;
        const bMatch = userSports.includes(b.sport?.toLowerCase()) ? 1 : 0;
        if (bMatch !== aMatch) return bMatch - aMatch;
        return scoreOf(b) - scoreOf(a);
      });
    } else {
      const scoreOf2 = scoreOf;
      arr.sort((a, b) => scoreOf2(b) - scoreOf2(a));
    }
    return arr;
  }, [userSports]);

  const fetchYesterdayEdgeResults = useCallback(async () => {
    const yesterdayET = shiftYmd(todayInTZ(), -1);
    if (!yesterdayET) return;

    const [byGameDate, legacyByPickDate] = await Promise.all([
      supabase
        .from("daily_picks")
        .select("*")
        .eq("game_date", yesterdayET)
        .eq("tier", "edge")
        .order("created_at", { ascending: false }),
      supabase
        .from("daily_picks")
        .select("*")
        .is("game_date", null)
        .eq("pick_date", yesterdayET)
        .eq("tier", "edge")
        .order("created_at", { ascending: false }),
    ]);

    if (byGameDate.error || legacyByPickDate.error) {
      console.error("[YesterdayEdge] failed to load results", byGameDate.error || legacyByPickDate.error);
      return;
    }

    setYesterdayPicks(
      [...((byGameDate.data as DailyPick[]) || []), ...((legacyByPickDate.data as DailyPick[]) || [])]
        .filter(isEdgeHistoryPick),
    );
  }, []);

  const fetchTodayPicks = useCallback(async (): Promise<number | null> => {
    const requestId = ++todayPickRequestId.current;
    const todayET = todayInTZ();
    const yesterdayPickDate = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Public display is keyed off the actual game_date in America/New_York —
    // pick_date (scanner generation date) must NOT drive what shows in
    // Today's Edge / Picks. We pull two sets:
    //   1. Today's slate by game_date (with a fallback for legacy rows that
    //      were inserted before the game_date column existed).
    //   2. Yesterday's edge results for the recap card (unchanged).
    let todayByGame: Awaited<ReturnType<typeof supabase.from<"daily_picks">>>;
    let todayLegacyRes: Awaited<ReturnType<typeof supabase.from<"daily_picks">>>;
    try {
      [todayByGame, todayLegacyRes] = await Promise.all([
        supabase
          .from("daily_picks")
          .select("*")
          .eq("game_date", todayET)
          .order("created_at", { ascending: false })
          .order("confidence", { ascending: false, nullsFirst: false })
          .limit(120),
        // Legacy fallback: rows missing game_date that were generated today or
        // yesterday (night-before scans). isActiveTodayPick will drop any whose
        // commence_time-derived game date is not today.
        supabase
          .from("daily_picks")
          .select("*")
          .is("game_date", null)
          .gte("pick_date", yesterdayPickDate)
          .lte("pick_date", todayET)
          .order("created_at", { ascending: false })
          .limit(80),
      ]);
    } catch (error) {
      console.error("[TodaysEdge] failed to load lineup", error);
      if (requestId === todayPickRequestId.current) {
        setLineupError("Live picks could not be loaded. Please try again.");
        setPicksLoading(false);
      }
      return null;
    }

    if (todayByGame.error || todayLegacyRes.error) {
      console.error("[TodaysEdge] failed to load lineup", todayByGame.error || todayLegacyRes.error);
      if (requestId === todayPickRequestId.current) {
        setLineupError("Live picks could not be loaded. Please try again.");
        setPicksLoading(false);
      }
      return null;
    }

    // Hard odds guard: drop extreme longshots (|odds| >= 1000)
    const oddsOk = (o: string | null | undefined) => {
      if (!o) return true;
      const n = parseInt(String(o).replace(/[^\d-]/g, ""), 10);
      if (Number.isNaN(n)) return true;
      return Math.abs(n) < 1000;
    };

    const merged: DailyPick[] = [
      ...((todayByGame.data as DailyPick[]) || []),
      ...((todayLegacyRes.data as DailyPick[]) || []),
    ];

    // Event-identity dedupe so the same logical pick can't appear twice
    // because the scanner inserted a fresh copy on a later run.
    const dedupe = (arr: DailyPick[]): DailyPick[] => {
      const winners = new Map<string, { pick: DailyPick; firstIndex: number }>();
      arr.forEach((pick, index) => {
        const key = todayPickDedupeKey(pick);
        const existing = winners.get(key);
        if (!existing || comparePickQuality(pick, existing.pick) > 0) {
          winners.set(key, { pick, firstIndex: existing?.firstIndex ?? index });
        }
      });
      return [...winners.values()]
        .sort((left, right) => left.firstIndex - right.firstIndex)
        .map(({ pick }) => pick);
    };

    // Today's Edge: allowlist — tier === "edge", status !== "empty_slate",
    // game is today (ET), and result is still pending. Graded picks roll into
    // Yesterday's Edge on the next day; keeping them out of today's rail
    // prevents yesterday's manually-graded leftovers from masquerading as
    // today's slate when their game_date happens to align.
    const activeToday = merged.filter(
      p => oddsOk(p.odds) && p.tier !== "pass" && isActiveTodayPick(p as any)
    );

    // Genuine calibrated Edge rows always win. If MLB or WNBA has no
    // validated Edge, use up to four analyzer-backed shadow candidates for
    // that sport. They remain tier=daily and render as model scores, never
    // as win probabilities.
    const edgeSelection = selectTodaysEdgePicks(activeToday, 5);
    const edgeTier = dedupe(edgeSelection.picks as DailyPick[]);

    // Keep every other active Daily Pick, but remove fallback cards already
    // surfaced above so the same play does not appear in both rails.
    const dailyTier = dedupe(
      activeToday.filter(
        p => p.tier !== "edge" &&
          isPicksHistoryPick(p as any) &&
          !edgeSelection.fallbackIds.has(p.id),
      )
    );

    if (import.meta.env.DEV) {
      const dropped = merged.filter(
        p =>
          !(
            isTodayGamePick(p as any) &&
            isEdgeHistoryPick(p as any) &&
            !isResultFinal(p.result)
          ),
      );
      console.groupCollapsed(
        `[TodaysEdge] fetched=${merged.length} shown=${edgeTier.length} dropped=${dropped.length}`
      );
      console.log("todayET:", todayET);
      for (const p of dropped) {
        const gd = getGameDate(p as any);
        const tier = String(p.tier ?? "").toLowerCase();
        const status = String(p.status ?? "").toLowerCase();
        let reason = "unknown";
        if (gd !== todayET) reason = `game_date(${gd}) != todayET(${todayET})`;
        else if (tier !== "edge") reason = `tier=${p.tier ?? "null"}`;
        else if (p.score_kind !== "calibrated_probability" || p.calibration_status !== "validated") reason = "calibration_not_supported";
        else if (status === "empty_slate") reason = "status=empty_slate";
        else if (isResultFinal(p.result)) reason = `result=${p.result} (graded)`;
        console.log(reason, {
          id: (p as any).id,
          tier: p.tier,
          result: p.result,
          status: p.status,
          game_date: p.game_date,
          pick_date: (p as any).pick_date,
          commence_time: (p as any).commence_time,
          created_at: (p as any).created_at,
          sport: p.sport,
          confidence: (p as any).confidence,
        });
      }
      console.log(
        `[TodaysEdge] validated=${edgeTier.filter(p => p.edgePresentation === "validated").length} ` +
          `fallback=${edgeSelection.fallbackIds.size} daily-tier=${dailyTier.length}`,
      );
      console.groupEnd();
    }

    if (requestId !== todayPickRequestId.current) return edgeTier.length;

    setTodayPicks([...edgeTier].sort((left, right) => comparePickQuality(right, left)));
    setDailyTierPicks(sortByPref(dailyTier));
    setLineupError(null);
    await fetchYesterdayEdgeResults();
    setPicksLoading(false);
    setLastRefreshed(new Date());
    return edgeTier.length;
  }, [fetchYesterdayEdgeResults, sortByPref]);

  const pollQueuedLineup = useCallback(() => {
    if (lineupPollTimeout.current !== null) {
      window.clearTimeout(lineupPollTimeout.current);
    }

    let attempts = 0;
    const poll = async () => {
      const visibleCount = await fetchTodayPicks();
      attempts += 1;
      if ((visibleCount ?? 0) > 0 || attempts >= 8) {
        setLineupScanPending(false);
        return;
      }
      lineupPollTimeout.current = window.setTimeout(() => { void poll(); }, 15_000);
    };

    void poll();
  }, [fetchTodayPicks]);

  const requestTodayLineup = useCallback(async () => {
    if (lineupScanPending) return;

    setLineupError(null);
    setLineupScanPending(true);
    try {
      const headers = await premiumRequestHeaders();
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        mode?: "rerank" | "queued" | "in_progress";
      }>("force-refresh-edge", { headers });
      if (error || data?.ok === false) throw error ?? new Error("refresh_failed");

      const visibleCount = await fetchTodayPicks();
      if ((visibleCount ?? 0) > 0 || data?.mode === "rerank") {
        setLineupScanPending(false);
      } else {
        pollQueuedLineup();
      }
    } catch (error) {
      console.error("[TodaysEdge] failed to start lineup refresh", error);
      setLineupError("Today's slate could not be started. Please try again shortly.");
      setLineupScanPending(false);
    }
  }, [fetchTodayPicks, lineupScanPending, pollQueuedLineup]);

  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const refresh = () => { void fetchTodayPicks(); };
    if (supabaseUrl && anonKey) {
      fetch(`${supabaseUrl}/functions/v1/grade-picks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": anonKey, "Authorization": `Bearer ${anonKey}` },
      }).catch(() => {}).finally(refresh);
    } else {
      refresh();
    }

    // Auto-refresh yesterday's results every 60 seconds
    const interval = setInterval(async () => {
      await fetchYesterdayEdgeResults();
    }, 60000);
    return () => {
      clearInterval(interval);
      if (lineupPollTimeout.current !== null) window.clearTimeout(lineupPollTimeout.current);
    };
  }, [fetchTodayPicks, fetchYesterdayEdgeResults]);

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

  function formatPickLabel(pick: DailyPick): string {
    const dir = (pick.direction || "").toLowerCase();
    if (pick.bet_type === "moneyline") {
      const team =
        pick.team ||
        (dir === "home" ? pick.home_team : dir === "away" ? pick.away_team : null) ||
        (dir === "win" ? ((pick.player_name || "").split(/\s+vs\s+/i)[0] || pick.player_name) : pick.player_name);
      return `${team} ML`;
    }
    if (pick.bet_type === "spread") {
      const team = dir === "home" ? pick.home_team : pick.away_team;
      const pt = Number(pick.line ?? 0);
      const signed = dir === "home" ? -Math.abs(pt) : Math.abs(pt);
      return `${team} ${signed > 0 ? "+" : ""}${signed}`;
    }
    if (pick.bet_type === "total") {
      const label = dir === "over" ? "O" : "U";
      return `${label} ${pick.line} Total`;
    }
    return `${dir === "over" ? "O" : "U"} ${pick.line} ${formatPropType(pick.prop_type)}`;
  }

  const yesterdayGraded = yesterdayPicks.filter(p => p.result === "hit" || p.result === "miss");
  const yesterdayPending = yesterdayPicks.filter(p => !p.result || (p.result !== "hit" && p.result !== "miss"));
  const yesterdayHits = yesterdayGraded.filter(p => p.result === "hit").length;
  const yesterdayTotal = yesterdayGraded.length;
  const yesterdayAcc = yesterdayTotal > 0 ? Math.round((yesterdayHits / yesterdayTotal) * 100) : 0;
  const hasYesterdayData = yesterdayPicks.length > 0;
  const yesterdayPendingVisibleLimit = 5;

  const quickLinks = [
    { label: "Analyze", icon: BarChart3, path: "/dashboard/analyze" },
    { label: "Picks", icon: Sparkles, path: "/dashboard/picks" },
    { label: "Tracker", icon: DollarSign, path: "/dashboard/tracker" },
    { label: "Lines", icon: Crosshair, path: "/dashboard/analyze?mode=lines" },
  ];
  const verifiedDailyEdges = todayPicks.filter((pick) => pick.edgePresentation !== "fallback");
  const updatedMinutes = Math.max(1, Math.round((Date.now() - lastRefreshed.getTime()) / 60000));
  const performanceMetrics = [
    { label: "Record", value: stats.total ? `${stats.wins}-${stats.losses}` : "—" },
    { label: "Win Rate", value: stats.total ? `${stats.hitRate}%` : "—" },
    { label: "ROI", value: stats.total ? `${stats.roi > 0 ? "+" : ""}${stats.roi}%` : "—" },
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

      

      <div className="w-full max-w-[430px] mx-auto px-5 pt-4 pb-6 space-y-5 relative">
        <div className="vision-orb w-64 h-64 -top-24 -right-28 opacity-70" style={{ background: 'hsl(250 76% 62%)' }} />
        <div className="vision-orb w-44 h-44 top-[760px] -left-24 opacity-45" style={{ background: 'hsl(250 76% 62%)', animationDelay: '-3s' }} />

        <motion.div {...stagger(0)} className="relative z-10">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-accent/85">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-1 text-[29px] font-extrabold text-foreground tracking-tight">
            {getGreeting()}, {resolveDisplayName(profile, user, "Player")}
          </h1>
          <p className="hidden">A focused view of today’s model-supported opportunities.</p>
        </motion.div>

        {(picksLoading || verifiedDailyEdges.length > 0) && (
          <motion.section {...stagger(0.5)} className="relative z-10 -mx-5 overflow-hidden">
          <div className="mb-3 flex items-end justify-between px-5">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-accent">Today’s best opportunity</p>
              <h2 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">Daily Edge</h2>
            </div>
            <span className="mb-1 text-[10px] font-medium text-muted-foreground/55">Updated {updatedMinutes}m ago</span>
          </div>

          {picksLoading ? (
            <div className="mx-5 h-[236px] animate-pulse rounded-[26px] bg-secondary/25" />
          ) : (
            <>
              <div
                className="flex gap-3 overflow-x-auto px-5 pb-3 hide-scrollbar snap-x snap-mandatory"
                onScroll={(event) => {
                  const cardWidth = event.currentTarget.clientWidth * 0.86 + 12;
                  setActiveDailyEdge(Math.min(verifiedDailyEdges.length - 1, Math.max(0, Math.round(event.currentTarget.scrollLeft / cardWidth))));
                }}
              >
                {verifiedDailyEdges.map((pick, index) => {
                  const isGameBet = Boolean(pick.bet_type && pick.bet_type !== "prop");
                  const score = Math.round(modelScorePercent(pick));
                  const verdict = normalizeVerdict(pick.verdict, score);
                  const title = isGameBet
                    ? `${pick.away_team || pick.opponent || ""} @ ${pick.home_team || pick.team || ""}`
                    : pick.player_name;
                  const matchup = isGameBet
                    ? formatPickLabel(pick)
                    : `${pick.team || "Team"}${pick.opponent ? ` vs ${pick.opponent}` : ""} · ${formatPickLabel(pick)}`;
                  return (
                    <motion.article
                      key={`${pick.id}-daily-${index}`}
                      initial={{ opacity: 0, x: 18 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 + index * 0.05 }}
                      className="relative w-[86vw] max-w-[360px] min-w-[86vw] shrink-0 snap-start overflow-hidden rounded-[26px] p-5"
                      style={{ background: 'radial-gradient(circle at 100% 0%, hsla(250,76%,62%,0.36), transparent 40%), radial-gradient(circle at 0% 100%, hsla(210,100%,60%,0.15), transparent 45%), linear-gradient(145deg, hsl(250 28% 15%), hsl(228 30% 8%) 72%)', boxShadow: '0 18px 40px -24px hsla(250,76%,62%,0.8), inset 0 1px 0 hsla(250,90%,90%,0.1)' }}
                    >
                      <div className="absolute -right-8 bottom-[-72px] h-44 w-44 rounded-full opacity-40 blur-3xl" style={{ background: 'hsl(250 76% 62%)' }} />
                      <div className="relative">
                        <div className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-accent"><Flame className="h-3 w-3" /> Daily Edge</span>
                          <span className="text-[9px] font-semibold text-muted-foreground/55">{index + 1} of {verifiedDailyEdges.length}</span>
                        </div>
                        <div className="mt-6 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-accent/80">{(pick.sport || "Sentinel").toUpperCase()}</p>
                            <h3 className="mt-2 text-[24px] font-extrabold leading-[1.05] tracking-tight text-foreground">{title}</h3>
                            <p className="mt-2 text-[12px] font-medium text-muted-foreground/75">{matchup}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-2xl font-black tabular-nums text-foreground">{score}%</p>
                            <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-muted-foreground/55">Confidence</p>
                          </div>
                        </div>
                        <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent">{verdict}</span>
                          <span className="text-[10px] font-semibold text-muted-foreground/65">{pick.odds ? formatOddsFn(pick.odds) : "â€”"}</span>
                        </div>
                        <div className="mt-4 flex gap-2">
                          <button type="button" onClick={() => navigate("/dashboard/picks")} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[11px] font-bold text-white active:scale-[0.98]" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(220 100% 62%))', boxShadow: '0 10px 20px -12px hsla(250,76%,62%,0.8)' }}>
                            View Daily Edge <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => navigate("/dashboard/analyze")} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-accent" style={{ background: 'hsla(228,25%,7%,0.52)' }} aria-label="Open analysis"><BarChart3 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
              {verifiedDailyEdges.length > 1 && (
                <div className="flex justify-center gap-1.5">
                  {verifiedDailyEdges.map((pick, index) => <span key={`${pick.id}-dot`} className="h-1.5 rounded-full transition-all" style={{ width: index === activeDailyEdge ? 18 : 6, background: index === activeDailyEdge ? 'hsl(250 76% 68%)' : 'hsla(250,30%,70%,0.26)' }} />)}
                </div>
              )}
            </>
          )}
          </motion.section>
        )}

        <motion.nav {...stagger(0.85)} aria-label="Explore Sentinel" className="relative z-10 border-y border-white/[0.06] py-2.5">
          <div className="flex items-center justify-between gap-2">
            {quickLinks.map((link, index) => (
              <motion.button
                key={link.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.04 }}
                onClick={() => navigate(link.path)}
                whileTap={{ scale: 0.93 }}
                className="flex min-w-0 flex-1 flex-col items-center gap-1 py-1 text-muted-foreground/65 transition-colors active:text-accent"
              >
                <span className="flex h-8 w-8 items-center justify-center text-accent"><link.icon className="h-4 w-4" /></span>
                <span className="text-[9px] font-bold tracking-wide text-foreground/75">{link.label}</span>
              </motion.button>
            ))}
          </div>
        </motion.nav>

        <motion.div {...stagger(1)} className="relative z-10">
          <div className="flex items-center justify-between border-b border-white/[0.07] pb-2.5 mb-0">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-accent" style={{ animation: 'pulse-fire 3s ease-in-out infinite' }} />
              <span className="text-xs font-bold tracking-[0.15em] uppercase text-foreground">Today's Edge Lineup</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/45">
                {lineupScanPending ? "Analyzing live slate…" : `${todayPicks.length} available · ${updatedMinutes}m ago`}
              </span>
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
              <p className="text-[11px] text-muted-foreground/65 mb-1">
                {lineupError
                  ? lineupError
                  : lineupScanPending
                    ? "Sentinel is analyzing today’s live slate."
                    : "No model-supported picks are available yet."}
              </p>
              <p className="text-[10px] text-muted-foreground/35">
                {lineupScanPending
                  ? "Only analyzer-finalized plays will appear here."
                  : "Run a fresh analysis to check every eligible live market."}
              </p>
              <button
                type="button"
                onClick={() => { void requestTodayLineup(); }}
                disabled={lineupScanPending}
                className="mt-4 inline-flex h-10 items-center justify-center rounded-xl px-4 text-[11px] font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-55"
                style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(220 100% 62%))' }}
              >
                {lineupScanPending ? "Analyzing slate…" : lineupError ? "Try again" : "Analyze today’s slate"}
              </button>
            </div>
          ) : (
            <>
            <div
              className="-mx-5 overflow-x-auto px-5 pb-2 hide-scrollbar snap-x snap-mandatory"
              onScroll={(event) => {
                const cardWidth = event.currentTarget.clientWidth * 0.84 + 12;
                setActiveLineupIndex(Math.min(todayPicks.length - 1, Math.max(0, Math.round(event.currentTarget.scrollLeft / cardWidth))));
              }}
            >
              <div className="flex gap-3">
                {todayPicks.map((pick, i) => {
                  const isGameBet = pick.bet_type && pick.bet_type !== 'prop';
                  const isFallbackEdge = pick.edgePresentation === "fallback";
                  const isLineupsPending = isFallbackEdge && pick.edgeWarning === "lineups_pending";
                  const confPercent = Math.round(modelScorePercent(pick));
                  const canonicalVerdict = normalizeVerdict(pick.verdict, confPercent);
                  const resultRaw = String(pick.result ?? "pending").toLowerCase();
                  const statusBadge =
                    resultRaw === "hit" || resultRaw === "win"
                      ? { label: "HIT", color: "hsl(142 100% 50%)" }
                      : resultRaw === "miss" || resultRaw === "loss"
                      ? { label: "MISS", color: "hsl(0 90% 60%)" }
                      : resultRaw === "push"
                      ? { label: "PUSH", color: "hsl(45 90% 55%)" }
                      : { label: "PENDING", color: "hsl(220 15% 65%)" };
                  const logoTeam = isGameBet ? selectedTeamForGameLogo(pick) : "";
                  const sportRaw = (pick.sport || "nba").toLowerCase();
                  const supportedLogoSports = ["nba", "wnba", "mlb", "nhl", "nfl"];
                  const logoSport = supportedLogoSports.includes(sportRaw)
                    ? sportRaw as "nba" | "wnba" | "mlb" | "nhl" | "nfl"
                    : null;
                  const gameLogo = logoSport && logoTeam
                    ? getTeamLogoUrl(logoTeam, logoSport)
                    : "";
                  return (
                  <motion.div
                    key={`${pick.id}-${i}`}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.06 }}
                    className="relative flex min-h-[210px] w-[84vw] max-w-[360px] shrink-0 snap-start flex-col overflow-hidden rounded-[22px] border border-white/[0.08]"
                    style={{
                      padding: '16px',
                      background: 'radial-gradient(circle at 100% 0%, hsla(250, 76%, 62%, 0.28), transparent 43%), linear-gradient(145deg, hsl(250 30% 16%), hsl(228 28% 8%) 72%)',
                      boxShadow: 'inset 0 1px 0 hsla(250, 90%, 94%, 0.08), 0 18px 34px -28px hsla(250, 76%, 62%, 0.92)',
                    }}
                  >

                    {/* HEADER ROW */}
                    <div className="relative z-10 flex items-start gap-3">
                      {/* Left: Recommended team logo or player headshot */}
                      <div style={{
                        width: 48, height: 48, borderRadius: 15, overflow: 'hidden',
                        border: `1px solid ${isGameBet ? 'rgba(124,111,247,0.26)' : '#302b58'}`,
                        flexShrink: 0, position: 'relative',
                        background: isGameBet
                          ? 'radial-gradient(circle at 50% 35%, rgba(124,111,247,0.18), transparent 68%), #201d38'
                          : '#252340',
                        boxShadow: isGameBet ? 'inset 0 1px 0 rgba(255,255,255,0.05)' : 'none',
                      }}>
                        {isGameBet ? (() => {
                          const sportRaw = (pick.sport || 'nba').toLowerCase();
                          const supported = ['nba', 'wnba', 'mlb', 'nhl', 'nfl'];
                          const sportKey = (supported.includes(sportRaw) ? sportRaw : null) as 'nba' | 'wnba' | 'mlb' | 'nhl' | 'nfl' | null;
                          const selectedLogo = sportKey ? getTeamLogoUrl(logoTeam, sportKey) : '';
                          if (sportKey && selectedLogo) {
                            return (
                              <div style={{
                                width: '100%', height: '100%',
                                display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                padding: 4,
                              }}>
                                {selectedLogo && (
                                  <img
                                    src={selectedLogo}
                                    alt={`${logoTeam} logo`}
                                    style={{ width: 38, height: 38, objectFit: 'contain', filter: 'drop-shadow(0 5px 8px rgba(0,0,0,0.34))' }}
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
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          <span style={{
                            display: 'inline-block',
                            color: '#a9a3f9',
                            fontSize: 9, fontWeight: 700, letterSpacing: 1,
                            borderRadius: 20, padding: '2px 8px',
                          }}>{(pick.sport || 'NBA').toUpperCase()}</span>
                          <span style={{
                            display: 'none',
                            background: `${statusBadge.color}1f`,
                            color: statusBadge.color,
                            fontSize: 10, fontWeight: 700, letterSpacing: 1,
                            borderRadius: 20, padding: '2px 8px',
                            border: `1px solid ${statusBadge.color}40`,
                          }}>{statusBadge.label}</span>
                          {isGameBet && (
                            <span style={{
                              display: 'none',
                              background: 'hsla(190,90%,55%,0.15)', color: '#22d3ee',
                              fontSize: 10, fontWeight: 700, letterSpacing: 1,
                              borderRadius: 20, padding: '2px 8px',
                              border: '1px solid hsla(190,90%,55%,0.25)',
                            }}>
                              {pick.bet_type === 'moneyline' ? 'ML' : pick.bet_type === 'spread' ? 'SPREAD' : 'O/U'}
                            </span>
                          )}
                          {isFallbackEdge && (
                            <span style={{
                              display: 'none',
                              background: 'hsla(45,93%,58%,0.12)', color: 'hsl(45 93% 58%)',
                              fontSize: 8, fontWeight: 800, letterSpacing: 0.8,
                              borderRadius: 20, padding: '2px 7px',
                              border: '1px solid hsla(45,93%,58%,0.28)',
                            }}>
                              UNCALIBRATED MODEL LEAN
                            </span>
                          )}
                          {isLineupsPending && (
                            <span style={{
                              display: 'none',
                              background: 'hsla(30,100%,55%,0.12)', color: 'hsl(30 100% 62%)',
                              fontSize: 8, fontWeight: 800, letterSpacing: 0.8,
                              borderRadius: 20, padding: '2px 7px',
                              border: '1px solid hsla(30,100%,55%,0.28)',
                            }}>
                              LINEUPS PENDING
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

                      <CompactScore rate={confPercent} isModelScore={isFallbackEdge} />
                    </div>

                    {/* VERDICT BADGE */}
                    {(() => {
                      const label = canonicalVerdict;
                      const ou = pick.bet_type === 'over_under'
                        ? (pick.direction === "over" ? "OVER" : "UNDER")
                        : pick.bet_type === 'moneyline'
                          ? pick.player_name
                          : pick.bet_type === 'spread'
                            ? `${pick.direction === 'home' ? (pick.home_team || pick.team) : (pick.away_team || pick.opponent)} ${pick.spread_line && pick.spread_line > 0 ? '+' : ''}${pick.spread_line}`
                            : (pick.direction === "over" ? "OVER" : "UNDER");
                      const colorMap: Record<string, string> = {
                        'STRONG': '#22c55e', 'LEAN': '#22d3ee', 'RISKY': '#f59e0b', 'PASS': '#ef4444',
                      };
                      const dotColor = colorMap[label] || '#ef4444';
                      const bgColor = dotColor.replace('#', '').match(/.{2}/g)!;
                      const r = parseInt(bgColor[0], 16), g = parseInt(bgColor[1], 16), b = parseInt(bgColor[2], 16);
                      const badgeText = isLineupsPending ? 'LINEUPS PENDING' : isFallbackEdge ? 'MODEL LEAN' : label;
                      return (
                        <div className="relative z-10" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: 'transparent', border: 'none',
                          borderRadius: 20, padding: '1px 0', marginTop: 14, alignSelf: 'flex-start', maxWidth: '100%',
                        }}>
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor }} />
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: 1.2,
                            color: dotColor, textTransform: 'uppercase', lineHeight: 1.35,
                          }}>{badgeText}</span>
                        </div>
                      );
                    })()}

                    {/* STAT + ODDS ROW */}
                    <div className="relative z-10" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 6 }}>
                      <span style={{
                        color: '#c5c1e3', padding: 0,
                        fontSize: 12, fontWeight: 600,
                        flex: '1 1 auto', minWidth: 0,
                      }}>
                        {isGameBet
                          ? pick.bet_type === 'moneyline'
                            ? `Winner: ${pick.player_name}`
                            : pick.bet_type === 'spread'
                              ? `Spread ${pick.spread_line && pick.spread_line > 0 ? '+' : ''}${pick.spread_line}`
                              : `${pick.direction === "over" ? "Over" : "Under"} ${pick.total_line}`
                          : `${pick.direction === "over" ? "Over" : "Under"} ${pick.line} ${formatPropType(pick.prop_type)}`
                        }
                      </span>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#f0eeff', whiteSpace: 'nowrap' }}>{pick.odds ? formatOddsFn(pick.odds) : "—"}</div>
                      </div>
                    </div>

                    {isFallbackEdge && (
                      <p className="hidden relative z-10" style={{
                        fontSize: 9.5, color: 'hsl(45 90% 62%)', lineHeight: 1.45,
                        marginBottom: -5,
                      }}>
                        Model lean only. The score and any simulation figures below are not validated win probabilities.
                      </p>
                    )}

                    {/* AI NARRATIVE */}
                    {pick.reasoning && (
                      <p className="hidden relative z-10" style={{
                        fontStyle: 'italic', fontSize: 12, color: '#aaa6cf',
                        lineHeight: 1.6, overflow: 'hidden',
                        display: 'none', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                        marginBottom: 0,
                      }}>
                        {pick.reasoning?.replace(/^\[VERDICT:[^\]]+\]\s*/i, '').replace(/NaN%/g, 'N/A')}
                      </p>
                    )}

                    {/* BUTTONS */}
                    <div className="relative z-10 mt-auto grid grid-cols-2 gap-2 border-t border-white/[0.08] pt-3">
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
                                entrySource: 'todays_edge' as const,
                                daily_picks_id: pick.id,
                                sport: pick.sport,
                                player: pick.player_name,
                                prop_type: pick.prop_type,
                                line: Number(pick.line),
                                over_under: pick.direction,
                                opponent: pick.opponent || '',
                                pick_snapshot: {
                                  // phase-c.v1: always percent-scale so every reader agrees
                                  confidence: confPercent,
                                  verdict: canonicalVerdict,
                                  hit_rate: pick.hit_rate ?? null,
                                  confidenceSource: pick.sport === 'nba' ? 'analyzer' as const : 'scanner' as const,
                                  sourceContractVersion: 'canonical.v1' as const,
                                  reasoning: pick.reasoning ?? null,
                                  avg_value: (pick as any).avg_value ?? null,
                                  odds: pick.odds ?? null,
                                  tier: pick.tier ?? null,
                                  team: pick.team ?? null,
                                  opponent: pick.opponent ?? null,
                                  prop_type: pick.prop_type,
                                  line: pick.line,
                                  direction: pick.direction,
                                  model_diagnostics: pick.model_diagnostics ?? null,
                                  score_kind: pick.score_kind,
                                  calibration_status: pick.calibration_status,
                                  calibrated_probability: pick.calibrated_probability,
                                },
                              },
                            });
                          }
                        }}
                        className="flex items-center justify-center active:opacity-70"
                        style={{
                          height: 38, borderRadius: 11,
                          fontSize: 11, fontWeight: 600,
                          background: 'hsla(250, 28%, 10%, 0.62)', border: '1px solid hsla(250, 55%, 68%, 0.2)', color: '#c4c0ff',
                        }}
                      >
                        Details
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
                          height: 38, borderRadius: 11,
                          fontSize: 11, fontWeight: 600,
                          background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(224 86% 66%))', color: '#f0eeff',
                        }}
                      >
                        Add to Slip
                      </button>
                    </div>
                  </motion.div>
                  );
                })}
              </div>
            </div>
            {todayPicks.length > 1 && (
              <div className="mt-1 flex justify-center gap-1.5">
                {todayPicks.map((pick, index) => (
                  <span
                    key={`${pick.id}-lineup-dot`}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: index === activeLineupIndex ? 16 : 6,
                      background: index === activeLineupIndex ? 'hsl(250 76% 68%)' : 'hsla(250,30%,70%,0.26)',
                    }}
                  />
                ))}
              </div>
            )}
            </>
          )}
        </motion.div>

        <motion.section {...stagger(2)} className="relative z-10 w-full min-w-0 border-t border-white/[0.07] pt-5">
          <div className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full opacity-[0.04] pointer-events-none"
            style={{ background: 'radial-gradient(circle, hsl(142 71% 45%), transparent)' }} />
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase mb-3" style={{ color: 'hsl(142 100% 50%)' }}>
            {yesterdayPending.length > 0 ? "Yesterday's Edge" : "Yesterday's Edge Results"}
          </p>
          {hasYesterdayData ? (
            <>
              <div className="space-y-0">
                {yesterdayGraded
                  .slice(0, 10)
                  .map(pick => {
                    const isHit = pick.result === "hit";
                    const pickLabel = formatPickLabel(pick);
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
                          {pickLabel} — {isHit ? "HIT" : "MISS"}
                        </span>
                      </div>
                    );
                  })}
                {yesterdayPending.slice(0, yesterdayPendingVisibleLimit).map(pick => {
                  const pickLabel = formatPickLabel(pick);
                  return (
                    <div key={pick.id} className="flex items-center justify-between py-2.5 last:border-0" style={{ borderBottom: '1px solid hsl(250 20% 18% / 0.4)' }}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-4 h-4 shrink-0 rounded-full" style={{ border: '2px solid hsl(45 93% 58%)', background: 'transparent' }} />
                        <span className="truncate" style={{ fontSize: 13, fontWeight: 700, color: 'hsl(250 80% 97%)' }}>{pick.player_name}</span>
                      </div>
                      <span className="tabular-nums shrink-0 ml-2" style={{ fontSize: 11, fontWeight: 700, color: 'hsl(45 93% 58%)' }}>
                        {pickLabel} — PENDING
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
                  {yesterdayPending.length > yesterdayPendingVisibleLimit
                    ? `Showing ${yesterdayPendingVisibleLimit} of ${yesterdayPending.length} pending edge picks - games in progress`
                    : `${yesterdayPending.length} edge pick${yesterdayPending.length > 1 ? "s" : ""} still pending - games in progress`}
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
                <p style={{ fontSize: 13, fontWeight: 700, color: 'hsl(250 80% 97%)' }}>No edge yesterday</p>
                <p style={{ fontSize: 11, color: 'hsl(250 15% 50%)', lineHeight: 1.4 }}>No Today's Edge picks were generated yesterday.</p>
              </div>
            </div>
          )}
        </motion.section>

        <PnLCalendar plays={plays} />

      </div>
      <AddToSlipSheet open={slipSheetOpen} onOpenChange={setSlipSheetOpen} pick={slipSheetPick} />
    </div>
  );
}

