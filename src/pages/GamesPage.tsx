import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import logoNba from "@/assets/logo-nba.png";
import logoMlb from "@/assets/logo-mlb.png";
import logoNhl from "@/assets/logo-nhl.png";
import logoNfl from "@/assets/logo-nfl.png";
import logoUfc from "@/assets/logo-ufc.png";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Clock, Loader2, Calendar, Bell, BellOff, RefreshCw, Swords, Search, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

import { useAuth } from "@/contexts/AuthContext";
import { useOddsFormat } from "@/hooks/useOddsFormat";
import { supabase } from "@/integrations/supabase/client";
import { fetchNbaOdds } from "@/services/oddsApi";
import { getTeamLogoUrl } from "@/utils/teamLogos";
import { toast } from "sonner";

type SportFilter = "nba" | "mlb" | "ufc" | "nhl" | "nfl";

interface Game {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  status?: string;
  status_detail?: string;
  short_detail?: string;
  display_clock?: string;
  period?: number;
  score?: { home: string | null; away: string | null };
}

interface UfcFight {
  id: string;
  fighter1: string;
  fighter2: string;
  fighter1Id?: string;
  fighter2Id?: string;
  weightClass: string;
  cardType: string;
  time: string;
  isMainEvent: boolean;
}

interface UfcEvent {
  name: string;
  date: string;
  venue: string;
  fights: UfcFight[];
}

const SPORT_MAP: Record<Exclude<SportFilter, "ufc">, string> = {
  nba: "basketball_nba",
  mlb: "baseball_mlb",
  nhl: "icehockey_nhl",
  nfl: "americanfootball_nfl",
};

const SPORT_LOGO: Record<SportFilter, string> = {
  nba: logoNba,
  mlb: logoMlb,
  ufc: logoUfc,
  nhl: logoNhl,
  nfl: logoNfl,
};

const SPORT_LOGO_SIZE: Record<SportFilter, string> = {
  nba: "w-7 h-7",
  mlb: "w-6 h-6",
  nhl: "w-6 h-6",
  nfl: "w-6 h-6",
  ufc: "w-6 h-6",
};

const CARD_ORDER = ["Main Card", "Prelims", "Early Prelims"];

/* ── EV calculation ── */
function impliedProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function calcEV(odds: number, fairProb: number): number {
  // EV = (fairProb * payout) - (1 - fairProb) * stake
  // For $100 stake:
  const payout = odds > 0 ? odds : 100 / Math.abs(odds) * 100;
  return fairProb * payout - (1 - fairProb) * 100;
}

interface RealOdds {
  homeML: number | null;
  awayML: number | null;
  homeSpread: number | null;
  homeSpreadOdds: number | null;
  awaySpread: number | null;
  awaySpreadOdds: number | null;
  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;
  homeEV: number | null;
  awayEV: number | null;
  books: string[];
}

const stagger = (i: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.06, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
});

