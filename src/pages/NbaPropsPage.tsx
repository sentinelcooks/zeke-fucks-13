import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import MoneyLineSection from "@/components/MoneyLineSection";

import sportNcaabLogo from "@/assets/sport-ncaab.png";
import nbaLogo from "@/assets/nba-logo.png";
import mlbLogo from "@/assets/mlb-logo.png";
import nhlLogo from "@/assets/logo-nhl.png";
import ufcLogo from "@/assets/ufc-logo.png";
import { Search, Loader2, Target, TrendingUp, TrendingDown, Crosshair, Shield, Hand, RotateCcw, Zap, Trophy, ChevronDown, Sparkles, X, BarChart3, Activity, Swords, Link2, Timer, Clock, Layers, Flame, CircleDot, Hash, Gauge, Info, Plus, Trash2, DollarSign } from "lucide-react";
import { searchPlayers, getTeams, analyzeProp, searchUfcFighters, analyzeUfcMatchup } from "@/services/api";
import { supabase } from "@/integrations/supabase/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AddToSlipSheet } from "@/components/AddToSlipSheet";

import { motion, AnimatePresence } from "framer-motion";
import { useParlaySlip } from "@/contexts/ParlaySlipContext";
import WrittenAnalysis from "@/components/WrittenAnalysis";

import { PropExplainerDialog, usePropExplainerAutoShow } from "@/components/PropExplainerDialog";

import { PlayerCard } from "@/components/mobile/PlayerCard";
import { VerdictBadge } from "@/components/mobile/VerdictBadge";
import { StatPill } from "@/components/mobile/StatPill";
import { HitRateRing } from "@/components/mobile/HitRateRing";
import { ShotChart } from "@/components/mobile/ShotChart";
import { OddsProjection } from "@/components/mobile/OddsProjection";
import { StrengthWeakness } from "@/components/mobile/StrengthWeakness";
import { InjuryStatusBadge } from "@/components/mobile/InjuryStatusBadge";

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

// ── NBA Prop Categories ──
interface PropOption {
  value: string;
  label: string;
  icon: any;
  desc?: string;
}

interface PropCategory {
  category: string;
  props: PropOption[];
}

const NBA_PROP_CATEGORIES: PropCategory[] = [
  {
    category: "Popular",
    props: [
      { value: "points", label: "PTS", icon: Target, desc: "Points" },
      { value: "rebounds", label: "REB", icon: Shield, desc: "Rebounds" },
      { value: "assists", label: "AST", icon: Hand, desc: "Assists" },
      { value: "3-pointers", label: "3PM", icon: Crosshair, desc: "3-Ptrs Made" },
      { value: "reb+ast", label: "R+A", icon: Link2, desc: "Reb + Ast" },
      { value: "pts+ast", label: "P+A", icon: Activity, desc: "Pts + Ast" },
      { value: "pts+reb+ast", label: "PRA", icon: Trophy, desc: "Pts+Reb+Ast" },
      { value: "steals", label: "STL", icon: Zap, desc: "Steals" },
      { value: "blocks", label: "BLK", icon: BarChart3, desc: "Blocks" },
    ],
  },
  {
    category: "Combos",
    props: [
      { value: "pts+reb", label: "P+R", icon: Layers, desc: "Pts + Reb" },
      { value: "pts+ast", label: "P+A", icon: Activity, desc: "Pts + Ast" },
      { value: "pts+reb+ast", label: "PRA", icon: Trophy, desc: "Pts+Reb+Ast" },
      { value: "reb+ast", label: "R+A", icon: Link2, desc: "Reb + Ast" },
      { value: "stl+blk", label: "S+B", icon: Swords, desc: "Steals+Blks" },
    ],
  },
  {
    category: "1st Quarter",
    props: [
      { value: "1q_points", label: "1Q PTS", icon: Timer, desc: "1st Qtr Pts" },
      { value: "1q_assists", label: "1Q AST", icon: Hand, desc: "1st Qtr Ast" },
      { value: "1q_rebounds", label: "1Q REB", icon: Shield, desc: "1st Qtr Reb" },
      { value: "1q_3-pointers", label: "1Q 3PM", icon: Crosshair, desc: "1st Qtr 3s" },
    ],
  },
  {
    category: "Shooting",
    props: [
      { value: "3-pointers", label: "3PM", icon: Crosshair, desc: "3-Ptrs Made" },
      { value: "3pt_attempted", label: "3PA", icon: Target, desc: "3-Pt Attempts" },
      { value: "field_goals", label: "FGM", icon: Gauge, desc: "Field Goals" },
      { value: "fg_attempts", label: "FGA", icon: BarChart3, desc: "FG Attempts" },
      { value: "free_throws", label: "FTM", icon: CircleDot, desc: "Free Throws" },
      { value: "ft_attempts", label: "FTA", icon: Hash, desc: "FT Attempts" },
    ],
  },
  {
    category: "Other",
    props: [
      { value: "turnovers", label: "TO", icon: RotateCcw, desc: "Turnovers" },
      { value: "personal_fouls", label: "PF", icon: Flame, desc: "Fouls" },
      { value: "minutes", label: "MIN", icon: Clock, desc: "Minutes" },
      { value: "fantasy_score", label: "FPTS", icon: Sparkles, desc: "Fantasy Pts" },
    ],
  },
];

const MLB_PROP_CATEGORIES: PropCategory[] = [
  {
    category: "Hitting",
    props: [
      { value: "hits", label: "HITS", icon: Target, desc: "Hits" },
      { value: "runs", label: "RUNS", icon: TrendingUp, desc: "Runs" },
      { value: "rbi", label: "RBI", icon: Trophy, desc: "Runs Batted In" },
      { value: "home_runs", label: "HR", icon: Zap, desc: "Home Runs" },
      { value: "total_bases", label: "TB", icon: Shield, desc: "Total Bases" },
      { value: "walks", label: "BB", icon: Hand, desc: "Walks" },
      { value: "stolen_bases", label: "SB", icon: RotateCcw, desc: "Stolen Bases" },
      { value: "doubles", label: "2B", icon: Layers, desc: "Doubles" },
    ],
  },
  {
    category: "Pitching",
    props: [
      { value: "strikeouts", label: "K", icon: Crosshair, desc: "Strikeouts" },
      { value: "hits_allowed", label: "HA", icon: Shield, desc: "Hits Allowed" },
      { value: "earned_runs", label: "ER", icon: Flame, desc: "Earned Runs" },
      { value: "walks_allowed", label: "BBA", icon: Hand, desc: "Walks Allowed" },
      { value: "outs_recorded", label: "OUTS", icon: Gauge, desc: "Outs Recorded" },
    ],
  },
  {
    category: "Combos",
    props: [
      { value: "h+r+rbi", label: "H+R+RBI", icon: Trophy, desc: "Hits+Runs+RBI" },
      { value: "hits+runs", label: "H+R", icon: Layers, desc: "Hits + Runs" },
      { value: "fantasy_score", label: "FPTS", icon: Flame, desc: "Fantasy Pts" },
    ],
  },
];

const NHL_PROP_CATEGORIES: PropCategory[] = [
  {
    category: "Popular",
    props: [
      { value: "goals", label: "Goal", icon: Target, desc: "Goals" },
      { value: "nhl_assists", label: "Assists", icon: Hand, desc: "Assists" },
      { value: "nhl_points", label: "PTS", icon: Trophy, desc: "Points" },
      { value: "sog", label: "SOG", icon: Crosshair, desc: "Shots on Goal" },
      { value: "g+a", label: "G+A", icon: Layers, desc: "Goals + Assists" },
    ],
  },
  {
    category: "Other",
    props: [
      { value: "ppg", label: "PPG", icon: Zap, desc: "Power Play Goals" },
      { value: "pim", label: "PIM", icon: Clock, desc: "Penalty Min" },
      { value: "toi", label: "TOI", icon: Timer, desc: "Time on Ice" },
      { value: "plus_minus", label: "+/-", icon: TrendingUp, desc: "Plus/Minus" },
    ],
  },
];

// Flat arrays for backward compat
const NBA_PROP_TYPES = NBA_PROP_CATEGORIES.flatMap((c) => c.props);
const MLB_PROP_TYPES = MLB_PROP_CATEGORIES.flatMap((c) => c.props);
const NHL_PROP_TYPES = NHL_PROP_CATEGORIES.flatMap((c) => c.props);

function Section({ title, children, defaultOpen = true, icon }: { title: string; children: React.ReactNode; defaultOpen?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="vision-card overflow-hidden relative"
    >
      {/* Subtle top gradient accent */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(250,76%,62%,0.15), transparent)' }} />
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left group"
      >
        <div className="flex items-center gap-2.5">
          {icon && <span className="text-accent/50">{icon}</span>}
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground group-hover:text-foreground transition-colors">{title}</span>
        </div>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function fmtDate(raw: string) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function GameChart({ data }: { data: any }) {
  const games = data.game_log || [];
  const labels = games.map((g: any) => fmtDate(g.date));
  const values = games.map((g: any) => g.stat_value);
  const lineval = data.line;

  const colors = values.map((v: number) =>
    data.over_under === "over"
      ? v > lineval ? "hsla(158, 64%, 52%, 0.8)" : "hsla(0, 72%, 51%, 0.35)"
      : v < lineval ? "hsla(158, 64%, 52%, 0.8)" : "hsla(0, 72%, 51%, 0.35)"
  );

  return (
    <div className="h-[220px]">
      <Bar
        data={{
          labels,
          datasets: [
            {
              label: data.prop_display,
              data: values,
              backgroundColor: colors,
              borderRadius: 6,
              barPercentage: 0.55,
            } as any,
            {
              label: `Line (${lineval})`,
              data: Array(labels.length).fill(lineval),
              type: "line" as any,
              borderColor: "hsla(250, 76%, 62%, 0.5)",
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: "hsla(228, 10%, 45%, 0.6)", font: { size: 9 } }, grid: { display: false } },
            y: { ticks: { color: "hsla(228, 10%, 45%, 0.6)", font: { size: 9 } }, grid: { color: "hsla(228, 18%, 15%, 0.4)" }, beginAtZero: true },
          },
        }}
      />
    </div>
  );
}

function GamesTable({ games, line, overUnder, propType }: { games: any[]; line: number; overUnder: string; propType: string }) {
  const is1Q = propType.startsWith("1q_");
  const MLB_HITTING = new Set(["hits","runs","rbi","home_runs","total_bases","walks","stolen_bases","h+r+rbi","hits+runs","fantasy_score"]);
  const MLB_PITCHING = new Set(["strikeouts","hits_allowed","earned_runs","walks_allowed","outs_recorded","pitcher_strikeouts"]);
  const NHL_PROPS = new Set(["goals","nhl_assists","nhl_points","sog","pim","ppg","toi","g+a"]);
  const isMlbHit = MLB_HITTING.has(propType);
  const isMlbPitch = MLB_PITCHING.has(propType);
  const isNhl = NHL_PROPS.has(propType);

  const getStatVal = (g: any) => {
    // Prefer server-provided canonical stat_value (single source of truth)
    if (typeof g.stat_value === "number" && Number.isFinite(g.stat_value)) return g.stat_value;
    // Legacy fallback for NBA combo/single props
    if (propType === "pts+reb+ast") return (g.PTS || 0) + (g.REB || 0) + (g.AST || 0);
    if (propType === "pts+reb") return (g.PTS || 0) + (g.REB || 0);
    if (propType === "pts+ast") return (g.PTS || 0) + (g.AST || 0);
    if (propType === "reb+ast") return (g.REB || 0) + (g.AST || 0);
    if (propType === "stl+blk") return (g.STL || 0) + (g.BLK || 0);
    const map: any = {
      points: "PTS", rebounds: "REB", assists: "AST", "3-pointers": "FG3M",
      steals: "STL", blocks: "BLK", turnovers: "TOV", free_throws: "FTM",
      field_goals: "FGM", fg_attempts: "FGA", ft_attempts: "FTA", minutes: "MIN",
    };
    return g[map[propType]] || 0;
  };

  if (!games.length) return <p className="text-center text-muted-foreground/65 py-4 text-xs">No games data</p>;

  const headers = is1Q
    ? ["Date", "OPP", "W/L", "Q1 PTS", "Q1 REB", "Q1 AST", "Q1 3PM", "Prop", ""]
    : isMlbHit
      ? ["Date", "OPP", "W/L", "AB", "H", "R", "RBI", "Prop", ""]
      : isMlbPitch
        ? ["Date", "OPP", "W/L", "IP", "K", "ER", "BB", "Prop", ""]
        : isNhl
          ? ["Date", "OPP", "W/L", "TOI", "G", "A", "SOG", "Prop", ""]
          : ["Date", "OPP", "W/L", "MIN", "PTS", "REB", "AST", "Prop", ""];

  const cell = (v: any) => (v === undefined || v === null || v === "" ? "—" : v);

  return (
    <div className="overflow-x-auto scrollbar-hide -mx-5 px-5">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-border/30">
            {headers.map((h) => (
              <th key={h} className="text-center py-2.5 px-1 text-muted-foreground/65 uppercase tracking-wider font-bold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.slice(0, 10).map((g: any, i: number) => {
            const sv = getStatVal(g);
            const isHit = overUnder === "over" ? sv > line : sv < line;
            return (
              <tr key={i} className="border-b border-border/15 hover:bg-[hsla(228,20%,14%,0.4)] transition-colors">
                <td className="text-center py-2.5 px-1 whitespace-nowrap text-muted-foreground/50">{fmtDate(g.date)}</td>
                <td className="text-center py-2.5 px-1 whitespace-nowrap font-medium text-foreground/80">{g.matchup?.replace(/.*(?:vs\.|@)\s*/, "")}</td>
                <td className={`text-center py-2.5 px-1 font-bold ${g.result === "W" ? "text-nba-green" : "text-nba-red"}`}>{g.result}</td>
                {is1Q ? (
                  <>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.Q1_PTS)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.Q1_REB)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.Q1_AST)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.Q1_FG3M)}</td>
                  </>
                ) : isMlbHit ? (
                  <>
                    <td className="text-center py-2.5 px-1 text-muted-foreground/50">{cell(g.AB)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.H)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.R)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.RBI)}</td>
                  </>
                ) : isMlbPitch ? (
                  <>
                    <td className="text-center py-2.5 px-1 text-muted-foreground/50">{cell(g.IP)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.K)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.ER)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.BB)}</td>
                  </>
                ) : isNhl ? (
                  <>
                    <td className="text-center py-2.5 px-1 text-muted-foreground/50">{cell(g.TOI)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.G)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.A)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.SOG)}</td>
                  </>
                ) : (
                  <>
                    <td className="text-center py-2.5 px-1 text-muted-foreground/50">{cell(g.MIN)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.PTS)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.REB)}</td>
                    <td className="text-center py-2.5 px-1 text-foreground/70">{cell(g.AST)}</td>
                  </>
                )}
                <td className="text-center py-2.5 px-1 font-bold text-foreground">{sv}</td>
                <td className={`text-center py-2.5 px-1 font-black text-sm ${isHit ? "text-nba-green" : "text-nba-red"}`}>
                  {isHit ? "✓" : "✗"}
                </td>
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
  if (lower.includes("strong") || lower.includes("hot") || lower.includes("above") || lower.includes("dominates") || lower.includes("favorable") || lower.includes("healthy") || lower.includes("up")) return "green";
  return "neutral";
}