const GamesPage = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { fmt } = useOddsFormat();
  const tz = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [sport, setSport] = useState<SportFilter>("nba");
  const [games, setGames] = useState<Game[]>([]);
  const [ufcEvents, setUfcEvents] = useState<UfcEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [oddsMap, setOddsMap] = useState<Record<string, RealOdds>>({});
  const [notifiedGames, setNotifiedGames] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("sentinel_game_notifications");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const notifTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fetchAbort = useRef<AbortController | null>(null);

  // Per-sport cache to enable instant switching
  const sportCache = useRef<Partial<Record<SportFilter, { games: Game[]; ufcEvents: UfcEvent[]; oddsMap: Record<string, RealOdds> }>>>({});


  // Sync notifiedGames to localStorage & schedule/clear notifications
  useEffect(() => {
    localStorage.setItem("sentinel_game_notifications", JSON.stringify([...notifiedGames]));
  }, [notifiedGames]);

  const scheduleNotification = useCallback((gameId: string, title: string, commenceTime: string) => {
    if (notifTimeouts.current.has(gameId)) return;
    const gameMs = new Date(commenceTime).getTime();
    const delay = gameMs - 10 * 60 * 1000 - Date.now(); // 10 min before
    if (delay <= 0) {
      // Game already started or within 10 min — fire immediately
      if (Notification.permission === "granted") {
        new Notification("🏟️ Game Starting Soon!", { body: title, icon: "/placeholder.svg" });
      }
      return;
    }
    const tid = setTimeout(() => {
      if (Notification.permission === "granted") {
        new Notification("🏟️ Game Starting Soon!", { body: `${title} starts in 10 minutes!`, icon: "/placeholder.svg" });
      }
      notifTimeouts.current.delete(gameId);
    }, delay);
    notifTimeouts.current.set(gameId, tid);
  }, []);

  const clearScheduledNotification = useCallback((gameId: string) => {
    const tid = notifTimeouts.current.get(gameId);
    if (tid) { clearTimeout(tid); notifTimeouts.current.delete(gameId); }
  }, []);

  const fetchOdds = async (s: SportFilter, signal?: AbortSignal): Promise<Record<string, RealOdds>> => {
    try {
      const sportKey = s === "ufc" ? "mma_mixed_martial_arts" : SPORT_MAP[s as Exclude<SportFilter, "ufc">];
      const data = await fetchNbaOdds(undefined, "h2h,spreads,totals", sportKey);
      if (signal?.aborted) return {};
      const events: any[] = data?.events || data || [];
      const map: Record<string, RealOdds> = {};

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

      for (const ev of events) {
        const bookmakers = ev.bookmakers || [];
        if (!bookmakers.length) continue;

        let bestHomeML: number | null = null;
        let bestAwayML: number | null = null;
        let homeSpread: number | null = null;
        let homeSpreadOdds: number | null = null;
        let awaySpread: number | null = null;
        let awaySpreadOdds: number | null = null;
        let totalLine: number | null = null;
        let overOdds: number | null = null;
        let underOdds: number | null = null;
        const allHomeMLs: number[] = [];
        const allAwayMLs: number[] = [];
        const books: string[] = [];

        for (const bm of bookmakers) {
          if (!books.includes(bm.title)) books.push(bm.title);
          for (const market of bm.markets || []) {
            if (market.key === "h2h") {
              for (const o of market.outcomes || []) {
                const n = normalize(o.name);
                const isHome = normalize(ev.home_team || "").includes(n) || n.includes(normalize(ev.home_team || ""));
                if (isHome || o.name === ev.home_team) {
                  allHomeMLs.push(o.price);
                  if (bestHomeML === null || o.price > bestHomeML) bestHomeML = o.price;
                } else {
                  allAwayMLs.push(o.price);
                  if (bestAwayML === null || o.price > bestAwayML) bestAwayML = o.price;
                }
              }
            }
            if (market.key === "spreads" && homeSpread === null) {
              for (const o of market.outcomes || []) {
                const n = normalize(o.name);
                const isHome = normalize(ev.home_team || "").includes(n) || n.includes(normalize(ev.home_team || ""));
                if (isHome || o.name === ev.home_team) {
                  homeSpread = o.point ?? null;
                  homeSpreadOdds = o.price;
                } else {
                  awaySpread = o.point ?? null;
                  awaySpreadOdds = o.price;
                }
              }
            }
            if (market.key === "totals" && totalLine === null) {
              for (const o of market.outcomes || []) {
                if (o.name === "Over") { totalLine = o.point ?? null; overOdds = o.price; }
                if (o.name === "Under") { underOdds = o.price; }
              }
            }
          }
        }

        let homeEV: number | null = null;
        let awayEV: number | null = null;
        if (allHomeMLs.length >= 2 && bestHomeML !== null) {
          const avgHomeProb = allHomeMLs.reduce((s, o) => s + impliedProb(o), 0) / allHomeMLs.length;
          homeEV = Math.round(calcEV(bestHomeML, avgHomeProb) * 10) / 10;
        }
        if (allAwayMLs.length >= 2 && bestAwayML !== null) {
          const avgAwayProb = allAwayMLs.reduce((s, o) => s + impliedProb(o), 0) / allAwayMLs.length;
          awayEV = Math.round(calcEV(bestAwayML, avgAwayProb) * 10) / 10;
        }

        const key = normalize(ev.home_team || "") + "|" + normalize(ev.away_team || "");
        map[key] = {
          homeML: bestHomeML, awayML: bestAwayML,
          homeSpread, homeSpreadOdds, awaySpread, awaySpreadOdds,
          totalLine, overOdds, underOdds,
          homeEV, awayEV, books,
        };
      }
      if (signal?.aborted) return {};
      return map;
    } catch (e) {
      console.warn("Failed to fetch odds:", e);
      return {};
    }
  };

  const fetchGames = async (s: SportFilter, silent = false, force = false) => {
    // If cached and not forced, restore instantly
    if (!force && !silent && sportCache.current[s]) {
      const cached = sportCache.current[s]!;
      setGames(cached.games);
      setUfcEvents(cached.ufcEvents);
      setOddsMap(cached.oddsMap);
      setLoading(false);
      setError("");
      return;
    }

    // Cancel any in-flight request so stale data from a previous sport never overwrites
    if (fetchAbort.current) fetchAbort.current.abort();
    const controller = new AbortController();
    fetchAbort.current = controller;

    if (!silent) {
      setLoading(true);
      setGames([]);
      setUfcEvents([]);
    }
    setError("");
    try {
      if (s === "ufc") {
        const [ufcResult, oddsResult] = await Promise.all([
          fetchUfcEvents(controller.signal),
          fetchOdds(s, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setUfcEvents(ufcResult.events);
        setGames([]);
        setOddsMap(oddsResult);
        if (ufcResult.error) setError(ufcResult.error);
        // Cache under the sport param, not state
        sportCache.current[s] = { games: [], ufcEvents: ufcResult.events, oddsMap: oddsResult };
      } else {
        const [{ data, error: fnError }, oddsResult] = await Promise.all([
          supabase.functions.invoke("games-schedule", {
            body: { sport: SPORT_MAP[s as Exclude<SportFilter, "ufc">] },
          }),
          fetchOdds(s, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (fnError) throw fnError;
        const newGames = data?.error ? [] : (Array.isArray(data) ? data : []);
        if (data?.error) setError(data.error);
        setGames(newGames);
        setOddsMap(oddsResult);
        // Cache under the sport param, not state
        sportCache.current[s] = { games: newGames, ufcEvents: [], oddsMap: oddsResult };
      }
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setError("Failed to load games");
      setGames([]);
    } finally {
      if (!controller.signal.aborted && !silent) setLoading(false);
    }
  };

  const fetchUfcEvents = async (signal?: AbortSignal) => {
    try {
      // ESPN UFC scoreboard requires exact dates — query today + next 4 weeks (Saturdays & surrounding days)
      const now = new Date();
      const datesToCheck: string[] = [];
      for (let i = 0; i < 35; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        // UFC events are typically Fri/Sat, but check all days to be safe — limit to 8 unique queries
        const ds = d.toISOString().slice(0, 10).replace(/-/g, "");
        datesToCheck.push(ds);
      }
      // Only check every other day to limit requests, plus today
      const sparseChecks = [datesToCheck[0]];
      for (let i = 1; i < datesToCheck.length; i += 2) {
        sparseChecks.push(datesToCheck[i]);
      }
      // Cap at 10 parallel requests
      const checkDates = sparseChecks.slice(0, 10);

      const responses = await Promise.all(
        checkDates.map((d) =>
          fetch(`https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=${d}`)
            .then((r) => r.json())
            .catch(() => ({ events: [] }))
        )
      );

      // Merge all events, deduplicate by id
      const allRawEvents: any[] = [];
      const seenIds = new Set<string>();
      for (const resp of responses) {
        for (const ev of resp?.events || []) {
          if (ev?.id && !seenIds.has(ev.id)) {
            seenIds.add(ev.id);
            allRawEvents.push(ev);
          }
        }
      }
      
      // Filter to only upcoming or in-progress events (not completed ones)
      const upcomingRaw = allRawEvents.filter(ev => {
        const status = ev?.status?.type?.name || ev?.competitions?.[0]?.status?.type?.name || "";
        // Keep if not completed, or if event date is in the future
        if (status === "STATUS_FINAL" || status === "STATUS_POSTPONED") {
          return false;
        }
        const eventDate = new Date(ev?.date || ev?.competitions?.[0]?.date || "");
        // Also include if the event ended less than 6 hours ago (grace period for viewing results)
        return eventDate.getTime() > now.getTime() - 6 * 60 * 60 * 1000;
      });
      
      // If no upcoming, fall back to the next scheduled event even if it has no fights listed yet
      const eventsToUse = upcomingRaw.length > 0 ? upcomingRaw : allRawEvents.filter(ev => {
        const eventDate = new Date(ev?.date || "");
        return eventDate.getTime() > now.getTime();
      }).slice(0, 1);
      
      // If still nothing, show the most recent event
      const finalEvents = eventsToUse.length > 0 ? eventsToUse : allRawEvents.slice(0, 1);

      const events: UfcEvent[] = [];

      for (const event of finalEvents) {
        const fights: UfcFight[] = [];
        const competitions = event?.competitions || [];

        const timestampSet = new Set<number>();
        for (const comp of competitions) {
          if (comp?.date) {
            const ts = Math.floor(new Date(comp.date).getTime() / 60000);
            timestampSet.add(ts);
          }
        }
        const sortedTimestamps = Array.from(timestampSet).sort((a, b) => a - b);

        const tsToCard: Record<number, string> = {};
        if (sortedTimestamps.length >= 3) {
          sortedTimestamps.forEach((ts, i) => {
            if (i < sortedTimestamps.length - 2) tsToCard[ts] = "Early Prelims";
            else if (i < sortedTimestamps.length - 1) tsToCard[ts] = "Prelims";
            else tsToCard[ts] = "Main Card";
          });
        } else if (sortedTimestamps.length === 2) {
          tsToCard[sortedTimestamps[0]] = "Prelims";
          tsToCard[sortedTimestamps[1]] = "Main Card";
        } else if (sortedTimestamps.length === 1) {
          tsToCard[sortedTimestamps[0]] = "Main Card";
        }

        for (const comp of competitions) {
          const competitors = comp?.competitors || [];
          if (competitors.length < 2) continue;

          const f1 = competitors[0]?.athlete?.displayName || competitors[0]?.team?.displayName || "TBD";
          const f2 = competitors[1]?.athlete?.displayName || competitors[1]?.team?.displayName || "TBD";

          const compTs = comp?.date ? Math.floor(new Date(comp.date).getTime() / 60000) : 0;
          const cardType = tsToCard[compTs] || "Main Card";
          const isMainEvent = comp?.notes?.some((n: any) => n?.headline?.toLowerCase().includes("main event")) || false;

          fights.push({
            id: comp.id || `${f1}-${f2}`,
            fighter1: f1,
            fighter2: f2,
            fighter1Id: competitors[0]?.id || undefined,
            fighter2Id: competitors[1]?.id || undefined,
            weightClass: comp?.type?.text || "",
            cardType,
            time: comp?.date || event?.date || "",
            isMainEvent,
          });
        }

        events.push({
          name: event?.name || "UFC Event",
          date: event?.date || "",
          venue: event?.competitions?.[0]?.venue?.fullName || "",
          fights,
        });
      }

      if (signal?.aborted) return { events: [], error: "" };
      return { events, error: "" };
    } catch {
      if (signal?.aborted) return { events: [], error: "" };
      return { events: [], error: "Failed to load UFC events" };
    }
  };

  useEffect(() => { fetchGames(sport); }, [sport]);

  // Auto-refresh: 10s when live games exist, 60s otherwise — silent to avoid spinner flicker
  const hasLiveGames = games.some(g => g.status === "in" || g.status === "halftime");
  useEffect(() => {
    const ms = hasLiveGames ? 10000 : 60000;
    const interval = setInterval(() => {
      fetchGames(sport, true);
    }, ms);
    return () => clearInterval(interval);
  }, [sport, hasLiveGames]);

  const gamesByDate = useMemo(() => {
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
    const grouped: Record<string, Game[]> = {};
    for (const g of games) {
      const dateStr = new Date(g.commence_time).toLocaleDateString("en-CA", { timeZone: tz });
      // Include today and past (for ended games) + future
      if (!grouped[dateStr]) grouped[dateStr] = [];
      grouped[dateStr].push(g);
    }
    // Sort by date key, limit to 7 days
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 7);
  }, [games, tz]);

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      hour12: true,
    });
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: tz,
    });
  };

  const formatFullDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: tz,
    });
  };

  const toggleNotification = async (gameId: string, label: string, commenceTime: string) => {
    if (!("Notification" in window)) { toast.error("Notifications not supported"); return; }
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") { toast.error("Notification permission denied"); return; }

    setNotifiedGames((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
        clearScheduledNotification(gameId);
        toast("Notification removed");
      } else {
        next.add(gameId);
        scheduleNotification(gameId, label, commenceTime);
        toast.success(`Notification set for ${label}`);
      }
      return next;
    });
  };

  const getGameOdds = (game: Game): RealOdds | null => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    const key = normalize(game.home_team) + "|" + normalize(game.away_team);
    if (oddsMap[key]) return oddsMap[key];
    // Try reverse
    const revKey = normalize(game.away_team) + "|" + normalize(game.home_team);
    if (oddsMap[revKey]) return oddsMap[revKey];
    // Fuzzy match
    for (const [k, v] of Object.entries(oddsMap)) {
      const [h, a] = k.split("|");
      if ((normalize(game.home_team).includes(h) || h.includes(normalize(game.home_team))) &&
          (normalize(game.away_team).includes(a) || a.includes(normalize(game.away_team)))) {
        return v;
      }
    }
    return null;
  };

  const GameCard = ({ game, index }: { game: Game; index: number }) => {
    const isNotified = notifiedGames.has(game.id);
    const isLive = game.status === "STATUS_IN_PROGRESS";
    const isEnded = game.status === "STATUS_FINAL" || game.status === "STATUS_POSTPONED";
    const isHalftime = game.status === "STATUS_HALFTIME";
    const hasScore = game.score && (game.score.home !== null || game.score.away !== null);
    const odds = getGameOdds(game);

    const mlColor = (ml: number | null) => !ml ? "#8b87b8" : ml < 0 ? "#f0eeff" : "#22c55e";
    const evColor = (ev: number | null) => !ev ? "transparent" : ev > 0 ? "hsla(142,71%,45%,0.15)" : "hsla(0,72%,51%,0.1)";
    const evTextColor = (ev: number | null) => !ev ? "#8b87b8" : ev > 0 ? "hsl(142,71%,45%)" : "hsl(0,72%,51%)";

    // Determine winner for ended games
    const homeScore = hasScore ? parseInt(game.score!.home || "0") : 0;
    const awayScore = hasScore ? parseInt(game.score!.away || "0") : 0;
    const homeWon = isEnded && homeScore > awayScore;
    const awayWon = isEnded && awayScore > homeScore;

    // Build live period/quarter/inning display
    const getLiveDetail = () => {
      if (game.short_detail) return game.short_detail;
      const period = game.period || 0;
      const clock = game.display_clock || "";
      const sportLower = sport.toLowerCase();
      if (sportLower === "nba" || sportLower === "nfl") return `Q${period}${clock ? ` ${clock}` : ""}`;
      if (sportLower === "nhl") {
        const periodLabel = period === 1 ? "1st" : period === 2 ? "2nd" : period === 3 ? "3rd" : `OT${period - 3}`;
        return `${periodLabel}${clock ? ` ${clock}` : ""}`;
      }
      if (sportLower === "mlb") return `${period <= 9 ? (period % 2 === 1 ? "Top" : "Bot") + " " + Math.ceil(period / 2) : "Extra"}`;
      return `P${period}`;
    };

    const spreadLabel = odds?.homeSpread != null
      ? `${odds.homeSpread > 0 ? "+" : ""}${odds.homeSpread}`
      : "—";
    const totalLabel = odds?.totalLine != null ? `O/U ${odds.totalLine}` : "—";

    return (
      <motion.div {...stagger(index)} className={`vision-card p-4 relative overflow-hidden ${isEnded ? 'opacity-75' : ''}`}>
        {isLive || isHalftime ? (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full" style={{
            background: 'hsla(142, 71%, 45%, 0.12)',
            border: '1px solid hsla(142, 71%, 45%, 0.25)',
            animation: 'live-glow 2.5s ease-in-out infinite',
          }}>
            <div className="w-1.5 h-1.5 rounded-full bg-[hsl(142,71%,45%)]" style={{ animation: 'live-dot 2s ease-in-out infinite' }} />
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: 'hsl(142 71% 45%)' }}>Live</span>
          </div>
        ) : isEnded ? (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full" style={{
            background: 'hsla(250, 20%, 40%, 0.12)',
            border: '1px solid hsla(250, 20%, 40%, 0.25)',
          }}>
            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: 'hsl(250 20% 55%)' }}>Ended</span>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); toggleNotification(game.id, `${game.away_team} vs ${game.home_team}`, game.commence_time); }}
            className="absolute top-3 right-3 z-10 p-1.5 rounded-full transition-all"
            style={{
              background: isNotified ? 'hsla(250, 76%, 62%, 0.15)' : 'transparent',
              border: isNotified ? '1px solid hsla(250, 76%, 62%, 0.3)' : '1px solid transparent',
            }}
          >
            {isNotified ? <Bell className="w-3.5 h-3.5 text-accent" /> : <BellOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
          </button>
        )}

        <div className="flex items-center justify-between mb-3 pr-16">
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-muted-foreground/55" />
            <span className="text-[10px] font-bold text-muted-foreground/65 uppercase tracking-wider">
              {isEnded ? "Final" : isLive || isHalftime ? "Live" : formatTime(game.commence_time)}
            </span>
          </div>
          {(isLive || isHalftime) ? (
            <span className="text-[10px] font-bold whitespace-nowrap shrink-0 ml-2" style={{ color: 'hsl(142 71% 45%)' }}>
              {isHalftime ? "Halftime" : getLiveDetail()}
            </span>
          ) : (
            <span className="text-[10px] font-medium whitespace-nowrap shrink-0 ml-2" style={{ color: "#8b87b8" }}>
              {spreadLabel} · {totalLabel}
            </span>
          )}
        </div>

        {/* Teams + ML */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground/55 uppercase w-8">Away</span>
            {getTeamLogoUrl(game.away_team, sport as "nba" | "mlb" | "nhl" | "nfl") && (
              <img src={getTeamLogoUrl(game.away_team, sport as "nba" | "mlb" | "nhl" | "nfl")} alt="" className="w-5 h-5 object-contain" />
            )}
            <span className={`text-[13px] font-bold flex-1 truncate ${awayWon ? 'text-[hsl(142,71%,45%)]' : 'text-foreground'}`}>{game.away_team}</span>
            {odds?.awayEV != null && !isEnded && !isLive && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: evColor(odds.awayEV), color: evTextColor(odds.awayEV) }}>
                {odds.awayEV > 0 ? "+" : ""}{odds.awayEV}% EV
              </span>
            )}
            <span className="text-[12px] font-bold shrink-0" style={{
              color: (isLive || isEnded) && hasScore
                ? awayWon ? 'hsl(142, 71%, 45%)' : 'hsl(var(--foreground))'
                : mlColor(odds?.awayML ?? null)
            }}>
              {(isLive || isEnded) && hasScore ? game.score!.away ?? '-' : odds?.awayML ? fmt(odds.awayML) : '—'}
            </span>
          </div>
          <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, transparent, hsla(228,18%,15%,0.5), transparent)' }} />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground/55 uppercase w-8">Home</span>
            {getTeamLogoUrl(game.home_team, sport as "nba" | "mlb" | "nhl" | "nfl") && (
              <img src={getTeamLogoUrl(game.home_team, sport as "nba" | "mlb" | "nhl" | "nfl")} alt="" className="w-5 h-5 object-contain" />
            )}
            <span className={`text-[13px] font-bold flex-1 truncate ${homeWon ? 'text-[hsl(142,71%,45%)]' : 'text-foreground'}`}>{game.home_team}</span>
            {odds?.homeEV != null && !isEnded && !isLive && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: evColor(odds.homeEV), color: evTextColor(odds.homeEV) }}>
                {odds.homeEV > 0 ? "+" : ""}{odds.homeEV}% EV
              </span>
            )}
            <span className="text-[12px] font-bold shrink-0" style={{
              color: (isLive || isEnded) && hasScore
                ? homeWon ? 'hsl(142, 71%, 45%)' : 'hsl(var(--foreground))'
                : mlColor(odds?.homeML ?? null)
            }}>
              {(isLive || isEnded) && hasScore ? game.score!.home ?? '-' : odds?.homeML ? fmt(odds.homeML) : '—'}
            </span>
          </div>
        </div>

        {/* Odds details row: Spread + O/U with actual odds */}
        {odds && !isEnded && !isLive && (odds.homeSpread != null || odds.totalLine != null) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {odds.homeSpread != null && (
              <div className="rounded-lg px-2.5 py-1.5" style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.2)' }}>
                <div className="text-[8px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-0.5">Spread</div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-foreground">{spreadLabel}</span>
                  <span className="text-[10px] text-muted-foreground/65">{odds.homeSpreadOdds ? fmt(odds.homeSpreadOdds) : ""}</span>
                </div>
              </div>
            )}
            {odds.totalLine != null && (
              <div className="rounded-lg px-2.5 py-1.5" style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.2)' }}>
                <div className="text-[8px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-0.5">Total</div>
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-foreground">{odds.totalLine}</span>
                  <span className="text-[10px] text-muted-foreground/65">
                    O {odds.overOdds ? fmt(odds.overOdds) : "—"} / U {odds.underOdds ? fmt(odds.underOdds) : "—"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => navigate("/dashboard/moneyline", { state: { home_team: game.home_team, away_team: game.away_team, sport, autoAnalyze: true } })}
          className="mt-3 w-full flex items-center justify-center gap-2 transition-all hover:opacity-80"
          style={{
            background: "#1a1735",
            border: "1px solid #2d2a52",
            borderRadius: "10px",
            color: "#8b87b8",
            fontSize: "13px",
            height: "36px",
          }}
        >
          <Search className="w-3.5 h-3.5" />
          Analyze Matchup
        </button>
      </motion.div>
    );
  };



  const fighterHeadshot = (id?: string) =>
    id ? `https://a.espncdn.com/combiner/i?img=/i/headshots/mma/players/full/${id}.png&w=160&cb=1` : null;

  const FighterAvatar = ({ id, name }: { id?: string; name: string }) => {
    const src = fighterHeadshot(id);
    return (
      <div className="w-11 h-11 rounded-full bg-secondary/40 border border-border/20 overflow-hidden shrink-0">
        {src ? (
          <img src={src} alt={name} className="w-full h-full object-cover object-top scale-[1.35]" onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center"><span class="text-sm">🥊</span></div>';
          }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-sm">🥊</span>
          </div>
        )}
      </div>
    );
  };

  const getFightOdds = (fighter1: string, fighter2: string): { f1ML: number | null; f2ML: number | null; f1EV: number | null; f2EV: number | null } => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    // UFC odds are stored with fighter names as home/away team in the odds API
    for (const [, v] of Object.entries(oddsMap)) {
      // homeML/awayML map to fighter odds
      if (v.homeML != null || v.awayML != null) {
        // We can't easily match without team names, so we check all entries
        // The odds API returns UFC fights with fighter names as team names
      }
    }
    // Direct lookup by fighter names
    const n1 = normalize(fighter1);
    const n2 = normalize(fighter2);
    for (const [k, v] of Object.entries(oddsMap)) {
      const [h, a] = k.split("|");
      if ((h.includes(n1) || n1.includes(h)) && (a.includes(n2) || n2.includes(a))) {
        return { f1ML: v.homeML, f2ML: v.awayML, f1EV: v.homeEV, f2EV: v.awayEV };
      }
      if ((h.includes(n2) || n2.includes(h)) && (a.includes(n1) || n1.includes(a))) {
        return { f1ML: v.awayML, f2ML: v.homeML, f1EV: v.awayEV, f2EV: v.homeEV };
      }
    }
    // Try last-name match
    const lastName = (s: string) => normalize(s.split(" ").pop() || s);
    const ln1 = lastName(fighter1);
    const ln2 = lastName(fighter2);
    for (const [k, v] of Object.entries(oddsMap)) {
      const [h, a] = k.split("|");
      if (h.includes(ln1) && a.includes(ln2)) {
        return { f1ML: v.homeML, f2ML: v.awayML, f1EV: v.homeEV, f2EV: v.awayEV };
      }
      if (h.includes(ln2) && a.includes(ln1)) {
        return { f1ML: v.awayML, f2ML: v.homeML, f1EV: v.awayEV, f2EV: v.homeEV };
      }
    }
    return { f1ML: null, f2ML: null, f1EV: null, f2EV: null };
  };

  const FightCard = ({ fight, index }: { fight: UfcFight; index: number }) => {
    const isNotified = notifiedGames.has(fight.id);
    const fightLabel = `${fight.fighter1} vs ${fight.fighter2}`;
    const fightOdds = getFightOdds(fight.fighter1, fight.fighter2);
    const evColor = (ev: number | null) => !ev ? "transparent" : ev > 0 ? "hsla(142,71%,45%,0.15)" : "hsla(0,72%,51%,0.1)";
    const evTextColor = (ev: number | null) => !ev ? "#8b87b8" : ev > 0 ? "hsl(142,71%,45%)" : "hsl(0,72%,51%)";
    const mlColor = (ml: number | null) => !ml ? "#8b87b8" : ml < 0 ? "#f0eeff" : "#22c55e";

    return (
    <motion.div {...stagger(index)} className="vision-card p-4 relative overflow-hidden">
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        {fight.isMainEvent && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{
            background: 'hsla(250, 76%, 62%, 0.12)',
            border: '1px solid hsla(250, 76%, 62%, 0.2)',
          }}>
            <span className="text-[8px] font-bold text-accent uppercase tracking-wider">Main Event</span>
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); toggleNotification(fight.id, fightLabel, fight.time); }}
          className="p-1.5 rounded-full transition-all"
          style={{
            background: isNotified ? 'hsla(250, 76%, 62%, 0.15)' : 'transparent',
            border: isNotified ? '1px solid hsla(250, 76%, 62%, 0.3)' : '1px solid transparent',
          }}
        >
          {isNotified ? <Bell className="w-3.5 h-3.5 text-accent" /> : <BellOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-1.5">
        <FighterAvatar id={fight.fighter1Id} name={fight.fighter1} />
        <div className="min-w-0 overflow-hidden">
          <span className="text-[11px] font-bold text-foreground truncate block">{fight.fighter1}</span>
          {fightOdds.f1ML != null && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] font-bold" style={{ color: mlColor(fightOdds.f1ML) }}>{fmt(fightOdds.f1ML)}</span>
              {fightOdds.f1EV != null && (
                <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ background: evColor(fightOdds.f1EV), color: evTextColor(fightOdds.f1EV) }}>
                  {fightOdds.f1EV > 0 ? "+" : ""}{fightOdds.f1EV}%
                </span>
              )}
            </div>
          )}
        </div>
        <span className="text-[10px] font-extrabold text-muted-foreground/50 justify-self-center px-1">VS</span>
        <div className="min-w-0 overflow-hidden text-right">
          <span className="text-[11px] font-bold text-foreground truncate block">{fight.fighter2}</span>
          {fightOdds.f2ML != null && (
            <div className="flex items-center justify-end gap-1 mt-0.5">
              {fightOdds.f2EV != null && (
                <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ background: evColor(fightOdds.f2EV), color: evTextColor(fightOdds.f2EV) }}>
                  {fightOdds.f2EV > 0 ? "+" : ""}{fightOdds.f2EV}%
                </span>
              )}
              <span className="text-[10px] font-bold" style={{ color: mlColor(fightOdds.f2ML) }}>{fmt(fightOdds.f2ML)}</span>
            </div>
          )}
        </div>
        <FighterAvatar id={fight.fighter2Id} name={fight.fighter2} />
      </div>
      {fight.weightClass && (
        <p className="text-[9px] text-muted-foreground/55 mt-2 text-center">{fight.weightClass}</p>
      )}
      <button
        onClick={() => navigate("/dashboard/ufc", { state: { fighter1: fight.fighter1, fighter2: fight.fighter2 } })}
        className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold text-primary bg-primary/[0.08] border border-primary/15 hover:bg-primary/[0.14] transition-all"
      >
        <Search className="w-3.5 h-3.5" />
        Analyze Fight
      </button>
    </motion.div>
    );
  };

  const renderUfcEvents = () => {
    if (ufcEvents.length === 0) {
      return (
        <div className="vision-card p-6 text-center">
          <Swords className="w-6 h-6 mx-auto mb-2 text-muted-foreground/45" />
          <p className="text-sm text-muted-foreground/65">No upcoming UFC events</p>
        </div>
      );
    }

    return ufcEvents.map((event, eventIdx) => {
      // Group fights by card type, reversed so main event / headline bout is first
      const groupedFights: Record<string, UfcFight[]> = {};
      for (const fight of [...event.fights].reverse()) {
        const type = fight.cardType || "Main Card";
        if (!groupedFights[type]) groupedFights[type] = [];
        groupedFights[type].push(fight);
      }

      // Sort card sections in proper order
      const orderedSections = CARD_ORDER.filter(c => groupedFights[c]?.length > 0);

      return (
        <motion.div key={eventIdx} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: eventIdx * 0.1 }}
          className="space-y-3">
          {/* Event Header */}
          <div className="vision-card p-4 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03]" style={{
              background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(0 72% 51%))',
            }} />
            <div className="relative">
              <h3 className="text-[14px] font-extrabold text-foreground">{event.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <Calendar className="w-3 h-3 text-muted-foreground/55" />
                <span className="text-[10px] text-muted-foreground/65 font-medium">{formatFullDate(event.date)}</span>
              </div>
              {event.venue && (
                <p className="text-[9px] text-muted-foreground/55 mt-0.5">📍 {event.venue}</p>
              )}
            </div>
          </div>

          {/* Card Sections */}
          {orderedSections.map((section) => {
            const defaultOpen = section === "Main Card";
            return (
              <Collapsible key={section} defaultOpen={defaultOpen}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center gap-2 mb-2 px-1 cursor-pointer group">
                    <div className="w-1.5 h-1.5 rounded-full" style={{
                      background: section === "Main Card" ? 'hsl(250 76% 62%)' : section === "Prelims" ? 'hsl(210 100% 60%)' : 'hsl(228 20% 40%)',
                    }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{
                      color: section === "Main Card" ? 'hsl(250 76% 62%)' : section === "Prelims" ? 'hsl(210 100% 60%)' : 'hsla(228, 20%, 60%, 0.5)',
                    }}>{section}</span>
                    <span className="text-[9px] text-muted-foreground/50">{groupedFights[section].length} fight{groupedFights[section].length !== 1 ? "s" : ""}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground/65 ml-auto transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1.5">
                    {groupedFights[section].map((fight, fIdx) => (
                      <FightCard key={fight.id} fight={fight} index={fIdx} />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}

          {/* If no grouped sections found, show all fights flat */}
          {orderedSections.length === 0 && event.fights.length > 0 && (
            <div className="space-y-1.5">
              {event.fights.map((fight, fIdx) => (
                <FightCard key={fight.id} fight={fight} index={fIdx} />
              ))}
            </div>
          )}
        </motion.div>
      );
    });
  };

  return (
    <div className="px-4 pt-2 pb-4 space-y-4 relative">
      <style>{`
        @keyframes live-glow {
          0%, 100% { box-shadow: 0 0 8px hsl(142 71% 45% / 0.3); }
          50% { box-shadow: 0 0 18px hsl(142 71% 45% / 0.55); }
        }
        @keyframes live-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.7); }
        }
      `}</style>
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(250 76% 62%)' }} />
      <div className="vision-orb w-36 h-36 top-[500px] -left-12" style={{ background: 'hsl(43 96% 56%)', animationDelay: '-4s' }} />

      

      {/* Sport toggle */}
      <div className="flex p-1 rounded-xl relative z-10" style={{ background: 'hsla(228, 20%, 10%, 0.6)', border: '1px solid hsla(228, 30%, 20%, 0.25)' }}>
        {(["nba", "mlb", "nhl", "nfl", "ufc"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1 ${
              sport === s
                ? "bg-accent text-accent-foreground shadow-lg"
                : "text-muted-foreground/65 hover:text-muted-foreground/60"
            }`}
          >
            <img src={SPORT_LOGO[s]} alt={s} className={`${SPORT_LOGO_SIZE[s]} object-contain shrink-0`} />
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Timezone info */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/55">
          <Calendar className="w-3 h-3" />
          <span className="font-bold uppercase tracking-wider">{tz.replace(/_/g, " ")}</span>
        </div>
        <button onClick={() => fetchGames(sport, false, true)} className="flex items-center gap-1 text-[9px] text-accent/60 font-bold">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-2 relative z-10">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                background: "#1a1832",
                border: "1px solid #252340",
                borderRadius: "14px",
                height: "120px",
                width: "100%",
                animation: "skeleton-pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      ) : error ? (
        <div className="vision-card p-6 text-center">
          <p className="text-sm text-muted-foreground/50">{error}</p>
        </div>
      ) : sport === "ufc" ? (
        <div className="space-y-4 relative z-10">
          {renderUfcEvents()}
        </div>
      ) : (
        <div className="space-y-2 relative z-10">
          {gamesByDate.length === 0 ? (
            <div className="vision-card p-6 text-center">
              <p className="text-sm text-muted-foreground/65">No {sport.toUpperCase()} games scheduled</p>
            </div>
          ) : (
            gamesByDate.map(([dateStr, dateGames], idx) => {
              const now = new Date();
              const todayStr = now.toLocaleDateString("en-CA", { timeZone: tz });
              const yesterday = new Date(now);
              yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = yesterday.toLocaleDateString("en-CA", { timeZone: tz });
              const isToday = dateStr === todayStr;
              const isYesterday = dateStr === yesterdayStr;
              const displayDate = isYesterday
                ? "Yesterday"
                : new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "numeric",
                    day: "numeric",
                    year: "numeric",
                  });
              return (
                <Collapsible key={dateStr} defaultOpen={isToday}>
                  <CollapsibleTrigger className="w-full">
                    <div className="vision-card p-3 flex items-center justify-between cursor-pointer group">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-accent/50" />
                        <span className="text-[12px] font-bold text-foreground/80">
                          {isToday ? "Today" : displayDate}
                        </span>
                        {isToday && (
                          <span className="text-[10px] text-muted-foreground/65">({displayDate})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-muted-foreground/55">
                          {dateGames.length} game{dateGames.length !== 1 ? "s" : ""}
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-2 mt-2">
                      {dateGames.map((g, i) => (
                        <GameCard key={g.id} game={g} index={i} />
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default GamesPage;