function normalizePickPropType(propType: string | undefined, sport: "nba" | "mlb" | "nhl" | "ufc") {
  const normalized = (propType || "").toLowerCase();
  if (!normalized) return sport === "mlb" ? "hits" : sport === "nhl" ? "goals" : "points";
  if (sport === "nhl") {
    if (normalized === "points") return "nhl_points";
    if (normalized === "assists") return "nhl_assists";
    if (normalized === "shots_on_goal") return "sog";
  }
  if (sport === "mlb" && normalized === "rbis") return "rbi";
  return normalized;
}

function getSavedPickVerdict(confidence?: number) {
  if (!confidence) return "LEAN";
  if (confidence >= 80) return "STRONG PICK";
  if (confidence >= 70) return "LEAN";
  return "RISKY";
}

function splitSavedReasoning(reasoning?: string | null) {
  if (!reasoning) return [];
  return reasoning
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part}.`);
}

const NbaPropsPage = () => {
  const location = useLocation();
  const globalSlip = useParlaySlip();
  const autoAnalyzedRef = useRef(false);

  // Reset ALL auto-analyze refs on every new navigation so each pick click triggers analysis
  useEffect(() => {
    autoAnalyzedRef.current = false;
    autoAnalyzePrefillRef.current = false;
    autoScrollToResultsRef.current = false;
  }, [location.key]);
  const autoAnalyzePrefillRef = useRef(false);
  const autoScrollToResultsRef = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"props" | "lines">("props");
  const [linesSport, setLinesSport] = useState<"nba" | "mlb" | "nhl" | "ncaab">("nba");
  const [sport, setSport] = useState<"nba" | "mlb" | "nhl" | "ufc">("nba");
  const [player, setPlayer] = useState("");
  const [propType, setPropType] = useState("points");
  const [opponent, setOpponent] = useState("");
  const [overUnder, setOverUnder] = useState<"over" | "under">("over");
  const [line, setLine] = useState("");
  const [teams, setTeams] = useState<{ abbr: string; name: string }[]>([]);
  const [suggestions, setSuggestions] = useState<{ id?: string; name: string; headshot?: string; position?: string; jersey?: string; team?: string; teamName?: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<any>(null);
  const [corrProps, setCorrProps] = useState<Array<{ correlated_player: string; correlated_prop: string; correlated_line?: number; correlated_team: string | null; hit_rate: number; sample_size: number; is_opponent?: boolean; reasoning?: string }>>([]);
  const [corrLoading, setCorrLoading] = useState(false);
  const [parlaySlip, setParlaySlip] = useState<Array<{ player: string; prop: string; team: string | null; hit_rate: number }>>([]);
  const [showSlip, setShowSlip] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("10");
  const [slipSheetOpen, setSlipSheetOpen] = useState(false);
  const [slipSheetPick, setSlipSheetPick] = useState<import("@/components/AddToSlipSheet").SlipSheetPick | null>(null);
  const [oppQuery, setOppQuery] = useState("");
  const [showOppDropdown, setShowOppDropdown] = useState(false);
  const oppDropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const categoryTabsRef = useRef<HTMLDivElement>(null);
  const categoryTabsDragRef = useRef({
    isPointerDown: false,
    startX: 0,
    scrollLeft: 0,
    didDrag: false,
  });

  // Prop explainer state
  const [explainerProp, setExplainerProp] = useState<{ value: string; label: string } | null>(null);
  const [bettingLevel, setBettingLevel] = useState<string | null>(null);
  const { shouldAutoShow, hasSeenProp, markPropSeen } = usePropExplainerAutoShow(bettingLevel);

  // Fetch betting level on mount — default to beginner immediately
  useEffect(() => {
    setBettingLevel("beginner"); // default so auto-show works immediately
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from("onboarding_responses")
            .select("betting_style")
            .eq("user_id", user.id)
            .maybeSingle();
          if (data?.betting_style) setBettingLevel(data.betting_style);
        }
      } catch {}
    })();
  }, []);

  // Auto-show explainer for beginners/intermediates on first prop selection
  const handlePropSelect = (propValue: string) => {
    setPropType(propValue);
    if (shouldAutoShow && !hasSeenProp(propValue)) {
      const prop = (sport === "mlb" ? MLB_PROP_CATEGORIES : sport === "nhl" ? NHL_PROP_CATEGORIES : NBA_PROP_CATEGORIES)
        .flatMap(c => c.props)
        .find(p => p.value === propValue);
      if (prop) {
        setExplainerProp({ value: prop.value, label: prop.label });
        markPropSeen(propValue);
      }
    }
  };

  // UFC-specific state
  const [fighter1, setFighter1] = useState("");
  const [fighter2, setFighter2] = useState("");
  const [ufcSuggestions1, setUfcSuggestions1] = useState<any[]>([]);
  const [ufcSuggestions2, setUfcSuggestions2] = useState<any[]>([]);
  const [showUfcSug1, setShowUfcSug1] = useState(false);
  const [showUfcSug2, setShowUfcSug2] = useState(false);
  const ufcTimeout1 = useRef<ReturnType<typeof setTimeout>>();
  const ufcTimeout2 = useRef<ReturnType<typeof setTimeout>>();
  const ufcRef1 = useRef<HTMLDivElement>(null);
  const ufcRef2 = useRef<HTMLDivElement>(null);

  const PROP_CATEGORIES = sport === "mlb" ? MLB_PROP_CATEGORIES : sport === "nhl" ? NHL_PROP_CATEGORIES : NBA_PROP_CATEGORIES;
  const PROP_TYPES = sport === "mlb" ? MLB_PROP_TYPES : sport === "nhl" ? NHL_PROP_TYPES : NBA_PROP_TYPES;
  const [activeCategory, setActiveCategory] = useState(PROP_CATEGORIES[0]?.category || "");

  useEffect(() => {
    if (sport !== "ufc") {
      getTeams(sport).then(setTeams).catch(() => {});
      if (!autoAnalyzePrefillRef.current) {
        setPropType(sport === "mlb" ? "hits" : sport === "nhl" ? "goals" : "points");
      }
    }

    if (!autoAnalyzePrefillRef.current) {
      setPlayer(""); setResults(null); setError(""); setOpponent(""); setLine("");
      setFighter1(""); setFighter2("");
    }

    if (!autoAnalyzePrefillRef.current) {
      const cats = sport === "mlb" ? MLB_PROP_CATEGORIES : sport === "nhl" ? NHL_PROP_CATEGORIES : NBA_PROP_CATEGORIES;
      setActiveCategory(cats[0]?.category || "");
    }
  }, [sport]);

  // Auto-analyze from "See why" navigation
  useEffect(() => {
    const navState = location.state as {
      autoAnalyze?: boolean;
      player?: string;
      prop_type?: string;
      line?: number;
      over_under?: "over" | "under";
      opponent?: string;
      sport?: string;
      pick_snapshot?: {
        confidence?: number;
        reasoning?: string | null;
      };
    } | null;

    if (navState?.autoAnalyze && navState.player && !autoAnalyzedRef.current) {
      autoAnalyzedRef.current = true;
      autoAnalyzePrefillRef.current = true;
      autoScrollToResultsRef.current = true;

      const s = (navState.sport || "nba") as "nba" | "mlb" | "nhl" | "ufc";
      const nextPropType = normalizePickPropType(navState.prop_type, s);
      // Accept full team names — resolve to abbreviation using loaded teams, or pass as-is
      const rawOpponent = navState.opponent || "";
      const resolvedOpponent = (() => {
        if (!rawOpponent) return "";
        // Already an abbreviation (e.g. "NYY")
        if (rawOpponent.length <= 4) return rawOpponent;
        // Try to resolve full name to abbreviation from teams list
        const match = teams.find(t => t.name.toLowerCase() === rawOpponent.toLowerCase());
        if (match) return match.abbr;
        // Pass full name as-is — the API can handle it
        return rawOpponent;
      })();

      // Set the correct category for the incoming prop type
      const cats = s === "mlb" ? MLB_PROP_CATEGORIES : s === "nhl" ? NHL_PROP_CATEGORIES : NBA_PROP_CATEGORIES;
      const matchCat = cats.find(c => c.props.some(p => p.value === nextPropType));

      setMode("props");
      setSport(s);
      setPlayer(navState.player);
      setPropType(nextPropType);
      setLine(String(navState.line || ""));
      setOverUnder(navState.over_under || "over");
      setOpponent(resolvedOpponent);
      if (matchCat) setActiveCategory(matchCat.category);

      window.history.replaceState({}, "");

      setTimeout(async () => {
        setLoading(true); setError(""); setResults(null); setCorrProps([]);
        try {
          const data = await analyzeProp({
            player: navState.player!,
            prop_type: nextPropType,
            line: navState.line || 0,
            over_under: navState.over_under || "over",
            opponent: resolvedOpponent || undefined,
            sport: s,
          });
          if (data.error) {
            setError(data.error);
          } else {
            const savedReasoning = splitSavedReasoning(navState.pick_snapshot?.reasoning);
            const mergedData = navState.pick_snapshot?.confidence
              ? {
                  ...data,
                  confidence: navState.pick_snapshot.confidence,
                  verdict: getSavedPickVerdict(navState.pick_snapshot.confidence),
                  reasoning: savedReasoning.length > 0 ? savedReasoning : data.reasoning,
                  over_under: navState.over_under || data.over_under,
                  line: navState.line || data.line,
                }
              : data;

            setResults(mergedData);
            if (s === "nba") {
              setCorrLoading(true);
              const playerTeam = data.team || data.player?.team_abbr || data.player?.team || data.player_info?.team || "";
              supabase.functions.invoke("correlated-props", {
                body: { player: navState.player!, prop: nextPropType, line: navState.line || 0, team: playerTeam, over_under: navState.over_under || "over" },
              }).then(({ data: corrData, error: corrErr }) => {
                if (!corrErr && Array.isArray(corrData)) setCorrProps(corrData);
                else setCorrProps([]);
                setCorrLoading(false);
              }).catch(() => { setCorrProps([]); setCorrLoading(false); });
            }
          }
        } catch {
          setError("Failed to analyze. Please try again.");
        } finally {
          setLoading(false);
          autoAnalyzePrefillRef.current = false;
        }
      }, 100);
    }
  }, [location.key]);

  useEffect(() => {
    if (results && autoScrollToResultsRef.current) {
      autoScrollToResultsRef.current = false;
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [results]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) setShowSuggestions(false);
      if (ufcRef1.current && !ufcRef1.current.contains(e.target as Node)) setShowUfcSug1(false);
      if (ufcRef2.current && !ufcRef2.current.contains(e.target as Node)) setShowUfcSug2(false);
      if (oppDropdownRef.current && !oppDropdownRef.current.contains(e.target as Node)) setShowOppDropdown(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const handleCategoryTabsPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const tabs = categoryTabsRef.current;
    if (!tabs) return;

    categoryTabsDragRef.current = {
      isPointerDown: true,
      startX: e.clientX,
      scrollLeft: tabs.scrollLeft,
      didDrag: false,
    };
  };

  const handleCategoryTabsPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const tabs = categoryTabsRef.current;
    if (!tabs || !categoryTabsDragRef.current.isPointerDown) return;

    const deltaX = e.clientX - categoryTabsDragRef.current.startX;
    if (Math.abs(deltaX) > 6) {
      categoryTabsDragRef.current.didDrag = true;
    }
    if (!categoryTabsDragRef.current.didDrag) return;

    e.preventDefault();
    tabs.scrollLeft = categoryTabsDragRef.current.scrollLeft - deltaX;
  };

  const handleCategoryTabsPointerEnd = () => {
    const wasDrag = categoryTabsDragRef.current.didDrag;
    categoryTabsDragRef.current.isPointerDown = false;

    if (wasDrag) {
      window.setTimeout(() => {
        categoryTabsDragRef.current.didDrag = false;
      }, 50);
    }
  };

  const handleCategoryTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const tabs = categoryTabsRef.current;
    if (!tabs || tabs.scrollWidth <= tabs.clientWidth) return;

    const delta = Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY;
    if (delta === 0) return;

    tabs.scrollLeft += delta;
    e.preventDefault();
  };

  const handlePlayerSearch = (q: string) => {
    setPlayer(q);
    clearTimeout(searchTimeout.current);
    if (q.length < 2) { setShowSuggestions(false); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const data = await searchPlayers(q, sport);
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch { setShowSuggestions(false); }
    }, 250);
  };

  const handleUfcSearch = (q: string, side: 1 | 2) => {
    const setter = side === 1 ? setFighter1 : setFighter2;
    const setSug = side === 1 ? setUfcSuggestions1 : setUfcSuggestions2;
    const setShow = side === 1 ? setShowUfcSug1 : setShowUfcSug2;
    const timeoutRef = side === 1 ? ufcTimeout1 : ufcTimeout2;
    setter(q);
    clearTimeout(timeoutRef.current);
    if (q.length < 2) { setShow(false); return; }
    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchUfcFighters(q);
        setSug(data);
        setShow(data.length > 0);
      } catch { setShow(false); }
    }, 300);
  };

  const handleAnalyze = async (overrides?: { player?: string; propType?: string; line?: string; overUnder?: "over" | "under" }) => {
    if (sport === "ufc") {
      if (!fighter1 || !fighter2) { setError("Enter both fighter names"); return; }
      setLoading(true); setError(""); setResults(null);
      try {
        const data = await analyzeUfcMatchup(fighter1, fighter2);
        if (data.error) setError(data.error);
        else setResults({ ...data, _isUfc: true });
      } catch { setError("Failed to analyze matchup. Please try again."); }
      finally { setLoading(false); }
      return;
    }
    // Use override values directly to avoid stale React state on rapid taps (e.g., correlated prop tap)
    const effPlayer = overrides?.player ?? player;
    const effPropType = overrides?.propType ?? propType;
    const effLine = overrides?.line ?? line;
    const effOverUnder = overrides?.overUnder ?? overUnder;

    if (!effPlayer) { setError("Enter a player name"); return; }
    const lineNum = parseFloat(effLine);
    if (isNaN(lineNum) || lineNum <= 0) { setError("Enter a valid line value"); return; }
    setLoading(true); setError(""); setResults(null); setCorrProps([]);
    try {
      const data = await analyzeProp({ player: effPlayer, prop_type: effPropType, line: lineNum, over_under: effOverUnder, opponent: opponent || undefined, sport });
      if (data.error) setError(data.error);
      else {
        setResults(data);
        // Fetch correlated props for NBA
        if (sport === "nba") {
          setCorrLoading(true);
          const playerTeam = data.team || data.player?.team_abbr || data.player?.team || data.player_info?.team || "";
          supabase.functions.invoke("correlated-props", {
            body: { player: effPlayer, prop: effPropType, line: lineNum, team: playerTeam, over_under: effOverUnder },
          }).then(({ data: corrData, error: corrErr }) => {
            if (!corrErr && Array.isArray(corrData)) setCorrProps(corrData);
            else setCorrProps([]);
            setCorrLoading(false);
          }).catch(() => { setCorrProps([]); setCorrLoading(false); });
        }
      }
    } catch { setError("Failed to analyze. Please try again."); }
    finally { setLoading(false); }
  };

  const h2h = results?.head_to_head || {};
  const prev = results?.prev_season_h2h || {};


  const sportLabel = sport === "ufc" ? "UFC" : sport === "mlb" ? "MLB" : sport === "nhl" ? "NHL" : "NBA";
  const sportEmoji = sport === "ufc" ? "🥊" : sport === "mlb" ? "⚾" : sport === "nhl" ? "🏒" : "🏀";

  return (
    <div className="flex flex-col min-h-full relative">
      {/* Ambient orbs */}
      <div className="vision-orb w-48 h-48 -top-10 -right-10" style={{ background: 'hsl(250 76% 62%)' }} />
      <div className="vision-orb w-36 h-36 top-[600px] -left-12" style={{ background: 'hsl(210 100% 60%)', animationDelay: '-4s' }} />

      
      <div className="px-4 pt-4 pb-6 space-y-3 relative z-10">

        {/* ── Sport Toggle (always visible) ── */}
        {mode === "props" ? (
        <div className="flex rounded-2xl p-1.5 gap-1.5" style={{
          background: 'hsla(228, 25%, 7%, 0.8)',
          border: '1px solid hsla(228, 30%, 18%, 0.3)',
          backdropFilter: 'blur(12px)',
        }}>
          {[
            { value: "nba" as const, label: "NBA", color: "#1D428A", icon: (active: boolean) => (
              <img src={nbaLogo} alt="NBA" className={`h-6 w-auto object-contain ${active ? '' : 'opacity-70'}`} />
            )},
            { value: "mlb" as const, label: "MLB", color: "#002D72", icon: (active: boolean) => (
              <img src={mlbLogo} alt="MLB" className={`h-5 w-auto object-contain ${active ? '' : 'opacity-70'}`} />
            )},
            { value: "nhl" as const, label: "NHL", color: "#111111", icon: (active: boolean) => (
              <img src={nhlLogo} alt="NHL" className={`h-9 w-auto object-contain ${active ? '' : 'opacity-70'}`} />
            )},
            { value: "ufc" as const, label: "UFC", color: "#3a1518", icon: (active: boolean) => (
              <img src={ufcLogo} alt="UFC" className={`h-3.5 w-auto object-contain ${active ? '' : 'opacity-70'}`} />
            )},
          ].map((s) => {
            const active = sport === s.value;
            return (
              <motion.button
                key={s.value}
                onClick={() => setSport(s.value)}
                whileTap={{ scale: 0.96 }}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold tracking-wide transition-all duration-300 relative overflow-hidden ${
                  active ? "text-white" : "text-muted-foreground/55 hover:text-muted-foreground/50"
                }`}
                style={active ? {
                  background: `linear-gradient(135deg, ${s.color}, ${s.color}dd)`,
                  boxShadow: `0 4px 16px -2px ${s.color}55`,
                } : {}}
              >
                {s.icon(active)}
                <span className="relative z-10">{s.label}</span>
              </motion.button>
            );
          })}
        </div>
        ) : (
        <div className="flex rounded-2xl p-1.5 gap-1.5" style={{
          background: 'hsla(228, 25%, 7%, 0.8)',
          border: '1px solid hsla(228, 30%, 18%, 0.3)',
          backdropFilter: 'blur(12px)',
        }}>
          {[
            { value: "nba", label: "NBA", color: "#1D428A", logo: nbaLogo, logoClass: "-mr-2.5" },
            { value: "mlb", label: "MLB", color: "#002D72", logo: mlbLogo, logoClass: "" },
            { value: "nhl", label: "NHL", color: "#111111", logo: nhlLogo, logoClass: "" },
          ].map((s) => {
            const active = linesSport === s.value;
            return (
              <motion.button
                key={s.value}
                onClick={() => setLinesSport(s.value as any)}
                whileTap={{ scale: 0.96 }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 rounded-xl text-[14px] font-bold tracking-wide transition-all duration-300 relative overflow-hidden ${
                  active ? "text-white" : "text-muted-foreground/55 hover:text-muted-foreground/50"
                }`}
                style={active ? {
                  background: `linear-gradient(135deg, ${s.color}, ${s.color}dd)`,
                  boxShadow: `0 4px 16px -2px ${s.color}55`,
                } : {}}
              >
                <img src={s.logo} alt={s.label} className={`h-8 w-8 object-contain ${s.logoClass} ${active ? '' : 'opacity-70'}`} />
                <span className="relative z-10">{s.label}</span>
              </motion.button>
            );
          })}
        </div>
        )}

        {/* ── Props / Lines Mode Toggle ── */}
        <div className="relative flex rounded-xl p-1 gap-1" style={{
          background: 'hsla(228, 20%, 8%, 0.6)',
          border: '1px solid hsla(228, 30%, 16%, 0.25)',
        }}>
          {([
            { value: "props" as const, label: "Props", icon: <Target className="w-3.5 h-3.5" /> },
            { value: "lines" as const, label: "Lines", icon: <BarChart3 className="w-3.5 h-3.5" /> },
          ]).map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={`relative flex-1 z-10 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[11px] font-bold tracking-wider transition-all duration-300 ${active ? "text-accent-foreground" : "text-muted-foreground/65 hover:text-foreground/50"}`}
              >
                {active && (
                  <motion.div
                    layoutId="analyze-mode"
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))',
                      boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.3)',
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {opt.icon}
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Lines Mode: show MoneyLineSection ── */}
        {mode === "lines" && (
          <MoneyLineSection embeddedSport={linesSport as any} hideSportToggle />
        )}

        {/* ── Props Mode ── */}
        {mode === "props" && sport === "mlb" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-medium text-nba-yellow" style={{ background: 'hsla(43, 96%, 56%, 0.08)', border: '1px solid hsla(43, 96%, 56%, 0.15)' }}>
            <span>⚠️</span>
            <span>MLB data uses last season as baseline. Projections will improve as the current season progresses.</span>
          </div>
        )}

        {/* ── UFC MATCHUP INPUT ── */}
        {mode === "props" && sport === "ufc" && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="space-y-3"
          >
            {/* Fighter 1 Search */}
            <div className="vision-card p-4 relative z-30" ref={ufcRef1}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.25)' }}>
                  <Swords className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-[13px] font-bold text-foreground">Fighter 1</h3>
                  <p className="text-[8px] text-muted-foreground/55 font-medium">Search any UFC fighter</p>
                </div>
              </div>
              <div className="relative group">
                <div className="relative rounded-xl overflow-hidden transition-all duration-300 group-focus-within:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]" style={{
                  background: 'hsla(228, 20%, 10%, 0.6)',
                  border: '1px solid hsla(228, 30%, 20%, 0.25)',
                }}>
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Search className="w-3.5 h-3.5 text-muted-foreground/45" />
                  </div>
                  <input
                    type="text"
                    value={fighter1}
                    onChange={(e) => handleUfcSearch(e.target.value, 1)}
                    placeholder="e.g. Islam Makhachev"
                    className="w-full bg-transparent pl-10 pr-10 py-3 text-[13px] font-medium text-foreground placeholder:text-muted-foreground/65 focus:outline-none"
                  />
                  {fighter1 && (
                    <button onClick={() => { setFighter1(""); setUfcSuggestions1([]); setShowUfcSug1(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground/55 hover:text-foreground transition-colors"
                      style={{ background: 'hsla(228, 20%, 16%, 0.6)' }}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <AnimatePresence>
                {showUfcSug1 && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute left-4 right-4 mt-2 rounded-2xl overflow-hidden z-50 shadow-2xl shadow-black/60 max-h-[240px] overflow-y-auto"
                    style={{ background: 'linear-gradient(127deg, hsla(228,30%,12%,0.98) 19%, hsla(228,30%,6%,0.95) 77%)', border: '1px solid hsla(228,30%,22%,0.3)', backdropFilter: 'blur(20px)' }}>
                    <div className="px-4 py-2.5 border-b border-border/20">
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Fighters</span>
                    </div>
                    {ufcSuggestions1.map((s, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                        onClick={() => { setFighter1(s.name); setShowUfcSug1(false); }}
                        className="flex items-center gap-3.5 px-4 py-3 cursor-pointer hover:bg-accent/6 active:bg-accent/10 transition-all border-b border-border/10 last:border-0 group">
                        <div className="relative w-11 h-11 rounded-full overflow-hidden flex-shrink-0 group-hover:ring-1 group-hover:ring-accent/20 transition-all" style={{
                          background: 'linear-gradient(135deg, hsla(228,30%,18%,1), hsla(228,30%,10%,1))',
                          border: '1px solid hsla(228,30%,22%,0.3)',
                        }}>
                          {s.headshot ? (
                            <>
                              <img src={s.headshot} alt={s.name} className="w-full h-full object-cover object-center"
                                onError={(e) => { 
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  const parent = (e.target as HTMLImageElement).parentElement;
                                  const fallback = parent?.querySelector('[data-fallback]');
                                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                                }} />
                              <div data-fallback className="absolute inset-0 items-center justify-center" style={{ display: 'none' }}>
                                <span className="text-xs font-black text-muted-foreground/45">{s.name.split(" ").map((n: string) => n[0]).join("")}</span>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-black text-muted-foreground/45">{s.name.split(" ").map((n: string) => n[0]).join("")}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-foreground truncate leading-tight">{s.name}</p>
                          {s.record && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[10px] font-bold text-accent/70 bg-accent/8 px-1.5 py-0.5 rounded-md leading-none">{s.record}</span>
                            </div>
                          )}
                        </div>
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/45 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* VS divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(228,18%,18%,0.5))' }} />
              <span className="text-[11px] font-extrabold text-muted-foreground/55 tracking-widest">VS</span>
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, hsla(228,18%,18%,0.5), transparent)' }} />
            </div>

            {/* Fighter 2 Search */}
            <div className="vision-card p-4 relative z-20" ref={ufcRef2}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(210 100% 60%), hsl(250 76% 62%))', boxShadow: '0 4px 12px -2px hsla(210,100%,60%,0.25)' }}>
                  <Swords className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-[13px] font-bold text-foreground">Fighter 2</h3>
                  <p className="text-[8px] text-muted-foreground/55 font-medium">Search opponent</p>
                </div>
              </div>
              <div className="relative group">
                <div className="relative rounded-xl overflow-hidden transition-all duration-300 group-focus-within:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]" style={{
                  background: 'hsla(228, 20%, 10%, 0.6)',
                  border: '1px solid hsla(228, 30%, 20%, 0.25)',
                }}>
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Search className="w-3.5 h-3.5 text-muted-foreground/45" />
                  </div>
                  <input
                    type="text"
                    value={fighter2}
                    onChange={(e) => handleUfcSearch(e.target.value, 2)}
                    placeholder="e.g. Charles Oliveira"
                    className="w-full bg-transparent pl-10 pr-10 py-3 text-[13px] font-medium text-foreground placeholder:text-muted-foreground/65 focus:outline-none"
                  />
                  {fighter2 && (
                    <button onClick={() => { setFighter2(""); setUfcSuggestions2([]); setShowUfcSug2(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground/55 hover:text-foreground transition-colors"
                      style={{ background: 'hsla(228, 20%, 16%, 0.6)' }}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <AnimatePresence>
                {showUfcSug2 && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute left-4 right-4 mt-2 rounded-2xl overflow-hidden z-50 shadow-2xl shadow-black/60 max-h-[240px] overflow-y-auto"
                    style={{ background: 'linear-gradient(127deg, hsla(228,30%,12%,0.98) 19%, hsla(228,30%,6%,0.95) 77%)', border: '1px solid hsla(228,30%,22%,0.3)', backdropFilter: 'blur(20px)' }}>
                    <div className="px-4 py-2.5 border-b border-border/20">
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Fighters</span>
                    </div>
                    {ufcSuggestions2.map((s, i) => (
                      <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                        onClick={() => { setFighter2(s.name); setShowUfcSug2(false); }}
                        className="flex items-center gap-3.5 px-4 py-3 cursor-pointer hover:bg-accent/6 active:bg-accent/10 transition-all border-b border-border/10 last:border-0 group">
                        <div className="relative w-11 h-11 rounded-full overflow-hidden flex-shrink-0 group-hover:ring-1 group-hover:ring-accent/20 transition-all" style={{
                          background: 'linear-gradient(135deg, hsla(228,30%,18%,1), hsla(228,30%,10%,1))',
                          border: '1px solid hsla(228,30%,22%,0.3)',
                        }}>
                          {s.headshot ? (
                            <>
                              <img src={s.headshot} alt={s.name} className="w-full h-full object-cover object-center"
                                onError={(e) => { 
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  const parent = (e.target as HTMLImageElement).parentElement;
                                  const fallback = parent?.querySelector('[data-fallback]');
                                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                                }} />
                              <div data-fallback className="absolute inset-0 items-center justify-center" style={{ display: 'none' }}>
                                <span className="text-xs font-black text-muted-foreground/45">{s.name.split(" ").map((n: string) => n[0]).join("")}</span>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-black text-muted-foreground/45">{s.name.split(" ").map((n: string) => n[0]).join("")}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-foreground truncate leading-tight">{s.name}</p>
                          {s.record && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className="text-[10px] font-bold text-accent/70 bg-accent/8 px-1.5 py-0.5 rounded-md leading-none">{s.record}</span>
                            </div>
                          )}
                        </div>
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/45 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Analyze Button — Sticky */}
            <div className="relative z-10 mt-2">
              <motion.button
                onClick={() => handleAnalyze()}
                disabled={loading}
                whileTap={{ scale: 0.97 }}
                className="relative w-full group overflow-hidden rounded-xl shadow-2xl shadow-black/40"
              >
                <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))' }} />
                <div className="relative flex items-center justify-center gap-2 py-3.5 text-white font-extrabold text-[13px] tracking-wider">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-3.5 h-3.5" />}
                  {loading ? "Analyzing..." : "Analyze Matchup"}
                </div>
              </motion.button>
            </div>

            <div className="flex items-center justify-center gap-3 pt-0.5">
              {["Advanced Real-Time Data", "UFCStats", "AI Insights"].map((label, i) => (
                <div key={label} className="flex items-center gap-1.5">
                  {i > 0 && <div className="w-px h-2 bg-border/15" />}
                  <div className="w-1 h-1 rounded-full bg-accent/15" />
                  <span className="text-[7px] text-muted-foreground/45 font-semibold uppercase tracking-widest">{label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── VISION UI INPUT PANEL (NBA/MLB) ── */}
        {mode === "props" && sport !== "ufc" && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="space-y-3"
        >
          {/* ── Card 1: Player Search ── */}
          <div className="vision-card p-4 relative z-30" ref={suggestionsRef}>
            <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-[0.05] pointer-events-none"
              style={{ background: 'radial-gradient(circle, hsl(250 76% 62%), transparent)' }} />

            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.25)' }}>
                <Search className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="text-[13px] font-bold text-foreground">Player Search</h3>
                <p className="text-[8px] text-muted-foreground/55 font-medium">Find any {sportLabel} player</p>
              </div>
              <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: 'hsla(228, 20%, 12%, 0.5)', border: '1px solid hsla(228, 20%, 20%, 0.2)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-pulse" />
                <span className="text-[7px] font-bold text-muted-foreground/55 uppercase tracking-wider">Live</span>
              </div>
            </div>

            <div className="relative group">
              <div className="relative rounded-xl overflow-hidden transition-all duration-300 group-focus-within:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]" style={{
                background: 'hsla(228, 20%, 10%, 0.6)',
                border: '1px solid hsla(228, 30%, 20%, 0.25)',
              }}>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Crosshair className="w-3.5 h-3.5 text-muted-foreground/45" />
                </div>
                <input
                  type="text"
                  value={player}
                  onChange={(e) => handlePlayerSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (setShowSuggestions(false), handleAnalyze())}
                  placeholder={`Search any ${sportLabel} player...`}
                  className="w-full bg-transparent pl-10 pr-10 py-3 text-[13px] font-medium text-foreground placeholder:text-muted-foreground/65 focus:outline-none"
                />
                {player && (
                  <button
                    onClick={() => { setPlayer(""); setSuggestions([]); setShowSuggestions(false); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-muted-foreground/55 hover:text-foreground transition-colors"
                    style={{ background: 'hsla(228, 20%, 16%, 0.6)' }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Search suggestions dropdown */}
            <AnimatePresence>
              {showSuggestions && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-4 right-4 mt-2 rounded-2xl overflow-hidden z-50 shadow-2xl shadow-black/60 max-h-[340px] overflow-y-auto"
                  style={{
                    background: 'linear-gradient(127.09deg, hsla(228, 30%, 12%, 0.98) 19.41%, hsla(228, 30%, 6%, 0.95) 76.65%)',
                    border: '1px solid hsla(228, 30%, 22%, 0.3)',
                    backdropFilter: 'blur(20px)',
                  }}
                >
                  <div className="px-4 py-2.5 border-b border-border/20">
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">Players</span>
                  </div>
                  {suggestions.map((s, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => { setPlayer(s.name); setShowSuggestions(false); }}
                      className="flex items-center gap-3.5 px-4 py-3 cursor-pointer hover:bg-accent/6 active:bg-accent/10 transition-all border-b border-border/10 last:border-0 group"
                    >
                      <div className="relative w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 group-hover:ring-1 group-hover:ring-accent/20 transition-all" style={{
                        background: 'linear-gradient(135deg, hsla(228,30%,18%,1), hsla(228,30%,10%,1))',
                        border: '1px solid hsla(228,30%,22%,0.3)',
                      }}>
                        {s.headshot ? (
                          <>
                            <img src={s.headshot} alt={s.name} className="w-full h-full object-cover object-top"
                              onError={(e) => { 
                                (e.target as HTMLImageElement).style.display = 'none';
                                const parent = (e.target as HTMLImageElement).parentElement;
                                const fallback = parent?.querySelector('[data-fallback]');
                                if (fallback) (fallback as HTMLElement).style.display = 'flex';
                              }} />
                            <div data-fallback className="absolute inset-0 items-center justify-center" style={{ display: 'none' }}>
                              <span className="text-xs font-black text-muted-foreground/45">{s.name.split(" ").map(n => n[0]).join("")}</span>
                            </div>
                          </>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs font-black text-muted-foreground/45">{s.name.split(" ").map(n => n[0]).join("")}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-foreground truncate leading-tight">{s.name}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          {s.team && <span className="text-[10px] font-bold text-accent/70 bg-accent/8 px-1.5 py-0.5 rounded-md leading-none">{s.team}</span>}
                          {s.position && <span className="text-[10px] text-muted-foreground/65 font-medium leading-none">{s.position}</span>}
                          {s.jersey && <span className="text-[10px] text-muted-foreground/55 leading-none">#{s.jersey}</span>}
                        </div>
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/45 -rotate-90 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Card 2: Stat Type — Categorized Vision UI ── */}
          <div className="vision-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="px-4 pt-4">
              <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-3">Stat Type</label>
            </div>
            
            {/* Category tabs — full-bleed scrollable row */}
            <div
              ref={categoryTabsRef}
              className="stat-tabs flex gap-1.5 mb-3 cursor-grab active:cursor-grabbing"
              onPointerDown={handleCategoryTabsPointerDown}
              onPointerMove={handleCategoryTabsPointerMove}
              onPointerUp={handleCategoryTabsPointerEnd}
              onPointerCancel={handleCategoryTabsPointerEnd}
              onPointerLeave={handleCategoryTabsPointerEnd}
              onWheel={handleCategoryTabsWheel}
              
              style={{
                overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none',
                paddingLeft: '16px',
                paddingRight: '16px',
                touchAction: 'pan-y pinch-zoom',
                userSelect: categoryTabsDragRef.current.isPointerDown ? 'none' : 'auto',
              }}
            >
              {PROP_CATEGORIES.map((cat) => {
                const isCatActive = cat.props.some((p) => p.value === propType);
                const isSelected = activeCategory === cat.category;
                return (
                  <button
                    key={cat.category}
                    type="button"
                    onClick={() => {
                      if (categoryTabsDragRef.current.didDrag) return;
                      setActiveCategory(cat.category);
                    }}
                    className={`shrink-0 px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-200 whitespace-nowrap ${
                      isSelected
                        ? "text-accent"
                        : isCatActive
                        ? "text-accent/50"
                        : "text-muted-foreground/55 hover:text-muted-foreground/50"
                    }`}
                    style={isSelected ? {
                      background: 'hsla(250, 76%, 62%, 0.12)',
                      border: '1px solid hsla(250, 76%, 62%, 0.2)',
                      boxShadow: '0 2px 8px -2px hsla(250,76%,62%,0.15)',
                    } : {
                      background: 'hsla(228, 20%, 10%, 0.3)',
                      border: '1px solid hsla(228, 20%, 18%, 0.15)',
                    }}
                  >
                    {cat.category}
                  </button>
                );
              })}
            </div>

            <div className="px-4 pb-4">

            {/* Props grid for active category */}
            <AnimatePresence mode="popLayout">
              <motion.div
                key={activeCategory}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="grid grid-cols-4 gap-2"
              >
                {(PROP_CATEGORIES.find((c) => c.category === activeCategory)?.props || []).map((p) => {
                  const isActive = propType === p.value;
                  const PropIcon = p.icon;
                  return (
                    <motion.button
                      key={p.value}
                      onClick={() => handlePropSelect(p.value)}
                      whileTap={{ scale: 0.92 }}
                      className="relative flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all duration-300"
                      style={isActive ? {
                        background: 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.2), hsla(210, 100%, 60%, 0.1))',
                        border: '1px solid hsla(250, 76%, 62%, 0.25)',
                        boxShadow: '0 4px 16px -4px hsla(250, 76%, 62%, 0.2), inset 0 1px 0 hsla(250, 76%, 62%, 0.1)',
                      } : {
                        background: 'hsla(228, 20%, 10%, 0.4)',
                        border: '1px solid hsla(228, 20%, 18%, 0.2)',
                      }}
                    >
                      {/* Info icon */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setExplainerProp({ value: p.value, label: p.label }); }}
                        className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-muted-foreground/45 hover:text-accent/70 hover:bg-accent/10 transition-all z-10"
                      >
                        <Info className="w-2.5 h-2.5" />
                      </button>
                      <PropIcon className={`w-4 h-4 transition-colors duration-300 ${isActive ? "text-accent" : "text-muted-foreground/50"}`} strokeWidth={isActive ? 2.2 : 1.5} />
                      <span className={`text-[10px] font-bold tracking-wider transition-colors duration-300 ${isActive ? "text-accent" : "text-muted-foreground/65"}`}>
                        {p.label}
                      </span>
                      {isActive && (
                        <motion.div
                          layoutId="chipDot"
                          className="absolute -bottom-0.5 w-3 h-[2px] rounded-full"
                          style={{ background: 'linear-gradient(90deg, hsl(250 76% 62%), hsl(210 100% 60%))' }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        />
                      )}
                    </motion.button>
                  );
                })}
              </motion.div>
            </AnimatePresence>
            </div>
          </div>

          {/* ── Card 3: Direction, Line, Opponent ── */}
          <div className="vision-card p-4 space-y-4">
            {/* Direction + Line row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2">Direction</label>
                <div className="flex rounded-xl p-1 gap-1" style={{
                  background: 'hsla(228, 20%, 8%, 0.6)',
                  border: '1px solid hsla(228, 30%, 16%, 0.25)',
                }}>
                  <motion.button
                    onClick={() => setOverUnder("over")}
                    whileTap={{ scale: 0.95 }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[11px] font-bold tracking-wider transition-all duration-300 ${
                      overUnder === "over"
                        ? "text-background"
                        : "text-muted-foreground/35 hover:text-foreground/50"
                    }`}
                    style={overUnder === "over" ? { background: 'hsl(158 64% 52%)', boxShadow: '0 4px 12px -2px hsla(158,64%,52%,0.3)' } : {}}
                  >
                    <TrendingUp className="w-3 h-3" />
                    OVER
                  </motion.button>
                  <motion.button
                    onClick={() => setOverUnder("under")}
                    whileTap={{ scale: 0.95 }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[11px] font-bold tracking-wider transition-all duration-300 ${
                      overUnder === "under"
                        ? "text-white"
                        : "text-muted-foreground/35 hover:text-foreground/50"
                    }`}
                    style={overUnder === "under" ? { background: 'hsl(0 72% 51%)', boxShadow: '0 4px 12px -2px hsla(0,72%,51%,0.3)' } : {}}
                  >
                    <TrendingDown className="w-3 h-3" />
                    UNDER
                  </motion.button>
                </div>
              </div>

              <div className="w-24">
                <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2 text-center">Line</label>
                <div className="rounded-xl overflow-hidden transition-colors focus-within:shadow-[0_0_12px_hsla(250,76%,62%,0.06)]" style={{
                  background: 'hsla(228, 20%, 10%, 0.5)',
                  border: '1px solid hsla(228, 30%, 20%, 0.25)',
                }}>
                  <input
                    type="number"
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                    placeholder="0.0"
                    step="0.5"
                    min="0"
                    className="w-full bg-transparent py-2.5 text-center text-lg font-extrabold text-foreground placeholder:text-muted-foreground/12 focus:outline-none tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Opponent */}
            <div ref={oppDropdownRef} className="relative">
              <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2">Opponent</label>
              <div
                className="relative rounded-xl overflow-hidden cursor-pointer"
                style={{
                  background: 'hsla(228, 20%, 10%, 0.5)',
                  border: '1px solid hsla(228, 30%, 20%, 0.25)',
                }}
                onClick={() => setShowOppDropdown(!showOppDropdown)}
              >
                {showOppDropdown ? (
                  <input
                    autoFocus
                    value={oppQuery}
                    onChange={e => setOppQuery(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Search team..."
                    className="w-full bg-transparent px-4 py-3 text-[12px] text-foreground focus:outline-none placeholder:text-muted-foreground/55"
                  />
                ) : (
                  <div className="px-4 py-3 text-[12px] text-foreground/70">
                    {teams.find(t => t.abbr === opponent)?.name || "Auto-detect next game"}
                  </div>
                )}
                <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none transition-transform ${showOppDropdown ? "rotate-180" : ""}`} />
              </div>
              <AnimatePresence>
                {showOppDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden max-h-48 overflow-y-auto scrollbar-hide"
                    style={{
                      background: 'hsl(228, 25%, 10%)',
                      border: '1px solid hsla(228, 30%, 20%, 0.4)',
                      boxShadow: '0 12px 32px -8px rgba(0,0,0,0.6)',
                    }}
                  >
                    <button
                      onClick={() => { setOpponent(""); setOppQuery(""); setShowOppDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-[11px] hover:bg-accent/10 transition-colors ${!opponent ? "text-accent font-bold" : "text-foreground/60"}`}
                    >
                      Auto-detect next game
                    </button>
                    {(oppQuery
                      ? teams.filter(t => t.name.toLowerCase().includes(oppQuery.toLowerCase()) || t.abbr.toLowerCase().includes(oppQuery.toLowerCase()))
                      : teams
                    ).map(t => (
                      <button
                        key={t.abbr}
                        onClick={() => { setOpponent(t.abbr); setOppQuery(""); setShowOppDropdown(false); }}
                        className={`w-full text-left px-4 py-2.5 text-[11px] hover:bg-accent/10 transition-colors flex items-center justify-between ${opponent === t.abbr ? "text-accent font-bold" : "text-foreground/60"}`}
                      >
                        <span>{t.name}</span>
                        <span className="text-[9px] text-muted-foreground/55">{t.abbr}</span>
                      </button>
                    ))}
                    {oppQuery && teams.filter(t => t.name.toLowerCase().includes(oppQuery.toLowerCase()) || t.abbr.toLowerCase().includes(oppQuery.toLowerCase())).length === 0 && (
                      <div className="px-4 py-3 text-[11px] text-muted-foreground/55 text-center">No teams found</div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Divider */}
            <div className="h-[1px]" style={{ background: 'linear-gradient(90deg, transparent, hsla(228, 18%, 18%, 0.4), transparent)' }} />

            {/* Analyze Button — Sticky */}
            <div className="sticky bottom-20 z-30">
              <motion.button
                onClick={() => handleAnalyze()}
                disabled={loading}
                whileTap={{ scale: 0.97 }}
                className="relative w-full group overflow-hidden rounded-xl shadow-2xl shadow-black/40"
              >
                <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))' }} />
                <div className="relative flex items-center justify-center gap-2 py-3.5 text-white font-extrabold text-[13px] tracking-wider">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {loading ? "Analyzing..." : "Run Analysis"}
                </div>
              </motion.button>
            </div>
          </div>

          {/* Data sources footer */}
          <div className="flex items-center justify-center gap-3 pt-0.5">
            {["Advanced Real-Time Data", "Real-Time Odds", "AI Insights"].map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                {i > 0 && <div className="w-px h-2 bg-border/15" />}
                <div className="w-1 h-1 rounded-full bg-accent/15" />
                <span className="text-[7px] text-muted-foreground/45 font-semibold uppercase tracking-widest">{label}</span>
              </div>
            ))}
          </div>
        </motion.div>
        )}

        {/* Loading */}
        {mode === "props" && loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 relative">
            {/* Ambient glow behind spinner */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-40 h-40 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, hsl(250 76% 62%), transparent 70%)' }} />
            </div>
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 rounded-full border-2 border-border/30" />
              <motion.div 
                className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              />
              <motion.div 
                className="absolute inset-2 rounded-full border-2 border-transparent border-b-[hsl(var(--nba-cyan))]"
                animate={{ rotate: -360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              />
              <motion.div 
                className="absolute inset-4 rounded-full border border-transparent border-r-[hsl(var(--nba-green))]"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            </div>
            <motion.p 
              className="text-foreground/60 text-sm font-medium"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              Crunching numbers...
            </motion.p>
            <div className="flex items-center justify-center gap-3 mt-3">
              {["Fetching stats", "Analyzing trends", "Computing odds"].map((step, i) => (
                <motion.span
                  key={step}
                  className="text-[9px] text-muted-foreground/55 font-medium"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.2, 0.8, 0.2] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
                >
                  {step}
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Error */}
        {mode === "props" && (
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              className="vision-card border-destructive/20 p-4 text-center text-destructive text-sm font-medium"
            >{error}</motion.div>
          )}
        </AnimatePresence>
        )}

        {/* UFC Results */}
        {mode === "props" && results?._isUfc && (
          <ErrorBoundary>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              {/* Analysis Complete Banner */}
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: 'linear-gradient(135deg, hsla(158, 64%, 52%, 0.08), hsla(210, 100%, 60%, 0.04))', border: '1px solid hsla(158, 64%, 52%, 0.12)' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-nba-green animate-glow-pulse" />
                  <span className="text-[10px] font-bold text-nba-green uppercase tracking-wider">Matchup Analysis Complete</span>
                </div>
              </motion.div>

              {/* Fighter Cards with full bio */}
              <div className="grid grid-cols-2 gap-2">
                {[results.fighter1, results.fighter2].map((f: any, idx: number) => (
                  <motion.div key={idx} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + idx * 0.1 }}
                    className="vision-card p-4 text-center">
                    {f?.image_url && <img src={f.image_url} alt={f.name} className="w-16 h-16 rounded-xl object-cover mx-auto mb-2 bg-secondary/30" />}
                    <p className={`text-[13px] font-bold ${idx === 0 ? "text-accent" : "text-nba-blue"}`}>{f?.name}</p>
                    <p className="text-[10px] text-muted-foreground/50">{f?.record}</p>
                    <p className="text-[9px] text-muted-foreground/55">{f?.weight_class}</p>
                    {/* Bio details */}
                    <div className="grid grid-cols-2 gap-1 mt-3 text-[9px]">
                      {f?.age && (
                        <div className="rounded-lg py-1.5" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                          <span className="block text-muted-foreground/65 uppercase font-bold">Age</span>
                          <span className="block text-sm font-extrabold text-foreground">{f.age}</span>
                        </div>
                      )}
                      {f?.height && (
                        <div className="rounded-lg py-1.5" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                          <span className="block text-muted-foreground/65 uppercase font-bold">Height</span>
                          <span className="block text-sm font-extrabold text-foreground">{f.height}</span>
                        </div>
                      )}
                      {f?.reach && (
                        <div className="rounded-lg py-1.5" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                          <span className="block text-muted-foreground/65 uppercase font-bold">Reach</span>
                          <span className="block text-sm font-extrabold text-foreground">{f.reach}</span>
                        </div>
                      )}
                      <div className="rounded-lg py-1.5" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                        <span className="block text-muted-foreground/65 uppercase font-bold">Stance</span>
                        <span className="block text-sm font-extrabold text-foreground">{f?.stance || "Orthodox"}</span>
                      </div>
                    </div>
                    {/* Win method breakdown */}
                    <div className="grid grid-cols-3 gap-1 mt-2">
                      {[
                        { label: "KO", val: f?.stats?.ko_wins },
                        { label: "SUB", val: f?.stats?.sub_wins },
                        { label: "DEC", val: f?.stats?.dec_wins },
                      ].map(s => (
                        <div key={s.label}>
                          <span className="block text-[8px] text-muted-foreground/65 uppercase">{s.label}</span>
                          <span className="block text-sm font-extrabold text-foreground">{s.val ?? 0}</span>
                        </div>
                      ))}
                    </div>
                    {/* Win streak */}
                    {f?.win_streak > 0 && (
                      <div className="mt-2 flex items-center justify-center gap-1">
                        <Trophy className="w-3 h-3 text-emerald-400" />
                        <span className="text-[10px] font-bold text-emerald-400">{f.win_streak} Win Streak</span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>

              {/* Top Pick */}
              {results.best_bet && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, type: "spring" }}
                  className="vision-card p-5 text-center relative overflow-hidden"
                  style={{
                    borderColor: results.best_bet.confidence === "strong" ? 'hsla(145,60%,45%,0.3)' : results.best_bet.confidence === "lean" ? 'hsla(210,100%,60%,0.3)' : 'hsla(43,96%,56%,0.3)',
                  }}>
                  <div className="absolute inset-0 opacity-[0.04]" style={{
                    background: `radial-gradient(circle at center, ${results.best_bet.confidence === "strong" ? "hsl(145 60% 45%)" : results.best_bet.confidence === "lean" ? "hsl(210 100% 60%)" : "hsl(43 96% 56%)"}, transparent 70%)`,
                  }} />
                  <Trophy className={`w-5 h-5 mx-auto mb-1 ${results.best_bet.confidence === "strong" ? "text-nba-green" : results.best_bet.confidence === "lean" ? "text-nba-blue" : "text-nba-yellow"}`} />
                  <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/65 font-bold">Top Pick</span>
                  <p className={`text-lg font-extrabold mt-1 ${results.best_bet.confidence === "strong" ? "text-nba-green" : results.best_bet.confidence === "lean" ? "text-nba-blue" : "text-nba-yellow"}`}>
                    {results.best_bet.bet}
                  </p>
                  {results.best_bet.probability && (
                    <p className={`text-2xl font-black tabular-nums ${results.best_bet.confidence === "strong" ? "text-nba-green" : results.best_bet.confidence === "lean" ? "text-nba-blue" : "text-nba-yellow"}`}>
                      {results.best_bet.probability}%
                    </p>
                  )}
                  <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mt-1 ${
                    results.best_bet.confidence === "strong" ? "bg-nba-green/15 text-nba-green" : results.best_bet.confidence === "lean" ? "bg-nba-blue/15 text-nba-blue" : "bg-nba-yellow/15 text-nba-yellow"
                  }`}>{results.best_bet.confidence}</span>
                  <p className="text-[11px] text-muted-foreground/50 mt-2 leading-relaxed">{results.best_bet.reasoning}</p>
                </motion.div>
              )}

              {/* Stats Comparison */}
              <div className="grid grid-cols-3 gap-2">
                <StatPill label="Comb. SLpM" value={(results.combined_strikes_per_min || 0).toFixed(1)} color="default" delay={0.35} />
                <StatPill label="Avg Rounds" value={(results.combined_avg_rounds || 0).toFixed(1)} color="blue" delay={0.4} />
                <StatPill label="Finish %" value={`${(results.combined_finish_rate || 0).toFixed(0)}%`} color="red" delay={0.45} />
              </div>

              {/* Physical Comparison */}
              {(results.fighter1?.height || results.fighter1?.reach || results.fighter1?.age) && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="vision-card p-4">
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-3 block">Physical Comparison</span>
                  <div className="space-y-2">
                    {[
                      { label: "Age", v1: results.fighter1?.age, v2: results.fighter2?.age, unit: "" },
                      { label: "Height", v1: results.fighter1?.height, v2: results.fighter2?.height },
                      { label: "Reach", v1: results.fighter1?.reach, v2: results.fighter2?.reach },
                      { label: "Stance", v1: results.fighter1?.stance, v2: results.fighter2?.stance },
                    ].filter(r => r.v1 || r.v2).map(({ label, v1, v2 }) => (
                      <div key={label} className="flex items-center justify-between py-1.5 border-b border-border/10 last:border-0">
                        <span className="text-[11px] font-bold text-accent tabular-nums">{v1 || "--"}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/65">{label}</span>
                        <span className="text-[11px] font-bold text-nba-blue tabular-nums">{v2 || "--"}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Comparison Bars */}
              {results.comparison && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="vision-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold text-accent">{results.fighter1?.name}</span>
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55">Head to Head</span>
                    <span className="text-[10px] font-bold text-nba-blue">{results.fighter2?.name}</span>
                  </div>
                  {[
                    { label: "Strikes/Min", k: "strikes_per_min" },
                    { label: "Str Absorbed/Min", k: "strikes_absorbed_per_min" },
                    { label: "Finish Rate", k: "finish_rate", fmt: (v: number) => `${v}%` },
                    { label: "KO Rate", k: "ko_rate", fmt: (v: number) => `${v}%` },
                    { label: "Sub Rate", k: "sub_rate", fmt: (v: number) => `${v}%` },
                    { label: "TD Avg", k: "takedown_avg" },
                    { label: "Avg Rounds", k: "avg_fight_rounds" },
                    { label: "Win Streak", k: "win_streak", fmt: (v: number) => `${v}` },
                  ].map(({ label, k, fmt }) => {
                    const v1 = results.comparison[k]?.fighter1 || 0;
                    const v2 = results.comparison[k]?.fighter2 || 0;
                    const max = Math.max(v1, v2, 0.1);
                    const format = fmt || ((v: number) => typeof v === 'number' ? v.toFixed(1) : v);
                    return (
                      <div key={k} className="py-2">
                        <div className="flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground/65 mb-1">
                          <span className="font-bold">{format(v1)}</span>
                          <span className="font-semibold">{label}</span>
                          <span className="font-bold">{format(v2)}</span>
                        </div>
                        <div className="flex gap-1 h-1.5">
                          <div className="flex-1 flex justify-end">
                            <div className="rounded-l-full transition-all" style={{ width: `${(v1 / max) * 100}%`, background: 'hsl(250 76% 62%)' }} />
                          </div>
                          <div className="flex-1">
                            <div className="rounded-r-full transition-all" style={{ width: `${(v2 / max) * 100}%`, background: 'hsl(210 100% 60%)' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              )}

              {/* Striking Stats Detail */}
              {(results.fighter1?.stats?.str_accuracy || results.fighter2?.stats?.str_accuracy) && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vision-card p-4">
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-3 block">Detailed Stats</span>
                  <div className="space-y-2">
                    {[
                      { label: "Str. Accuracy", v1: results.fighter1?.stats?.str_accuracy, v2: results.fighter2?.stats?.str_accuracy },
                      { label: "Str. Defense", v1: results.fighter1?.stats?.str_defense, v2: results.fighter2?.stats?.str_defense },
                      { label: "TD Accuracy", v1: results.fighter1?.stats?.td_accuracy, v2: results.fighter2?.stats?.td_accuracy },
                      { label: "TD Defense", v1: results.fighter1?.stats?.td_defense, v2: results.fighter2?.stats?.td_defense },
                      { label: "Sub Avg", v1: results.fighter1?.stats?.sub_avg?.toFixed(1), v2: results.fighter2?.stats?.sub_avg?.toFixed(1) },
                    ].filter(r => r.v1 || r.v2).map(({ label, v1, v2 }) => (
                      <div key={label} className="flex items-center justify-between py-1.5 border-b border-border/10 last:border-0">
                        <span className="text-[11px] font-bold text-accent tabular-nums">{v1 || "--"}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/65">{label}</span>
                        <span className="text-[11px] font-bold text-nba-blue tabular-nums">{v2 || "--"}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Round Predictions */}
              {results.round_predictions?.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vision-card p-4">
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-3 block">Round Predictions</span>
                  <div className="space-y-2">
                    {results.round_predictions.map((rp: any, i: number) => (
                      <div key={i} className="rounded-xl p-3" style={{
                        background: rp.confidence === "strong" ? 'hsla(145,60%,45%,0.06)' : rp.confidence === "lean" ? 'hsla(210,100%,60%,0.06)' : 'hsla(228,20%,15%,0.4)',
                        border: `1px solid ${rp.confidence === "strong" ? 'hsla(145,60%,45%,0.15)' : rp.confidence === "lean" ? 'hsla(210,100%,60%,0.15)' : 'hsla(228,20%,22%,0.2)'}`,
                      }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[12px] font-bold ${rp.confidence === "strong" ? "text-nba-green" : rp.confidence === "lean" ? "text-nba-blue" : "text-muted-foreground"}`}>{rp.bet}</span>
                          {rp.probability && <span className={`text-[11px] font-extrabold ${rp.confidence === "strong" ? "text-nba-green" : rp.confidence === "lean" ? "text-nba-blue" : "text-muted-foreground/50"}`}>{rp.probability}%</span>}
                        </div>
                        <p className="text-[10px] text-muted-foreground/50 leading-relaxed">{rp.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* ML Pick */}
              {results.ml_pick && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vision-card p-4 text-center">
                  <Zap className={`w-4 h-4 mx-auto mb-1 ${results.ml_pick.confidence === "strong" ? "text-nba-green" : "text-nba-blue"}`} />
                  <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/65 font-bold">Moneyline Pick</span>
                  <p className={`text-lg font-extrabold mt-1 ${results.ml_pick.confidence === "strong" ? "text-nba-green" : results.ml_pick.confidence === "lean" ? "text-nba-blue" : "text-nba-yellow"}`}>
                    {results.ml_pick.pick}
                  </p>
                  {results.ml_pick.probability && <p className="text-2xl font-black tabular-nums text-foreground">{results.ml_pick.probability}%</p>}
                  <p className="text-[10px] text-muted-foreground/50 mt-2 leading-relaxed">{results.ml_pick.reasoning}</p>
                </motion.div>
              )}

              {/* Recent Fights Table */}
              {(results.fighter1?.recent_fights?.length > 0 || results.fighter2?.recent_fights?.length > 0) && (
                <Section title="Recent Fights" icon={<BarChart3 className="w-3.5 h-3.5" />}>
                  {[results.fighter1, results.fighter2].map((f: any, fIdx: number) => (
                    <div key={fIdx} className={fIdx > 0 ? "mt-4 pt-4 border-t border-border/15" : ""}>
                      <span className={`text-[10px] font-bold uppercase tracking-wider mb-2 block ${fIdx === 0 ? "text-accent" : "text-nba-blue"}`}>{f?.name}</span>
                      <div className="overflow-x-auto scrollbar-hide -mx-5 px-5">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="border-b border-border/30">
                              {["Date", "Opponent", "Result", "Method", "Round"].map(h => (
                                <th key={h} className="text-center py-2 px-1 text-muted-foreground/65 uppercase tracking-wider font-bold whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(f?.recent_fights || []).slice(0, 6).map((fight: any, i: number) => (
                              <tr key={i} className="border-b border-border/15">
                                <td className="text-center py-2 px-1 text-muted-foreground/50 whitespace-nowrap">{fight.date}</td>
                                <td className="text-center py-2 px-1 font-medium text-foreground/80 whitespace-nowrap">{fight.opponent}</td>
                                <td className={`text-center py-2 px-1 font-bold ${fight.result === "W" ? "text-emerald-400" : "text-red-400"}`}>{fight.result}</td>
                                <td className="text-center py-2 px-1 text-muted-foreground/60 whitespace-nowrap">{fight.method}</td>
                                <td className="text-center py-2 px-1 text-foreground/70">{fight.round || `R${fight.roundNum}`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </motion.div>
          </ErrorBoundary>
        )}

        {/* NBA/MLB Results */}
        {mode === "props" && results && !results._isUfc && (
          <ErrorBoundary>
            <motion.div ref={resultsRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">

              {/* Analysis Complete Banner */}
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.05 }}
                className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: 'linear-gradient(135deg, hsla(158, 64%, 52%, 0.08), hsla(210, 100%, 60%, 0.04))', border: '1px solid hsla(158, 64%, 52%, 0.12)' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-nba-green animate-glow-pulse" />
                  <span className="text-[10px] font-bold text-nba-green uppercase tracking-wider">Analysis Complete</span>
                </div>
                <span className="text-[9px] text-muted-foreground/55 font-medium">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </motion.div>

              {results.player && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                  <PlayerCard
                    name={results.player.full_name}
                    team={results.player.team_name}
                    position={results.player.position}
                    jersey={results.player.jersey}
                    headshotUrl={results.player.headshot_url}
                  />
                </motion.div>
              )}

              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15, type: "spring" }}>
                <VerdictBadge
                  confidence={results.confidence}
                  verdict={results.verdict}
                  overUnder={results.over_under}
                  line={results.line}
                  propDisplay={results.prop_display}
                />
              </motion.div>

              {/* Add to Parlay button */}
              {sport !== "ufc" && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    const alreadyIn = globalSlip.isInSlip(player, propType, line);
                    if (alreadyIn) {
                      const existing = globalSlip.legs.find(l => l.player === player && l.propType === propType && l.line === line);
                      if (existing) globalSlip.removeLeg(existing.id);
                    } else {
                      setSlipSheetPick({
                        sport: sport === "mlb" ? "MLB" : sport === "nhl" ? "NHL" : "NBA",
                        player,
                        propType,
                        line,
                        overUnder,
                        opponent,
                        odds: -110,
                        confidence: typeof results.confidence === "number" ? results.confidence : results.confidence?.overall_confidence,
                      });
                      setSlipSheetOpen(true);
                    }
                  }}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[12px] font-bold tracking-wider transition-all ${
                    globalSlip.isInSlip(player, propType, line)
                      ? "text-accent border border-accent/30"
                      : "text-white"
                  }`}
                  style={globalSlip.isInSlip(player, propType, line) 
                    ? { background: 'hsla(250, 76%, 62%, 0.08)' }
                    : { background: 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.7), hsla(210, 100%, 60%, 0.7))' }
                  }
                >
                  {globalSlip.isInSlip(player, propType, line) ? (
                    <>
                      <X className="w-3.5 h-3.5" />
                      REMOVE FROM PARLAY
                    </>
                  ) : (
                    <>
                      <Layers className="w-3.5 h-3.5" />
                      ADD TO PARLAY
                    </>
                  )}
                </motion.button>
              )}

              <div className="grid grid-cols-4 gap-2">
                <StatPill label="Season" value={results.season_hit_rate?.avg ?? "--"} delay={0.2} />
                <StatPill label="L10" value={results.last_10?.avg ?? "--"} delay={0.25} />
                <StatPill label="L5" value={results.last_5?.avg ?? "--"} delay={0.3} />
                
                <StatPill label={`vs ${h2h.opponent || results.next_game?.opponent_name || "OPP"}`} value={h2h.avg ?? "--"} delay={0.35} />
              </div>

              {/* Season averages detail row */}
              {results.season_averages && (
                <motion.div 
                  initial={{ opacity: 0, y: 8 }} 
                  animate={{ opacity: 1, y: 0 }} 
                  transition={{ delay: 0.4 }}
                  className="vision-card p-4"
                >
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65 mb-3 block">Season Averages</span>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: "PPG", value: results.season_averages?.pts },
                      { label: "RPG", value: results.season_averages?.reb },
                      { label: "APG", value: results.season_averages?.ast },
                      { label: "3PM", value: results.season_averages?.fg3m },
                      { label: "MPG", value: results.season_averages?.min },
                    ].map((s, i) => (
                      <motion.div 
                        key={s.label}
                        className="text-center py-2 rounded-lg"
                        style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.45 + i * 0.04 }}
                      >
                        <span className="block text-sm font-extrabold tabular-nums text-foreground/80">{s.value ?? "--"}</span>
                        <span className="block text-[8px] text-muted-foreground/35 font-bold uppercase">{s.label}</span>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              <Section title="Hit Rates" icon={<Target className="w-3.5 h-3.5" />}>
                <div className="flex justify-between gap-1 px-0 py-2">
                  <HitRateRing rate={results.season_hit_rate?.rate || 0} hits={results.season_hit_rate?.hits || 0} total={results.season_hit_rate?.total || 0} label="Season" delay={0} />
                  <HitRateRing rate={results.last_10?.rate || 0} hits={results.last_10?.hits || 0} total={results.last_10?.total || 0} label="L10" delay={0.1} />
                  <HitRateRing rate={results.last_5?.rate || 0} hits={results.last_5?.hits || 0} total={results.last_5?.total || 0} label="L5" delay={0.2} />
                  <HitRateRing rate={h2h.rate || 0} hits={h2h.hits || 0} total={h2h.total || 0} label={`vs ${h2h.opponent || results.next_game?.opponent_name || "OPP"}`} delay={0.3} />
                </div>
              </Section>

              <Section title="Odds & EV Analysis" icon={<Zap className="w-3.5 h-3.5" />}>
                <OddsProjection
                  playerName={player}
                  propType={propType}
                  line={parseFloat(line) || 0}
                  overUnder={overUnder}
                  sport={sport}
                  modelHitRate={results.confidence}
                  seasonHitRate={results.season_hit_rate?.rate}
                  last10HitRate={results.last_10?.rate}
                  last5HitRate={results.last_5?.rate}
                  h2hHitRate={h2h.rate}
                />
              </Section>


              <Section title={sport === "mlb" ? "Hit Zones" : sport === "nhl" ? "Scoring Zones" : propType === "3pm" ? "3PT Zones" : propType === "rebounds" ? "Rebound Zones" : propType === "assists" ? "Assist Zones" : "Scoring Zones"} defaultOpen={false}>
                <ShotChart propType={propType} playerName={player} analysisData={results} sport={sport} />
              </Section>

              {results.next_game && (
                <Section title="Matchup Analysis">
                  <StrengthWeakness
                    playerName={results.player?.full_name || player}
                    opponentName={results.next_game?.opponent_name || "Opponent"}
                    sport={sport}
                    paceContext={results.pace_context}
                  />
                </Section>
              )}

              <Section title="Game Log" icon={<BarChart3 className="w-3.5 h-3.5" />}>
                <GameChart data={results} />
              </Section>

              {results.next_game && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="vision-card p-5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">Next Game</span>
                  <p className="text-lg font-bold text-foreground mt-1.5">
                    {results.next_game.is_home ? "vs" : "@"} {results.next_game.opponent_name}
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">{results.next_game.date}</p>
                </motion.div>
              )}

              <Section title={h2h.opponent ? `vs ${h2h.opponent}` : "Head-to-Head"} defaultOpen={false}>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    { label: "This Season", rate: h2h.rate, total: h2h.total },
                    { label: "Last Season", rate: prev.rate, total: prev.total },
                    { label: "Combined", rate: results.h2h_combined?.rate, total: results.h2h_combined?.total },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground/65">{s.label}</span>
                      <span className={`block text-xl font-extrabold tabular-nums ${
                        (s.rate || 0) >= 65 ? "text-nba-green" : (s.rate || 0) >= 50 ? "text-nba-blue" : (s.rate || 0) >= 35 ? "text-nba-yellow" : "text-nba-red"
                      }`}>{s.rate ?? "--"}%</span>
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
                          <InjuryStatusBadge status={inj.status?.toUpperCase()} colorClass="text-nba-red" bgClass="bg-destructive/15" />
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
                              <InjuryStatusBadge status={inj.status} colorClass={statusColor} bgClass={statusBg} />
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
                              <InjuryStatusBadge status={inj.status} colorClass={statusColor} bgClass={statusBg} />
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="text-xs text-muted-foreground/65 mt-2">None reported</p>}
                  </div>

                  {results.injury_insights?.length > 0 && (
                    <div className="mt-2 pt-4 border-t border-border/15">
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] gradient-text-accent">AI Impact Analysis</span>
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
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/65">{sport === "mlb" ? "At-Bats Trend" : sport === "nhl" ? "TOI Trend" : "Minutes Trend"}</span>
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
                      <p className="text-base font-bold text-foreground tabular-nums">{sport === "mlb" ? Math.round(results.minutes_trend.avg_min) : results.minutes_trend.avg_min} {sport === "mlb" ? "AB avg" : sport === "nhl" ? "TOI avg" : "min avg"}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground/35">Recent: <span className="text-foreground/60 font-semibold">{sport === "mlb" ? Math.round(results.minutes_trend.recent_avg) : results.minutes_trend.recent_avg}</span></span>
                        <span className="text-[10px] text-muted-foreground/45">·</span>
                        <span className="text-[10px] text-muted-foreground/35">Earlier: <span className="text-foreground/60 font-semibold">{sport === "mlb" ? Math.round(results.minutes_trend.early_avg) : results.minutes_trend.early_avg}</span></span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}


              {/* Written Analysis */}
              <WrittenAnalysis
                type="prop"
                verdict={results.verdict}
                confidence={results.confidence}
                playerOrTeam={results.player?.full_name || player}
                line={results.line}
                propDisplay={results.prop_display}
                overUnder={results.over_under}
                reasoning={results.reasoning}
                seasonHitRate={results.season_hit_rate}
                last10={results.last_10}
                last5={results.last_5}
                h2hAvg={h2h.avg}
                h2hData={results.head_to_head}
                recentGameValues={(results.game_log || []).slice(-10).map((g: any) => g.stat_value).filter((v: any): v is number => typeof v === "number")}
                ev={results.ev}
                edge={results.edge}
                minutesTrend={results.minutes_trend?.trend}
                injuries={results.teammate_injuries || results.injuries || []}
                sport={sport}
                withoutTeammatesData={results.without_teammates_analysis}
                paceContext={results.pace_context}
              />

              {/* Correlated Props */}
              {sport === "nba" && (
                <Section title="Correlated Props" icon={<Link2 className="w-3.5 h-3.5" />}>
                  {corrLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-4 h-4 text-accent animate-spin" />
                      <span className="text-[11px] text-muted-foreground/50 ml-2">Finding correlations...</span>
                    </div>
                  ) : corrProps.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-accent/50 mb-2">
                        When {player.split(" ").pop()} {propType.toUpperCase()} goes {(results.over_under || "over").toUpperCase()}, these also tend to go {(results.over_under || "over").toUpperCase()}:
                      </p>
                      {corrProps.map((c, ci) => {
                        const corrLineStr = String(c.correlated_line ?? "");
                        const analyzedDir: "over" | "under" = (results.over_under === "under" ? "under" : "over");
                        const isInSlip = globalSlip.isInSlip(c.correlated_player, c.correlated_prop, corrLineStr);
                        return (
                          <motion.div
                            key={ci}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: ci * 0.04 }}
                            className="rounded-xl overflow-hidden"
                            style={{ background: 'hsla(228, 20%, 8%, 0.5)' }}
                          >
                            <div className="flex items-center justify-between py-2.5 px-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[13px] font-bold text-foreground">{c.correlated_player}</span>
                                  {c.is_opponent && (
                                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-nba-red/15 text-nba-red uppercase tracking-wider">OPP</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {c.correlated_team && <span className="text-[10px] text-muted-foreground/50">{c.correlated_team}</span>}
                                  <span className="text-[10px] text-muted-foreground/55">·</span>
                                  <span className="text-[10px] text-muted-foreground/50">{analyzedDir.toUpperCase()} {c.correlated_line || "?"} {c.correlated_prop.toUpperCase()}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[16px] font-black tabular-nums ${
                                  c.hit_rate >= 80 ? "text-emerald-400" :
                                  c.hit_rate >= 60 ? "text-blue-400" : "text-amber-400"
                                }`}>{c.hit_rate}%</span>
                                <motion.button
                                  whileTap={{ scale: 0.85 }}
                                  onClick={() => {
                                    const lineNum = parseFloat(corrLineStr);
                                    // Sync UI state for visual feedback
                                    setPlayer(c.correlated_player);
                                    setPropType(c.correlated_prop);
                                    setOverUnder(analyzedDir);
                                    setLine(corrLineStr);
                                    const cats = NBA_PROP_CATEGORIES;
                                    const matchCat = cats.find(cat => cat.props.some(p => p.value === c.correlated_prop));
                                    if (matchCat) setActiveCategory(matchCat.category);
                                    // Fire analyze with explicit overrides — bypasses stale React state
                                    if (!isNaN(lineNum) && lineNum > 0) {
                                      handleAnalyze({
                                        player: c.correlated_player,
                                        propType: c.correlated_prop,
                                        line: corrLineStr,
                                        overUnder: analyzedDir,
                                      });
                                    }
                                    // Scroll to top so user sees the new results header
                                    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                  }}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors bg-white/5 text-muted-foreground/65 hover:text-primary hover:bg-primary/10"
                                >
                                  <Search className="w-3.5 h-3.5" />
                                </motion.button>
                                <motion.button
                                  whileTap={{ scale: 0.85 }}
                                  onClick={() => {
                                    if (isInSlip) {
                                      const leg = globalSlip.legs.find(l => l.player === c.correlated_player && l.propType === c.correlated_prop && l.line === corrLineStr);
                                      if (leg) globalSlip.removeLeg(leg.id);
                                    } else {
                                      globalSlip.addLeg({ sport: "NBA", player: c.correlated_player, propType: c.correlated_prop, line: corrLineStr, overUnder: analyzedDir, odds: -110 });
                                    }
                                  }}
                                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
                                    isInSlip 
                                      ? "bg-accent/20 text-accent" 
                                      : "bg-white/5 text-muted-foreground/65 hover:text-accent hover:bg-accent/10"
                                  }`}
                                >
                                  {isInSlip ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                                </motion.button>
                              </div>
                            </div>
                            {/* Reasoning */}
                            {c.reasoning && (
                              <div className="px-3 pb-2.5">
                                <p className="text-[10px] leading-relaxed text-muted-foreground/65 italic">{c.reasoning}</p>
                              </div>
                            )}
                          </motion.div>
                        );
                      })}

                      {/* Parlay Slip */}
                      <AnimatePresence>
                        {showSlip && parlaySlip.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            className="mt-4 rounded-xl overflow-hidden"
                            style={{ background: 'linear-gradient(135deg, hsla(250, 76%, 62%, 0.08), hsla(210, 100%, 60%, 0.04))', border: '1px solid hsla(250, 76%, 62%, 0.15)' }}
                          >
                            <div className="flex items-center justify-between px-4 py-3 border-b border-border/10">
                              <div className="flex items-center gap-2">
                                <DollarSign className="w-3.5 h-3.5 text-accent" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-accent">Parlay Slip ({parlaySlip.length} legs)</span>
                              </div>
                              <button onClick={() => { setParlaySlip([]); setShowSlip(false); }} className="text-[9px] text-muted-foreground/65 hover:text-nba-red transition-colors">Clear All</button>
                            </div>

                            {/* Legs */}
                            <div className="px-4 py-2 space-y-1.5">
                              {/* Source prop as first leg */}
                              <div className="flex items-center justify-between py-1.5 border-b border-border/10">
                                <div>
                                  <span className="text-[11px] font-bold text-foreground">{player}</span>
                                  <span className="text-[9px] text-muted-foreground/50 ml-1.5">{overUnder.toUpperCase()} {line} {propType.toUpperCase()}</span>
                                </div>
                                <span className="text-[9px] font-bold text-accent">Source</span>
                              </div>
                              {parlaySlip.map((leg, li) => (
                                <div key={li} className="flex items-center justify-between py-1.5 border-b border-border/10 last:border-0">
                                  <div>
                                    <span className="text-[11px] font-bold text-foreground">{leg.player}</span>
                                    <span className="text-[9px] text-muted-foreground/50 ml-1.5">{leg.prop.toUpperCase()}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-bold tabular-nums ${leg.hit_rate >= 70 ? "text-nba-green" : "text-nba-blue"}`}>{leg.hit_rate}%</span>
                                    <button onClick={() => setParlaySlip(prev => prev.filter((_, i) => i !== li))}>
                                      <Trash2 className="w-3 h-3 text-muted-foreground/55 hover:text-nba-red transition-colors" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Stake + Payout Simulator */}
                            <div className="px-4 py-3 border-t border-border/10">
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-[10px] text-muted-foreground/65 font-bold">Stake $</span>
                                <input
                                  type="number"
                                  value={stakeAmount}
                                  onChange={e => setStakeAmount(e.target.value)}
                                  className="w-20 px-2 py-1.5 rounded-lg text-[12px] font-bold text-foreground bg-background/60 border border-border/20 focus:outline-none focus:border-accent/40 tabular-nums"
                                />
                              </div>

                              {/* Simulated payouts per book */}
                              <div className="space-y-1.5">
                                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/55">Estimated Payouts</span>
                                {(() => {
                                  const totalLegs = parlaySlip.length + 1;
                                  const stake = parseFloat(stakeAmount) || 10;
                                  // Simulate standard parlay odds per book with slight variance
                                  const books = [
                                    { name: "FanDuel", emoji: "🎯", baseOdds: -110 },
                                    { name: "DraftKings", emoji: "👑", baseOdds: -108 },
                                    { name: "BetMGM", emoji: "🦁", baseOdds: -112 },
                                    { name: "ESPN BET", emoji: "📺", baseOdds: -110 },
                                    { name: "BetRivers", emoji: "🌊", baseOdds: -115 },
                                  ];
                                  
                                  const calcParlayPayout = (baseOdds: number, legs: number, stake: number) => {
                                    const decimalOdds = baseOdds < 0 ? 1 + (100 / Math.abs(baseOdds)) : 1 + (baseOdds / 100);
                                    const parlayDecimal = Math.pow(decimalOdds, legs);
                                    return stake * parlayDecimal;
                                  };

                                  const payouts = books.map(b => ({
                                    ...b,
                                    payout: calcParlayPayout(b.baseOdds, totalLegs, stake),
                                  })).sort((a, b) => b.payout - a.payout);

                                  const best = payouts[0];

                                  return payouts.map((b, bi) => (
                                    <div key={bi} className={`flex items-center justify-between py-2 px-3 rounded-lg ${bi === 0 ? "ring-1 ring-nba-green/20" : ""}`}
                                      style={{ background: bi === 0 ? 'hsla(158, 64%, 52%, 0.06)' : 'hsla(228, 20%, 8%, 0.4)' }}>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm">{b.emoji}</span>
                                        <span className={`text-[11px] font-bold ${bi === 0 ? "text-nba-green" : "text-foreground/70"}`}>{b.name}</span>
                                        {bi === 0 && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-nba-green/15 text-nba-green uppercase tracking-wider">Best</span>}
                                      </div>
                                      <span className={`text-[14px] font-black tabular-nums ${bi === 0 ? "text-nba-green" : "text-foreground/60"}`}>
                                        ${b.payout.toFixed(2)}
                                      </span>
                                    </div>
                                  ));
                                })()}
                              </div>

                              <p className="text-[8px] text-muted-foreground/50 mt-2 text-center">
                                Estimated payouts based on standard leg odds. Actual lines may vary.
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/65 text-center py-4">No strong correlations found for this prop</p>
                  )}
                </Section>
              )}
            </motion.div>
          </ErrorBoundary>
        )}
      </div>
      <PropExplainerDialog
        propValue={explainerProp?.value || ""}
        propLabel={explainerProp?.label || ""}
        sport={sport}
        bettingLevel={bettingLevel || "beginner"}
        isOpen={!!explainerProp}
        onClose={() => setExplainerProp(null)}
      />
      <AddToSlipSheet open={slipSheetOpen} onOpenChange={setSlipSheetOpen} pick={slipSheetPick} />
    </div>
  );
};

export default NbaPropsPage;
