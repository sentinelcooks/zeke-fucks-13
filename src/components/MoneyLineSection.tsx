import React, { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  Loader2,
  BarChart3,
  Minus,
  ArrowUpDown,
  Trophy,
  Swords,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Home,
  Plane,
  Zap,
  Moon,
  Sparkles,
  Info,
  DollarSign,
  Scale,
  Target,
  Shield,
  Crown,
  X,
  Check,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { generateDeviceFingerprint } from "@/utils/fingerprint";
import { motion, AnimatePresence } from "framer-motion";
import WrittenAnalysis from "@/components/WrittenAnalysis";
import { fetchNbaOdds } from "@/services/oddsApi";
import { getSportsbookInfo } from "@/utils/sportsbookLogos";
import { useAuth } from "@/contexts/AuthContext";
import { formatOdds } from "@/utils/oddsFormat";
import sportNba from "@/assets/logo-nba.png";
import sportMlb from "@/assets/logo-mlb.png";

import sportNhl from "@/assets/logo-nhl.png";
import sportNcaab from "@/assets/sport-ncaab.png";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, LineController, PointElement, Title, Tooltip, Legend);

type BetType = "moneyline" | "spread" | "total";
type SportType = "nba" | "ncaab" | "mlb" | "nhl";

interface Team {
  id: string;
  abbr: string;
  name: string;
  shortName: string;
  logo: string;
  record: string;
  color: string;
}

function getStoredSessionToken(): string {
  const remember = localStorage.getItem("primal-remember") === "true";
  const store = remember ? localStorage : sessionStorage;
  return (
    store.getItem("primal-session-token") ||
    localStorage.getItem("primal-session-token") ||
    sessionStorage.getItem("primal-session-token") ||
    ""
  );
}

async function callMoneylineApi(action: string, body: Record<string, any>) {
  const token = getStoredSessionToken();
  const fingerprint = await generateDeviceFingerprint();
  const { data, error } = await supabase.functions.invoke(`moneyline-api/${action}`, {
    body: {
      ...body,
      __sec: {
        "x-session-token": token,
        "x-device-fingerprint": fingerprint,
        "x-request-nonce": crypto.randomUUID(),
      },
    },
  });
  if (error) throw error;
  return data;
}

/* ── Vision UI Segmented Control ── */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId = "seg-bg",
}: {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  layoutId?: string;
}) {
  return (
    <div className="relative flex rounded-xl p-1 gap-1" style={{
      background: 'hsla(228, 20%, 8%, 0.6)',
      border: '1px solid hsla(228, 30%, 16%, 0.25)',
    }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`relative flex-1 z-10 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[11px] font-bold tracking-wider transition-all duration-300 ${active ? "text-accent-foreground" : "text-muted-foreground/65 hover:text-foreground/50"}`}
          >
            {active && (
              <motion.div
                layoutId={layoutId}
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
  );
}

/* ── Confidence Gauge ── */
function ConfidenceGauge({ value, label }: { value: number; label: string }) {
  const color =
    value >= 65 ? "text-nba-green" : value >= 50 ? "text-nba-blue" : value >= 35 ? "text-nba-yellow" : "text-nba-red";
  return (
    <div className="flex flex-col items-center justify-center gap-0.5">
      <div className={`text-4xl font-black ${color}`}>{value}%</div>
      <div className={`text-[10px] font-bold tracking-[2px] uppercase ${color}`}>{label}</div>
    </div>
  );
}

/* ── Charts ── */
function H2HChart({ h2h, team1, team2 }: { h2h: any[]; team1: Team; team2: Team }) {
  if (!h2h.length) return <p className="text-center text-muted-foreground text-sm py-6">No head-to-head data available</p>;
  const labels = h2h.map((g) => { const d = new Date(g.date); return `${d.getMonth() + 1}/${d.getDate()}`; });
  return (
    <div className="h-[260px]">
      <Bar
        data={{
          labels,
          datasets: [
            { label: team1.shortName, data: h2h.map((g) => g.team1_score), backgroundColor: team1.color + "cc", borderRadius: 4, barPercentage: 0.7 },
            { label: team2.shortName, data: h2h.map((g) => g.team2_score), backgroundColor: team2.color + "cc", borderRadius: 4, barPercentage: 0.7 },
          ],
        }}
        options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#7a8299", font: { size: 11 } } } }, scales: { x: { ticks: { color: "#7a8299", font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: "#7a8299" }, grid: { color: "rgba(30,42,69,0.5)" }, beginAtZero: true } } }}
      />
    </div>
  );
}

function TotalChart({ h2h, line }: { h2h: any[]; line: number }) {
  if (!h2h.length) return null;
  const labels = h2h.map((g) => { const d = new Date(g.date); return `${d.getMonth() + 1}/${d.getDate()}`; });
  const totals = h2h.map((g) => g.team1_score + g.team2_score);
  const colors = totals.map((t) => (t > line ? "rgba(0,212,170,0.85)" : "rgba(255,71,87,0.7)"));
  return (
    <div className="h-[230px]">
      <Bar
        data={{ labels, datasets: [
          { label: "Combined Score", data: totals, backgroundColor: colors, borderRadius: 4, barPercentage: 0.65 },
          { label: `Line (${line})`, data: Array(labels.length).fill(line), type: "line" as any, borderColor: "rgba(255,255,255,0.5)", borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false } as any,
        ] }}
        options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#7a8299", font: { size: 11 } } } }, scales: { x: { ticks: { color: "#7a8299", font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: "#7a8299" }, grid: { color: "rgba(30,42,69,0.5)" }, beginAtZero: true } } }}
      />
    </div>
  );
}

function DifferentialChart({ h2h, team1 }: { h2h: any[]; team1: Team }) {
  if (!h2h.length) return null;
  const labels = h2h.map((g) => { const d = new Date(g.date); return `${d.getMonth() + 1}/${d.getDate()}`; });
  const diffs = h2h.map((g) => g.team1_score - g.team2_score);
  const colors = diffs.map((d) => (d > 0 ? "rgba(0,212,170,0.85)" : "rgba(255,71,87,0.7)"));
  return (
    <div className="h-[200px]">
      <Bar
        data={{ labels, datasets: [{ label: `${team1.shortName} Diff`, data: diffs, backgroundColor: colors, borderRadius: 4, barPercentage: 0.6 }] }}
        options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#7a8299", font: { size: 11 } } } }, scales: { x: { ticks: { color: "#7a8299", font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: "#7a8299" }, grid: { color: "rgba(30,42,69,0.5)" } } } }}
      />
    </div>
  );
}

/* ── Team Select ── */
function TeamSelect({ label, value, onChange, teams }: { label: string; value: string; onChange: (v: string) => void; teams: Team[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const selected = teams.find((t) => t.abbr === value);
  const q = query.toLowerCase();
  const filtered = query
    ? teams.filter((t: any) => t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q) || t.shortName.toLowerCase().includes(q) || (t.aliases && t.aliases.some((a: string) => a.includes(q))))
    : teams;

  React.useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2">{label}</label>
      <div className="relative rounded-xl overflow-hidden transition-all duration-300 focus-within:shadow-[0_0_20px_hsla(250,76%,62%,0.08)]" style={{
        background: 'hsla(228, 20%, 10%, 0.6)',
        border: '1px solid hsla(228, 30%, 20%, 0.25)',
      }}>
        {selected && !open && selected.logo && (
          <img src={selected.logo} alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 object-contain" />
        )}
        <input
          type="text"
          value={open ? query : selected ? selected.name : ""}
          placeholder="Search team..."
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(""); }}
          className={`w-full bg-transparent py-3 text-[13px] font-medium text-foreground placeholder:text-muted-foreground/65 focus:outline-none ${selected && !open ? "pl-10 pr-3" : "px-3"}`}
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-2 w-full max-h-56 overflow-y-auto rounded-2xl shadow-2xl shadow-black/60" style={{
          background: 'linear-gradient(127.09deg, hsla(228, 30%, 12%, 0.98) 19.41%, hsla(228, 30%, 6%, 0.95) 76.65%)',
          border: '1px solid hsla(228, 30%, 22%, 0.3)',
          backdropFilter: 'blur(20px)',
        }}>
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onChange(t.abbr); setQuery(""); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm text-left hover:bg-accent/6 active:bg-accent/10 transition-colors border-b border-border/10 last:border-0 ${t.abbr === value ? "bg-accent/10 font-semibold" : ""}`}
            >
              {t.logo && <img src={t.logo} alt="" className="w-6 h-6 object-contain shrink-0" />}
              <span className="truncate text-[13px] font-bold text-foreground">{t.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground/65 shrink-0">{t.record}</span>
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && query && (
        <div className="absolute z-50 mt-2 w-full rounded-2xl p-4 text-sm text-muted-foreground/65 text-center" style={{
          background: 'linear-gradient(127.09deg, hsla(228, 30%, 12%, 0.98) 19.41%, hsla(228, 30%, 6%, 0.95) 76.65%)',
          border: '1px solid hsla(228, 30%, 22%, 0.3)',
        }}>
          No teams match "{query}"
        </div>
      )}
    </div>
  );
}

/* ── HomeAwayBadge — shown only when ESPN confirms the matchup ── */
const HomeAwayBadge: React.FC<{ value?: "home" | "away" | null }> = ({ value }) => {
  if (value !== "home" && value !== "away") return null;
  const isHome = value === "home";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${
        isHome ? "bg-nba-green/15 text-nba-green" : "bg-nba-blue/15 text-nba-blue"
      }`}
    >
      {isHome ? <Home className="w-2 h-2" /> : <Plane className="w-2 h-2" />}
      {value}
    </span>
  );
};

/* ── Section ── */
function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="vision-card overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(250,76%,62%,0.12), transparent)' }} />
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3"
        onClick={() => setOpen(!open)}
      >
        <h3 className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55">{title}</h3>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/55" />
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
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── All Sportsbooks Collapsible ── */
function AllSportsbooksCollapsible({ activeMarketBooksWithEV, activeMarketKey, activeOverUnder, team1, modelProb, oddsFormat, getEVColorLocal }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div className="vision-card overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(250,76%,62%,0.12), transparent)' }} />
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55">All Sportsbooks</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/50">{activeMarketBooksWithEV.length} books</span>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/55" />
          </motion.div>
        </div>
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
            <div className="px-4 pb-4 space-y-1.5">
              {activeMarketBooksWithEV.map((book: any, i: number) => {
                const isBest = i === 0;
                return (
                  <motion.div
                    key={`${activeMarketKey}-${book.name}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.05 }}
                    className={`relative rounded-xl overflow-hidden transition-all ${isBest ? "ring-1 ring-nba-green/20" : ""}`}
                    style={{
                      background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.7) 19.41%, hsla(228, 30%, 8%, 0.4) 76.65%)',
                      border: '1px solid hsla(228, 30%, 22%, 0.2)',
                    }}
                  >
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: 'hsla(228, 20%, 14%, 0.6)', border: '1px solid hsla(228, 20%, 22%, 0.3)' }}>
                          {book.logo ? (
                            <img src={book.logo} alt={book.name} className="w-5 h-5 object-contain" />
                          ) : (
                            <span className="text-[10px] font-black" style={{ color: book.color }}>{book.abbrev}</span>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-bold text-foreground/80">{book.name}</span>
                            {isBest && <span className="text-[8px] font-black text-nba-green bg-nba-green/10 px-1.5 py-0.5 rounded-md">BEST</span>}
                          </div>
                          <span className="text-[9px] text-muted-foreground/55">
                            {activeMarketKey === "totals"
                              ? `${activeOverUnder.toUpperCase()} ${book.total || ""}`
                              : activeMarketKey === "spreads"
                              ? `${team1.abbr} ${book.spread1 || ""}`
                              : `${team1.shortName} ML`}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <span className="block text-[10px] font-bold tabular-nums text-foreground/50">{book.implied.toFixed(1)}%</span>
                          <span className="block text-[7px] text-muted-foreground/50 uppercase">Implied</span>
                        </div>
                        {modelProb && modelProb > 0 && (
                          <div className="text-center min-w-[44px]">
                            <span className={`block text-[10px] font-bold tabular-nums ${getEVColorLocal(book.ev)}`}>
                              {book.ev > 0 ? "+" : ""}{book.ev.toFixed(1)}%
                            </span>
                            <span className="block text-[7px] text-muted-foreground/50 uppercase">EV</span>
                          </div>
                        )}
                        <div className="text-right min-w-[52px]">
                          <span className={`block text-[15px] font-black font-mono tabular-nums ${isBest ? "text-nba-green" : "text-foreground/70"}`}>
                            {formatOdds(book.relevantOdds, oddsFormat)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {modelProb && modelProb > 0 && (
                      <div className="px-4 pb-2.5">
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'hsla(228, 20%, 12%, 0.8)' }}>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(Math.max(book.edge + 50, 0), 100)}%` }}
                            transition={{ duration: 0.6, delay: 0.2 + i * 0.05 }}
                            className="h-full rounded-full"
                            style={{ background: book.edge > 0
                              ? 'linear-gradient(90deg, hsl(158 64% 52% / 0.6), hsl(158 64% 52% / 0.3))'
                              : 'linear-gradient(90deg, hsl(0 72% 51% / 0.5), hsl(0 72% 51% / 0.2))'
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Other Markets Collapsible ── */
function OtherMarketsCollapsible({ allMarketData, activeMarketKey, marketLabels, oddsFormat }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div className="vision-card overflow-hidden relative">
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(250,76%,62%,0.15), transparent)' }} />
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.25)' }}>
            <Trophy className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55">Other Markets</span>
          <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: 'hsla(228, 20%, 12%, 0.5)', border: '1px solid hsla(228, 20%, 20%, 0.2)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-pulse" />
            <span className="text-[7px] font-bold text-nba-green uppercase tracking-wider">Live</span>
          </div>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/55" />
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
            <div className="px-4 pb-4 space-y-5">
              {Object.entries(allMarketData).filter(([k]) => k !== activeMarketKey).map(([marketKey, platforms]: [string, any]) => {
                const meta = marketLabels[marketKey];
                if (!meta) return null;
                return (
                  <div key={marketKey}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center text-accent" style={{ background: 'hsla(250, 76%, 62%, 0.1)' }}>
                        {meta.icon}
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">{meta.label}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 mb-1.5 px-1">
                      <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45">Platform</span>
                      <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45 text-center">{meta.col1}</span>
                      <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45 text-center">{meta.col2}</span>
                    </div>
                    <div className="space-y-1">
                      {platforms.map((p: any, i: number) => (
                        <motion.div
                          key={`${marketKey}-${p.name}`}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="grid grid-cols-3 gap-1 items-center py-2 px-2 rounded-xl transition-all duration-200 group cursor-default"
                          style={{ background: 'hsla(228,20%,10%,0.3)', border: '1px solid transparent' }}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md flex items-center justify-center overflow-hidden" style={{ background: 'hsla(228, 20%, 14%, 0.6)', border: '1px solid hsla(228, 20%, 22%, 0.3)' }}>
                              {p.logo ? (
                                <img src={p.logo} alt={p.name} className="w-4 h-4 object-contain" loading="lazy" />
                              ) : (
                                <span className="text-[8px] font-black text-white" style={{ color: p.color }}>{p.abbrev}</span>
                              )}
                            </div>
                            <span className="text-[10px] font-bold text-foreground/80 group-hover:text-foreground transition-colors truncate">{p.name}</span>
                          </div>
                          <span className="text-[12px] font-extrabold tabular-nums text-center text-foreground/70">{p.t1}</span>
                          <span className="text-[12px] font-extrabold tabular-nums text-center text-foreground/70">{p.t2}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


function SpreadTeamSelector({
  team1,
  team2,
  teams,
  spreadTeam,
  setSpreadTeam,
}: {
  team1: string;
  team2: string;
  teams: Team[];
  spreadTeam: string;
  setSpreadTeam: (v: string) => void;
}) {
  const [spreadOpen, setSpreadOpen] = React.useState(false);
  const spreadRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (spreadRef.current && !spreadRef.current.contains(e.target as Node)) setSpreadOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const spreadOptions = [
    ...(team1 ? [{ value: team1, label: teams.find((t) => t.abbr === team1)?.name || team1, logo: teams.find((t) => t.abbr === team1)?.logo }] : []),
    ...(team2 ? [{ value: team2, label: teams.find((t) => t.abbr === team2)?.name || team2, logo: teams.find((t) => t.abbr === team2)?.logo }] : []),
  ];
  const selectedOpt = spreadOptions.find((o) => o.value === spreadTeam);

  return (
    <div ref={spreadRef} className="relative">
      <button
        type="button"
        onClick={() => setSpreadOpen(!spreadOpen)}
        className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl text-[13px] font-medium text-left transition-all"
        style={{
          background: 'hsla(228, 20%, 10%, 0.6)',
          border: spreadOpen ? '1px solid hsla(250, 76%, 62%, 0.3)' : '1px solid hsla(228, 30%, 20%, 0.25)',
          boxShadow: spreadOpen ? '0 0 20px -8px hsla(250, 76%, 62%, 0.15)' : 'none',
        }}
      >
        {selectedOpt?.logo && <img src={selectedOpt.logo} alt="" className="w-5 h-5 object-contain" />}
        <span className={selectedOpt ? 'text-foreground font-semibold' : 'text-muted-foreground/65'}>{selectedOpt?.label || "Select team..."}</span>
        <svg className={`ml-auto w-4 h-4 text-muted-foreground/50 transition-transform ${spreadOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {spreadOpen && spreadOptions.length > 0 && (
        <div className="absolute z-50 mt-2 w-full rounded-2xl shadow-2xl shadow-black/60 overflow-hidden" style={{
          background: 'linear-gradient(127.09deg, hsla(228, 30%, 12%, 0.98) 19.41%, hsla(228, 30%, 6%, 0.95) 76.65%)',
          border: '1px solid hsla(228, 30%, 22%, 0.3)',
          backdropFilter: 'blur(20px)',
        }}>
          {spreadOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setSpreadTeam(opt.value); setSpreadOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-sm text-left transition-colors border-b border-border/10 last:border-0 ${opt.value === spreadTeam ? 'bg-accent/10' : 'hover:bg-accent/6 active:bg-accent/10'}`}
            >
              {opt.logo && <img src={opt.logo} alt="" className="w-6 h-6 object-contain shrink-0" />}
              <span className="truncate text-[13px] font-bold text-foreground">{opt.label}</span>
              {opt.value === spreadTeam && <span className="ml-auto text-accent text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── H2H Table ── */
function H2HTable({ h2h, team1, team2 }: { h2h: any[]; team1: Team; team2: Team }) {
  if (!h2h.length) return <p className="text-center text-muted-foreground text-sm">No games played</p>;
  const sorted = [...h2h].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            {["Date", team1.abbr, team2.abbr, "Margin", "Total"].map((h) => (
              <th key={h} className="text-center py-2 px-1.5 text-muted-foreground uppercase tracking-wider font-semibold text-[10px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((g, i) => {
            const margin = g.team1_score - g.team2_score;
            const total = g.team1_score + g.team2_score;
            const d = new Date(g.date);
            return (
              <tr key={i} className="border-b border-border/30">
                <td className="text-center py-2 px-1.5 text-muted-foreground">{d.getMonth() + 1}/{d.getDate()}/{String(d.getFullYear()).slice(-2)}</td>
                <td className={`text-center py-2 px-1.5 font-bold ${g.team1_winner ? "text-nba-green" : "text-foreground"}`}>{g.team1_score}</td>
                <td className={`text-center py-2 px-1.5 font-bold ${g.team2_winner ? "text-nba-green" : "text-foreground"}`}>{g.team2_score}</td>
                <td className={`text-center py-2 px-1.5 font-bold ${margin > 0 ? "text-nba-green" : "text-nba-red"}`}>{margin > 0 ? "+" : ""}{margin}</td>
                <td className="text-center py-2 px-1.5 text-muted-foreground">{total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getPastMeetingsLabel(sport?: string): string {
  const s = (sport || "nba").toLowerCase();
  if (s === "mlb") return "Past Meetings (2026 Season + Last Season)";
  if (s === "nfl") return "Past Meetings (2025 Season + Last Season)";
  // NBA / NHL / NCAAB: split-year season
  return "Past Meetings (2025–26 Season + Last Season)";
}

/* ── Platform Odds (Real from Odds API) — OddsProjection-style design ── */
function MoneylinePlatformOdds({ team1, team2, sport, modelProb, activeBetType = "moneyline", activeOverUnder = "over", factorBreakdown }: { team1: Team; team2: Team; sport?: string; modelProb?: number; activeBetType?: BetType; activeOverUnder?: "over" | "under"; factorBreakdown?: any[] }) {
  const { profile } = useAuth();
  const oddsFormat = (profile?.odds_format as "american" | "decimal") || "american";
  const [allMarketData, setAllMarketData] = useState<Record<string, Array<{ name: string; logo: string; abbrev: string; color: string; bookKey: string; t1: string; t2: string; t1Raw: number; t2Raw: number; spread1?: string; spread2?: string; total?: string }>>>({});
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [showOddsSection, setShowOddsSection] = useState(true);

  const [loadKey, setLoadKey] = useState(0);

  const loadOdds = useCallback(() => setLoadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await fetchNbaOdds(undefined, "h2h,spreads,totals", sport);
        if (cancelled) return;
        const events: any[] = data?.events || data || [];
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

        // Enhanced matching with aliases and abbreviations
        const teamMatches = (eventTeam: string, team: Team) => {
          const et = normalize(eventTeam);
          const tn = normalize(team.name);
          const ts = normalize(team.shortName || "");
          const ta = normalize(team.abbr || "");
          if (et.includes(tn) || tn.includes(et)) return true;
          if (ts && (et.includes(ts) || ts.includes(et))) return true;
          if (ta && ta.length >= 2 && et.includes(ta)) return true;
          if (ts.length >= 4 && (et.endsWith(ts) || ts.endsWith(et.slice(-Math.min(et.length, 10))))) return true;
          const aliases: string[] = (team as any).aliases || [];
          for (const alias of aliases) {
            const na = normalize(alias);
            if (na && (et.includes(na) || na.includes(et))) return true;
          }
          return false;
        };

        const match = events.find((e: any) => {
          const home = e.home_team || "";
          const away = e.away_team || "";
          return (teamMatches(home, team1) && teamMatches(away, team2)) ||
                 (teamMatches(home, team2) && teamMatches(away, team1));
        });

        if (match && match.bookmakers?.length > 0) {
          const marketTypes = ["h2h", "spreads", "totals"];
          const result: Record<string, any[]> = {};
          
          for (const marketKey of marketTypes) {
            const rows = match.bookmakers
              .map((b: any) => {
                const market = b.markets?.find((m: any) => m.key === marketKey);
                if (!market) return null;
                const info = getSportsbookInfo(b.key);
                
                if (marketKey === "h2h") {
                  const findOdds = (teamName: string) => {
                    const norm = normalize(teamName);
                    const outcome = market.outcomes?.find((o: any) => normalize(o.name).includes(norm) || norm.includes(normalize(o.name)));
                    return outcome?.price;
                  };
                  const t1Price = findOdds(team1.name) ?? findOdds(team1.shortName || "");
                  const t2Price = findOdds(team2.name) ?? findOdds(team2.shortName || "");
                  if (t1Price == null || t2Price == null) return null;
                  return {
                    name: info.label, logo: info.logo, abbrev: info.abbrev, color: info.color, bookKey: b.key,
                    t1: formatOdds(t1Price, oddsFormat), t2: formatOdds(t2Price, oddsFormat),
                    t1Raw: t1Price, t2Raw: t2Price,
                  };
                } else if (marketKey === "spreads") {
                  const findSpread = (teamName: string) => {
                    const norm = normalize(teamName);
                    return market.outcomes?.find((o: any) => normalize(o.name).includes(norm) || norm.includes(normalize(o.name)));
                  };
                  const t1Out = findSpread(team1.name) ?? findSpread(team1.shortName || "");
                  const t2Out = findSpread(team2.name) ?? findSpread(team2.shortName || "");
                  if (!t1Out || !t2Out) return null;
                  return {
                    name: info.label, logo: info.logo, abbrev: info.abbrev, color: info.color, bookKey: b.key,
                    t1: `${t1Out.point > 0 ? "+" : ""}${t1Out.point} (${formatOdds(t1Out.price, oddsFormat)})`,
                    t2: `${t2Out.point > 0 ? "+" : ""}${t2Out.point} (${formatOdds(t2Out.price, oddsFormat)})`,
                    t1Raw: t1Out.price, t2Raw: t2Out.price,
                    spread1: `${t1Out.point > 0 ? "+" : ""}${t1Out.point}`,
                    spread2: `${t2Out.point > 0 ? "+" : ""}${t2Out.point}`,
                  };
                } else {
                  const overOut = market.outcomes?.find((o: any) => o.name.toLowerCase() === "over");
                  const underOut = market.outcomes?.find((o: any) => o.name.toLowerCase() === "under");
                  if (!overOut || !underOut) return null;
                  return {
                    name: info.label, logo: info.logo, abbrev: info.abbrev, color: info.color, bookKey: b.key,
                    t1: `O ${overOut.point} (${formatOdds(overOut.price, oddsFormat)})`,
                    t2: `U ${underOut.point} (${formatOdds(underOut.price, oddsFormat)})`,
                    t1Raw: overOut.price, t2Raw: underOut.price,
                    total: String(overOut.point),
                  };
                }
              })
              .filter(Boolean);
            if (rows.length > 0) result[marketKey] = rows;
          }
          
          if (Object.keys(result).length > 0) {
            setAllMarketData(result);
            setIsLive(true);
          } else {
            setAllMarketData({});
            setIsLive(false);
          }
        } else {
          setAllMarketData({});
          setIsLive(false);
        }
      } catch {
        setAllMarketData({});
        setIsLive(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [team1.name, team2.name, team1.id, team2.id, oddsFormat, sport, loadKey]);

  if (loading) {
    return (
      <div className="vision-card p-4 text-center">
        <Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" />
        <p className="text-[10px] text-muted-foreground/65 mt-1">Fetching live odds...</p>
      </div>
    );
  }

  if (!isLive || Object.keys(allMarketData).length === 0) {
    return (
      <div className="vision-card p-4">
        <div className="flex items-start gap-2 text-muted-foreground/65">
          <AlertTriangle className="w-4 h-4 text-nba-yellow shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[11px]">Live odds for {team1.shortName || team1.name} vs {team2.shortName || team2.name} aren't posted yet. Analysis still uses our model — odds will appear once books publish them.</p>
            <button
              onClick={loadOdds}
              className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold text-accent hover:text-accent/80 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const marketLabels: Record<string, { label: string; icon: React.ReactNode; col1: string; col2: string }> = {
    h2h: { label: "Moneyline", icon: <DollarSign className="w-3 h-3" />, col1: team1.abbr, col2: team2.abbr },
    spreads: { label: "Spread", icon: <Scale className="w-3 h-3" />, col1: team1.abbr, col2: team2.abbr },
    totals: { label: "Over/Under", icon: <Target className="w-3 h-3" />, col1: "Over", col2: "Under" },
  };

  // Helpers
  const americanToDecimalLocal = (american: number) => {
    if (american > 0) return american / 100 + 1;
    return 100 / Math.abs(american) + 1;
  };
  const impliedProbLocal = (american: number) => {
    if (american < 0) return Math.abs(american) / (Math.abs(american) + 100) * 100;
    return 100 / (american + 100) * 100;
  };

  // Map betType to market key
  const betTypeToMarketKey: Record<string, string> = { moneyline: "h2h", spread: "spreads", total: "totals" };
  const activeMarketKey = betTypeToMarketKey[activeBetType] || "h2h";

  // Compute EV for each market
  const evCards: Array<{ market: string; label: string; ev: number; edge: number; bestOdds: number; bestBook: string; modelProbUsed: number; bestImplied: number }> = [];
  if (modelProb && modelProb > 0) {
    for (const [marketKey, rows] of Object.entries(allMarketData)) {
      if (!rows || rows.length === 0) continue;
      const prob = modelProb / 100;
      // For totals, use t1Raw for over, t2Raw for under
      let bestOdds = -Infinity;
      let bestBook = "";
      for (const row of rows) {
        const relevantOdds = (marketKey === "totals" && activeOverUnder === "under") ? row.t2Raw : row.t1Raw;
        if (relevantOdds > bestOdds) {
          bestOdds = relevantOdds;
          bestBook = row.name;
        }
      }
      const decimalOdds = americanToDecimalLocal(bestOdds);
      const implied = impliedProbLocal(bestOdds);
      const ev = (prob * decimalOdds - 1) * 100;
      const edge = modelProb - implied;
      evCards.push({
        market: marketKey,
        label: marketLabels[marketKey]?.label || marketKey,
        ev: +ev.toFixed(1),
        edge: +edge.toFixed(1),
        bestOdds,
        bestBook,
        modelProbUsed: modelProb,
        bestImplied: implied,
      });
    }
  }

  // Active market EV data for hero card
  const activeEV = evCards.find(c => c.market === activeMarketKey);
  const hasPositiveEV = activeEV ? activeEV.ev > 0 : false;
  const edgeLabel = activeEV ? (
    activeEV.edge >= 10 ? { label: "STRONG EDGE", color: "text-nba-green", bg: "bg-nba-green/10" } :
    activeEV.edge >= 5 ? { label: "EDGE", color: "text-nba-green", bg: "bg-nba-green/10" } :
    activeEV.edge >= 2 ? { label: "SLIGHT EDGE", color: "text-nba-blue", bg: "bg-nba-blue/10" } :
    activeEV.edge >= 0 ? { label: "FAIR", color: "text-muted-foreground", bg: "bg-secondary/40" } :
    activeEV.edge >= -5 ? { label: "OVERPRICED", color: "text-nba-yellow", bg: "bg-nba-yellow/10" } :
    { label: "BAD VALUE", color: "text-nba-red", bg: "bg-nba-red/10" }
  ) : null;

  // All books for the active market with EV
  const activeMarketBooks = allMarketData[activeMarketKey] || [];
  const activeMarketBooksWithEV = activeMarketBooks.map(row => {
    const relevantOdds = (activeMarketKey === "totals" && activeOverUnder === "under") ? row.t2Raw : row.t1Raw;
    const implied = impliedProbLocal(relevantOdds);
    const ev = modelProb ? ((modelProb / 100) * americanToDecimalLocal(relevantOdds) - 1) * 100 : 0;
    const edge = modelProb ? modelProb - implied : 0;
    return { ...row, relevantOdds, implied, ev, edge };
  }).sort((a, b) => b.relevantOdds - a.relevantOdds);

  const bestBook = activeMarketBooksWithEV[0];

  const getEVColorLocal = (ev: number) => {
    if (ev >= 5) return "text-nba-green";
    if (ev >= 0) return "text-nba-blue";
    if (ev >= -5) return "text-nba-yellow";
    return "text-nba-red";
  };

  // Extract model weight categories from factorBreakdown
  const modelWeights = factorBreakdown?.filter((f: any) => f.weight > 0).slice(0, 4) || [];

  return (
    <div className="space-y-3">
      {/* ── COLLAPSIBLE ODDS & EV ANALYSIS HEADER ── */}
      <button
        onClick={() => setShowOddsSection(!showOddsSection)}
        className="w-full vision-card px-4 py-3 flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <div className="text-left">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground/80">Odds & EV Analysis</span>
            <p className="text-[9px] text-muted-foreground/55">{team1.name} vs {team2.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLive && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: 'hsla(158, 64%, 52%, 0.08)', border: '1px solid hsla(158, 64%, 52%, 0.15)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-pulse" />
              <span className="text-[7px] font-bold text-nba-green uppercase tracking-wider">Live</span>
            </div>
          )}
          <motion.div animate={{ rotate: showOddsSection ? 180 : 0 }} transition={{ duration: 0.25 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground/65" />
          </motion.div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {showOddsSection && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden space-y-3"
          >
      {/* ── MODEL vs MARKET HERO CARD ── */}
      {activeEV && modelProb && modelProb > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative rounded-2xl overflow-hidden p-5"
          style={{
            background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)',
            border: `1px solid ${hasPositiveEV ? 'hsla(158,64%,52%,0.25)' : 'hsla(228,30%,22%,0.3)'}`,
          }}
        >
          {hasPositiveEV && <div className="absolute inset-0 bg-gradient-to-b from-[hsla(158,64%,52%,0.06)] to-transparent pointer-events-none" />}
          <div className="relative z-10">
            {/* EV Verdict Banner */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {hasPositiveEV ? (
                  <div className="w-8 h-8 rounded-lg bg-nba-green/15 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-nba-green" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-nba-red/15 flex items-center justify-center">
                    <TrendingDown className="w-4 h-4 text-nba-red" />
                  </div>
                )}
                <div>
                  <p className={`text-[13px] font-extrabold ${hasPositiveEV ? "text-nba-green" : "text-nba-red"}`}>
                    {hasPositiveEV ? "+EV Opportunity" : "Negative EV"}
                  </p>
                  <p className="text-[9px] text-muted-foreground/65">Model vs Market comparison</p>
                </div>
              </div>
              {edgeLabel && (
                <div className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wider ${edgeLabel.bg} ${edgeLabel.color}`}>
                  {edgeLabel.label}
                </div>
              )}
            </div>

            {/* Model vs Implied Grid */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="rounded-xl p-3 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.7)' }}>
                <div className="flex items-center justify-center gap-1 mb-1.5">
                  <Zap className="w-3 h-3 text-accent" />
                  <span className="text-[8px] font-bold uppercase tracking-wider text-accent/60">Our Model</span>
                </div>
                <span className="block text-xl font-extrabold tabular-nums text-accent">{modelProb.toFixed(1)}%</span>
                <span className="block text-[8px] text-muted-foreground/55 mt-0.5">
                  {activeBetType === "moneyline" ? "Win Probability" : "Hit Probability"}
                </span>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.7)' }}>
                <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/65 block mb-1.5">Implied</span>
                <span className="block text-xl font-extrabold tabular-nums text-foreground/60">{activeEV.bestImplied.toFixed(1)}%</span>
                <span className="block text-[8px] text-muted-foreground/55 mt-0.5">Best Book</span>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ background: 'hsla(228, 20%, 10%, 0.7)' }}>
                <div className="flex items-center justify-center gap-1 mb-1.5">
                  <Shield className="w-3 h-3 text-[hsl(var(--nba-cyan))]" />
                  <span className="text-[8px] font-bold uppercase tracking-wider text-[hsl(var(--nba-cyan))]/60">Edge</span>
                </div>
                <span className={`block text-xl font-extrabold tabular-nums ${getEVColorLocal(activeEV.edge)}`}>
                  {activeEV.edge > 0 ? "+" : ""}{activeEV.edge.toFixed(1)}%
                </span>
                <span className="block text-[8px] text-muted-foreground/55 mt-0.5">Model Edge</span>
              </div>
            </div>

            {/* ── MODEL WEIGHTS ── */}
            {modelWeights.length > 0 && (
              <div className="mb-4">
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 block mb-2">Model Weights</span>
                <div className="flex items-center gap-3">
                  {modelWeights.map((f: any, i: number) => {
                    const score = f.team1Score ?? f.score ?? 50;
                    const weightPct = (f.weight * 100).toFixed(0);
                    return (
                      <div key={i} className="text-center flex-1">
                        <span className={`block text-[15px] font-extrabold tabular-nums ${score >= 55 ? 'text-nba-green' : score <= 45 ? 'text-nba-red' : 'text-foreground/70'}`}>
                          {score.toFixed(1)}%
                        </span>
                        <span className="block text-[8px] text-muted-foreground/50 mt-0.5 truncate">
                          {f.label} ({weightPct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Edge Projection Bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/55">Edge Projection</span>
                <span className={`text-[11px] font-extrabold tabular-nums ${getEVColorLocal(activeEV.ev)}`}>
                  EV: {activeEV.ev > 0 ? "+" : ""}{activeEV.ev.toFixed(1)}%
                </span>
              </div>
              <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'hsla(228, 20%, 12%, 0.8)' }}>
                <div
                  className="absolute top-0 left-0 h-full rounded-full opacity-30"
                  style={{ width: `${Math.min(activeEV.bestImplied, 100)}%`, background: 'hsl(228 10% 45%)' }}
                />
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(modelProb, 100)}%` }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className="absolute top-0 left-0 h-full rounded-full"
                  style={{ background: hasPositiveEV
                    ? 'linear-gradient(90deg, hsl(158 64% 52% / 0.8), hsl(158 64% 52% / 0.4))'
                    : 'linear-gradient(90deg, hsl(0 72% 51% / 0.7), hsl(0 72% 51% / 0.3))'
                  }}
                />
                <div
                  className="absolute top-0 h-full w-px bg-foreground/30"
                  style={{ left: `${Math.min(activeEV.bestImplied, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[8px] text-muted-foreground/50">0%</span>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[8px] text-muted-foreground/55">
                    <span className="w-2 h-1 rounded-full" style={{ background: hasPositiveEV ? 'hsl(158 64% 52%)' : 'hsl(0 72% 51%)' }} /> Model
                  </span>
                  <span className="flex items-center gap-1 text-[8px] text-muted-foreground/55">
                    <span className="w-2 h-1 rounded-full bg-muted-foreground/55" /> Implied
                  </span>
                </div>
                <span className="text-[8px] text-muted-foreground/50">100%</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── WHAT IS EDGE & EV EXPLAINER ── */}
      {activeEV && modelProb && modelProb > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)',
            border: '1px solid hsla(250,76%,62%,0.15)',
          }}
        >
          <button
            onClick={() => setShowExplainer(!showExplainer)}
            className="w-full flex items-center justify-between px-4 py-3 text-left group"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                <Info className="w-3.5 h-3.5 text-accent" />
              </div>
              <span className="text-[11px] font-bold text-foreground/70 group-hover:text-foreground transition-colors">
                What do Edge & EV mean?
              </span>
            </div>
            <motion.div animate={{ rotate: showExplainer ? 180 : 0 }} transition={{ duration: 0.25 }}>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/65" />
            </motion.div>
          </button>
          <AnimatePresence initial={false}>
            {showExplainer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-3">
                  <div className="rounded-xl p-3.5 space-y-2" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-[hsl(var(--nba-cyan))]" />
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-[hsl(var(--nba-cyan))]">Edge</span>
                    </div>
                    <p className="text-[11px] text-foreground/60 leading-relaxed">
                      Edge is the difference between what <strong className="text-foreground/80">our model thinks will happen</strong> and what the <strong className="text-foreground/80">sportsbooks think</strong>.
                    </p>
                    <div className="rounded-lg p-3" style={{ background: 'hsla(228, 20%, 8%, 0.7)' }}>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-accent font-bold">Our model: {modelProb.toFixed(0)}%</span>
                        <span className="text-muted-foreground/55">—</span>
                        <span className="text-foreground/50 font-bold">Books: {activeEV.bestImplied.toFixed(0)}%</span>
                        <span className="text-muted-foreground/55">=</span>
                        <span className={`font-extrabold ${activeEV.edge > 0 ? 'text-nba-green' : 'text-nba-red'}`}>{activeEV.edge > 0 ? '+' : ''}{activeEV.edge.toFixed(1)}% edge</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl p-3.5 space-y-2" style={{ background: 'hsla(228, 20%, 10%, 0.6)' }}>
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-3 h-3 text-nba-green" />
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-nba-green">Expected Value (EV)</span>
                    </div>
                    <p className="text-[11px] text-foreground/60 leading-relaxed">
                      EV tells you <strong className="text-foreground/80">how much you'd profit per $100 bet</strong> over time if our model is right.
                    </p>
                    <div className="rounded-lg p-3" style={{ background: 'hsla(228, 20%, 8%, 0.7)' }}>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-muted-foreground/50">This bet's EV:</span>
                        <span className={`font-extrabold ${activeEV.ev > 0 ? 'text-nba-green' : 'text-nba-red'}`}>{activeEV.ev > 0 ? '+' : ''}{activeEV.ev.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ── BEST LINE AVAILABLE ── */}
      {bestBook && modelProb && modelProb > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative rounded-2xl overflow-hidden p-4"
          style={{
            background: 'linear-gradient(127.09deg, hsla(228, 30%, 14%, 0.94) 19.41%, hsla(228, 30%, 8%, 0.49) 76.65%)',
            border: '1px solid hsla(158,64%,52%,0.2)',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-[hsla(158,64%,52%,0.04)] to-transparent pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-nba-green" />
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-nba-green/70">Best Line Available</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden" style={{ background: 'hsla(228, 20%, 14%, 0.6)', border: '1px solid hsla(228, 20%, 22%, 0.3)' }}>
                  {bestBook.logo ? (
                    <img src={bestBook.logo} alt={bestBook.name} className="w-7 h-7 object-contain" />
                  ) : (
                    <span className="text-[12px] font-black text-white">{bestBook.abbrev}</span>
                  )}
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-foreground">{bestBook.name}</p>
                  <p className="text-[10px] text-muted-foreground/65">
                    {activeMarketKey === "totals" 
                      ? `${activeOverUnder.toUpperCase()} ${bestBook.total || ""}`
                      : activeMarketKey === "spreads" 
                      ? `${team1.abbr} ${bestBook.spread1 || ""}`
                      : `${team1.shortName} ML`}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black tabular-nums font-mono text-nba-green">{formatOdds(bestBook.relevantOdds, oddsFormat)}</p>
                <p className="text-[10px] text-muted-foreground/65 tabular-nums">{bestBook.implied.toFixed(1)}% implied</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── EV ACROSS ALL MARKETS ── */}
      {evCards.length > 1 && (
        <div className="vision-card p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(158,64%,52%,0.15), transparent)' }} />
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))', boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.25)' }}>
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55">EV Across All Markets</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {evCards.map((card) => {
              const isActive = card.market === activeMarketKey;
              const evColor = card.ev >= 5 ? "text-nba-green" : card.ev >= 0 ? "text-nba-yellow" : "text-nba-red";
              const evBg = card.ev >= 5 ? "hsla(158, 64%, 52%, 0.08)" : card.ev >= 0 ? "hsla(43, 96%, 56%, 0.08)" : "hsla(0, 72%, 51%, 0.08)";
              const evBorder = card.ev >= 5 ? "hsla(158, 64%, 52%, 0.15)" : card.ev >= 0 ? "hsla(43, 96%, 56%, 0.15)" : "hsla(0, 72%, 51%, 0.15)";
              return (
                <div key={card.market} className={`rounded-xl p-2.5 flex flex-col gap-2 ${isActive ? "ring-1 ring-accent/30" : ""}`} style={{ background: evBg, border: `1px solid ${evBorder}` }}>
                  <div className="text-center">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/65 leading-tight block">{card.label}</span>
                    <span className={`text-lg font-extrabold ${evColor} leading-none mt-0.5 block`}>{card.ev >= 0 ? "+" : ""}{card.ev}%</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-muted-foreground/50">Edge</span>
                      <span className={`font-bold ${evColor}`}>{card.edge >= 0 ? "+" : ""}{card.edge}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-muted-foreground/50">Odds</span>
                      <span className="font-bold text-foreground/80">{formatOdds(card.bestOdds, oddsFormat)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-muted-foreground/50">Book</span>
                      <span className="font-bold text-foreground/80 truncate max-w-[60px]">{card.bestBook}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ALL SPORTSBOOKS for active market ── */}
      {activeMarketBooksWithEV.length > 0 && (
        <AllSportsbooksCollapsible
          activeMarketBooksWithEV={activeMarketBooksWithEV}
          activeMarketKey={activeMarketKey}
          activeOverUnder={activeOverUnder}
          team1={team1}
          modelProb={modelProb}
          oddsFormat={oddsFormat}
          getEVColorLocal={getEVColorLocal}
        />
      )}

      {/* ── OTHER MARKETS TABLE ── */}
      {Object.keys(allMarketData).filter(k => k !== activeMarketKey).length > 0 && (
        <OtherMarketsCollapsible
          allMarketData={allMarketData}
          activeMarketKey={activeMarketKey}
          marketLabels={marketLabels}
          oddsFormat={oddsFormat}
        />
      )}

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN SECTION COMPONENT
   ══════════════════════════════════════════════════════════════ */
interface MoneyLineSectionProps {
  /** When embedded (e.g. in Analyze tab), the parent controls sport */
  embeddedSport?: SportType;
  /** Hide the sport toggle when embedded */
  hideSportToggle?: boolean;
  /** Pre-fill team 1 (full name, e.g. "Boston Celtics") */
  initialTeam1?: string;
  /** Pre-fill team 2 (full name) */
  initialTeam2?: string;
  /** Pre-fill sport */
  initialSport?: string;
  /** Auto-trigger analysis after teams load */
  autoAnalyze?: boolean;
}

const MoneyLineSection: React.FC<MoneyLineSectionProps> = ({ embeddedSport, hideSportToggle = false, initialTeam1, initialTeam2, initialSport, autoAnalyze = false }) => {
  const { profile } = useAuth();
  const oddsFormat = (profile?.odds_format as "american" | "decimal") || "american";
  const isDecimalFormat = oddsFormat === "decimal";
  const [internalSport, setInternalSport] = useState<SportType>(embeddedSport || (initialSport as SportType) || "nba");
  const sport = embeddedSport || internalSport;
  const setSport = embeddedSport ? () => {} : setInternalSport;

  const [betType, setBetType] = useState<BetType>("moneyline");
  const [teams, setTeams] = useState<Team[]>([]);
  const [team1, setTeam1] = useState("");
  const [team2, setTeam2] = useState("");
  const [spreadTeam, setSpreadTeam] = useState("");
  const [spreadLine, setSpreadLine] = useState("");
  const [totalLine, setTotalLine] = useState("");
  const [overUnder, setOverUnder] = useState<"over" | "under">("over");
  const [loading, setLoading] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<any>(null);
  const [showBetInfo, setShowBetInfo] = useState<string | null>(null);
  const [didAutoAnalyze, setDidAutoAnalyze] = useState(false);
  const [paceInfo, setPaceInfo] = useState<{ team: any; pace: any } | null>(null);
  const [b2bInfo, setB2bInfo] = useState<{ team: any; b2b: any } | null>(null);

  useEffect(() => {
    setTeamsLoading(true);
    setTeams([]); setTeam1(""); setTeam2(""); setResults(null); setError("");
    setTotalLine(""); setSpreadLine(""); setSpreadTeam("");
    setOverUnder("over");
    callMoneylineApi("teams", { sport }).then(setTeams).catch(() => {}).finally(() => setTeamsLoading(false));
  }, [sport]);

  // Clear stale results whenever teams change
  useEffect(() => {
    setResults(null);
    setError("");
  }, [team1, team2]);

  // Auto-fill teams and trigger analysis when navigated from Games
  useEffect(() => {
    if (!autoAnalyze || didAutoAnalyze || teams.length === 0 || !initialTeam1 || !initialTeam2) return;
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    const findTeam = (name: string) => teams.find((t) => normalize(t.name).includes(normalize(name)) || normalize(name).includes(normalize(t.name)));
    const t1 = findTeam(initialTeam1);
    const t2 = findTeam(initialTeam2);
    if (t1 && t2) {
      setTeam1(t1.abbr);
      setTeam2(t2.abbr);
      setDidAutoAnalyze(true);
    }
  }, [autoAnalyze, didAutoAnalyze, teams, initialTeam1, initialTeam2]);

  const handleAnalyze = useCallback(async () => {
    if (!team1 || !team2) { setError("Select both teams"); return; }
    if (team1 === team2) { setError("Select two different teams"); return; }
    setLoading(true); setError(""); setResults(null);
    try {
      const body: any = { bet_type: betType, team1, team2, sport };
      if (betType === "spread") {
        if (!spreadLine) { setError("Enter a spread line"); setLoading(false); return; }
        body.spread_team = spreadTeam || team1;
        body.spread_line = spreadLine;
      }
      if (betType === "total") {
        if (!totalLine) { setError("Enter a total line"); setLoading(false); return; }
        body.total_line = totalLine;
        body.over_under = overUnder;
      }
      const data = await callMoneylineApi("analyze", body);
      if (data.error) { setError(data.error); } else {
        setResults(data);
        // Scroll to top so user sees results from the beginning
        requestAnimationFrame(() => {
          const main = document.querySelector("main");
          if (main) main.scrollTo({ top: 0, behavior: "smooth" });
        });
      }
    } catch { setError("Analysis failed. Please try again."); }
    finally { setLoading(false); }
  }, [betType, team1, team2, spreadTeam, spreadLine, totalLine, overUnder, sport]);

  // Auto-trigger analysis once teams are set from Games navigation
  const autoAnalyzeTriggered = React.useRef(false);
  useEffect(() => {
    if (didAutoAnalyze && !autoAnalyzeTriggered.current && team1 && team2) {
      autoAnalyzeTriggered.current = true;
      handleAnalyze();
    }
  }, [didAutoAnalyze, team1, team2, handleAnalyze]);

  return (
    <div className="space-y-3">
      {/* Sport Toggle — only when standalone */}
      {!hideSportToggle && (
        <SegmentedControl
          layoutId="lines-sport"
          options={[
            { value: "nba" as SportType, label: "NBA", icon: <img src={sportNba} alt="NBA" className="w-7 h-7 object-contain" /> },
            { value: "mlb" as SportType, label: "MLB", icon: <img src={sportMlb} alt="MLB" className="w-7 h-7 object-contain" /> },
            { value: "nhl" as SportType, label: "NHL", icon: <img src={sportNhl} alt="NHL" className="w-7 h-7 object-contain" /> },
            { value: "ncaab" as SportType, label: "NCAAB", icon: <img src={sportNcaab} alt="NCAAB" className="w-7 h-7 object-contain" /> },
          ]}
          value={sport}
          onChange={(v) => setSport(v)}
        />
      )}

      {sport === "mlb" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-medium text-nba-yellow" style={{ background: 'hsla(43, 96%, 56%, 0.08)', border: '1px solid hsla(43, 96%, 56%, 0.15)' }}>
          <span>⚠️</span>
          <span>MLB data is from last season. More info will come as the season progresses to help predict outcomes.</span>
        </div>
      )}

      {teamsLoading && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading {sport.toUpperCase()} teams...
        </div>
      )}

      {/* Analysis Type — with info icons */}
      <div className="relative flex rounded-xl p-1 gap-1" style={{
        background: 'hsla(228, 20%, 8%, 0.6)',
        border: '1px solid hsla(228, 30%, 16%, 0.25)',
      }}>
        {([
          { value: "moneyline" as BetType, label: "Moneyline", icon: <DollarSign className="w-3.5 h-3.5" /> },
          { value: "spread" as BetType, label: sport === "mlb" ? "Run Line" : sport === "nhl" ? "Puck Line" : "Spread", icon: <Scale className="w-3.5 h-3.5" /> },
          { value: "total" as BetType, label: "O/U", icon: <Target className="w-3.5 h-3.5" /> },
        ]).map((opt) => {
          const active = betType === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => { setBetType(opt.value); setResults(null); setError(""); }}
              className={`relative flex-1 z-10 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[11px] font-bold tracking-wider transition-all duration-300 ${active ? "text-accent-foreground" : "text-muted-foreground/65 hover:text-foreground/50"}`}
            >
              {active && (
                <motion.div
                  layoutId="lines-bettype"
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))',
                    boxShadow: '0 4px 12px -2px hsla(250,76%,62%,0.3)',
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setShowBetInfo(opt.value); }}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-foreground/60 hover:text-accent hover:bg-accent/15 transition-all z-20"
              >
                <Info className="w-2.5 h-2.5" />
              </button>
              <span className="relative z-10 flex items-center gap-1.5">
                {opt.icon}
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Analysis Type Info Dialog */}
      <AnimatePresence>
        {showBetInfo && (() => {
          const betInfoData: Record<string, { icon: React.ReactNode; title: string; desc: string; exampleAmerican: string; exampleDecimal: string; color: string }> = {
            moneyline: {
              icon: <DollarSign className="w-4 h-4" />,
              title: "Moneyline",
              desc: "The simplest bet — pick which team wins the game outright. No point spread is involved.",
              exampleAmerican: "Lakers are -150 favorites vs Celtics +130. Bet $150 on Lakers to win $100 profit, or bet $100 on Celtics to win $130 profit.",
              exampleDecimal: "Lakers are 1.67 favorites vs Celtics at 2.30. Bet $100 on Lakers for a $167 payout, or $100 on Celtics for a $230 payout.",
              color: "hsl(250 76% 62%)",
            },
            spread: {
              icon: <Scale className="w-4 h-4" />,
              title: "Spread",
              desc: "The favorite must win by more than the spread, while the underdog can lose by less than the spread (or win outright) for the bet to hit.",
              exampleAmerican: "Lakers -5.5 at -110 means they must win by 6+ points. Celtics +5.5 at -110 means they can lose by up to 5 points and the bet still wins.",
              exampleDecimal: "Lakers -5.5 at 1.91 means they must win by 6+ points. Celtics +5.5 at 1.91 means they can lose by up to 5 points and the bet still wins.",
              color: "hsl(210 100% 60%)",
            },
            total: {
              icon: <Target className="w-4 h-4" />,
              title: "Over/Under (Totals)",
              desc: "Bet on whether the combined final score of both teams will be over or under a set number posted by the sportsbook.",
              exampleAmerican: sport === "mlb" ? "Total set at 8.5 (-110 both sides) — if the final score is Dodgers 5, Mets 4 (total 9), the Over wins. If it's 3-2 (5), the Under wins."
                : sport === "nhl" ? "Total set at 5.5 (-110 both sides) — if the final score is Rangers 4, Bruins 3 (total 7), the Over wins. If it's 2-1 (3), the Under wins."
                : "Total set at 215.5 (-110 both sides) — if the final score is Lakers 112, Celtics 108 (total 220), the Over wins. If it's 105-104 (209), the Under wins.",
              exampleDecimal: sport === "mlb" ? "Total set at 8.5 (1.91 both sides) — if the final score is Dodgers 5, Mets 4 (total 9), the Over wins. If it's 3-2 (5), the Under wins."
                : sport === "nhl" ? "Total set at 5.5 (1.91 both sides) — if the final score is Rangers 4, Bruins 3 (total 7), the Over wins. If it's 2-1 (3), the Under wins."
                : "Total set at 215.5 (1.91 both sides) — if the final score is Lakers 112, Celtics 108 (total 220), the Over wins. If it's 105-104 (209), the Under wins.",
              color: "hsl(158 64% 52%)",
            },
          };
          const item = betInfoData[showBetInfo];
          if (!item) return null;
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-6"
              onClick={() => setShowBetInfo(null)}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm rounded-2xl p-5 space-y-4"
                style={{
                  background: 'linear-gradient(127.09deg, hsla(228, 30%, 12%, 0.98) 19.41%, hsla(228, 30%, 6%, 0.95) 76.65%)',
                  border: '1px solid hsla(228, 30%, 22%, 0.3)',
                  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white" style={{ background: item.color }}>
                      {item.icon}
                    </div>
                    <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
                  </div>
                  <button onClick={() => setShowBetInfo(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">&times;</button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{item.desc}</p>
                <div className="rounded-lg p-2.5" style={{ background: 'hsla(228,20%,8%,0.5)', border: '1px solid hsla(228,30%,16%,0.15)' }}>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-accent/70 block mb-1">Example</span>
                  <p className="text-[10px] leading-relaxed text-muted-foreground/80">{isDecimalFormat ? item.exampleDecimal : item.exampleAmerican}</p>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Form Card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="space-y-3"
      >
        <div className="vision-card p-4 space-y-4">
          <TeamSelect label="Team 1" value={team1} onChange={setTeam1} teams={teams} />
          <TeamSelect label="Team 2" value={team2} onChange={setTeam2} teams={teams} />

          {/* Spread fields */}
          {betType === "spread" && (
            <div className="space-y-3 pt-1">
              <div>
              <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2">Spread For</label>
              <SpreadTeamSelector
                team1={team1}
                team2={team2}
                teams={teams}
                spreadTeam={spreadTeam}
                setSpreadTeam={setSpreadTeam}
              />
              </div>
              <div>
                <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2">Spread Line</label>
                <div className="rounded-xl overflow-hidden focus-within:shadow-[0_0_12px_hsla(250,76%,62%,0.06)]" style={{
                  background: 'hsla(228, 20%, 10%, 0.5)',
                  border: '1px solid hsla(228, 30%, 20%, 0.25)',
                }}>
                  <input type="number" value={spreadLine} onChange={(e) => setSpreadLine(e.target.value)} placeholder="-5.5" step="0.5"
                    className="w-full bg-transparent px-3 py-3 text-[13px] font-medium text-foreground placeholder:text-muted-foreground/65 focus:outline-none" />
                </div>
              </div>
            </div>
          )}

          {/* Total fields */}
          {betType === "total" && (
            <div className="space-y-3 pt-1">
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
                        overUnder === "over" ? "text-background" : "text-muted-foreground/35 hover:text-foreground/50"
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
                        overUnder === "under" ? "text-white" : "text-muted-foreground/35 hover:text-foreground/50"
                      }`}
                      style={overUnder === "under" ? { background: 'hsl(0 72% 51%)', boxShadow: '0 4px 12px -2px hsla(0,72%,51%,0.3)' } : {}}
                    >
                      <TrendingDown className="w-3 h-3" />
                      UNDER
                    </motion.button>
                  </div>
                </div>
                <div className="w-24">
                  <label className="block text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55 mb-2 text-center">Total Line</label>
                  <div className="rounded-xl overflow-hidden focus-within:shadow-[0_0_12px_hsla(250,76%,62%,0.06)]" style={{
                    background: 'hsla(228, 20%, 10%, 0.5)',
                    border: '1px solid hsla(228, 30%, 20%, 0.25)',
                  }}>
                    <input type="number" value={totalLine} onChange={(e) => setTotalLine(e.target.value)} placeholder={sport === "ncaab" ? "140.5" : sport === "mlb" ? "8.5" : sport === "nhl" ? "5.5" : "215.5"} step="0.5" min="0"
                      className="w-full bg-transparent py-2.5 text-center text-lg font-extrabold text-foreground placeholder:text-muted-foreground/12 focus:outline-none tabular-nums" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Analyze Button */}
        <motion.button
          onClick={handleAnalyze}
          disabled={loading}
          whileTap={{ scale: 0.97 }}
          className="w-full py-3.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'linear-gradient(135deg, hsl(250 76% 62%), hsl(210 100% 60%))',
            boxShadow: '0 4px 20px -4px hsla(250,76%,62%,0.4)',
          }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Analyze Matchup
        </motion.button>
      </motion.div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-[3px] border-border border-t-accent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-muted-foreground text-xs">Crunching {sport.toUpperCase()} data...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-center text-destructive text-sm">{error}</div>
      )}

      {/* ═══ Live Odds Preview (before analysis) ═══ */}
      {!results && !loading && team1 && team2 && team1 !== team2 && (() => {
        const t1Obj = teams.find((t) => t.abbr === team1);
        const t2Obj = teams.find((t) => t.abbr === team2);
        if (!t1Obj || !t2Obj) return null;
        return (
          <MoneylinePlatformOdds
            team1={t1Obj}
            team2={t2Obj}
            sport={sport}
            activeBetType={betType}
            activeOverUnder={overUnder}
          />
        );
      })()}

      {/* ═══ Results ═══ */}
      {results && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-3"
        >
          {/* Matchup Hero Card */}
          <div className="vision-card p-5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(250,76%,62%,0.2), transparent)' }} />
            <div className="flex items-center justify-between">
              <div className="flex flex-col items-center text-center w-[30%]">
                {results.team1?.logo && <img src={results.team1.logo} alt="" className="w-14 h-14 object-contain mb-1.5 drop-shadow-lg" />}
                <span className="text-xs font-bold text-foreground leading-tight">{results.team1?.shortName}</span>
                <span className="text-[10px] text-muted-foreground/65">{results.team1?.record}</span>
                <HomeAwayBadge value={results.team1?.homeAway} />
              </div>
              <div className="flex flex-col items-center text-center w-[40%]">
                {betType === "moneyline" ? (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl font-black text-nba-green whitespace-nowrap">{results.team1_pct}<span className="text-base">%</span></span>
                      <Swords className="w-4 h-4 text-muted-foreground/55" />
                      <span className="text-2xl font-black text-nba-red whitespace-nowrap">{results.team2_pct}<span className="text-base">%</span></span>
                    </div>
                    <span className="text-[10px] font-bold tracking-[2px] uppercase text-accent">{results.verdict}</span>
                  </>
                ) : (
                  <ConfidenceGauge value={results.confidence} label={results.verdict} />
                )}
              </div>
              <div className="flex flex-col items-center text-center w-[30%]">
                {results.team2?.logo && <img src={results.team2.logo} alt="" className="w-14 h-14 object-contain mb-1.5 drop-shadow-lg" />}
                <span className="text-xs font-bold text-foreground leading-tight">{results.team2?.shortName}</span>
                <span className="text-[10px] text-muted-foreground/65">{results.team2?.record}</span>
                <HomeAwayBadge value={results.team2?.homeAway} />
              </div>
            </div>
            {betType === "moneyline" && (
              <div className="mt-4">
                <div className="flex h-2 rounded-full overflow-hidden" style={{ background: 'hsla(228,20%,10%,0.5)' }}>
                  <div className="bg-nba-green transition-all duration-700 rounded-l-full" style={{ width: `${results.team1_pct}%` }} />
                  <div className="bg-nba-red transition-all duration-700 rounded-r-full" style={{ width: `${results.team2_pct}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground/65">
                  <span>{results.team1?.shortName} {results.team1_pct}%</span>
                  <span>{results.team2_pct}% {results.team2?.shortName}</span>
                </div>
              </div>
            )}
          </div>

          {/* Odds & Value Card */}
          {results.odds && !results.odds.unavailable && results.odds.bestLine ? (
            <div className="vision-card p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsla(158,64%,52%,0.2), transparent)' }} />
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{
                  background: results.odds.ev >= 0
                    ? 'linear-gradient(135deg, hsl(158 64% 52%), hsl(158 64% 40%))'
                    : 'linear-gradient(135deg, hsl(0 72% 51%), hsl(0 72% 40%))',
                  boxShadow: results.odds.ev >= 0
                    ? '0 4px 12px -2px hsla(158,64%,52%,0.25)'
                    : '0 4px 12px -2px hsla(0,72%,51%,0.25)',
                }}>
                  <DollarSign className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/55">Odds & Value</span>
                <div className={`ml-auto px-2.5 py-1 rounded-full text-[10px] font-extrabold ${
                  results.odds.ev >= 5 ? "text-nba-green" : results.odds.ev >= 0 ? "text-nba-yellow" : "text-nba-red"
                }`} style={{
                  background: results.odds.ev >= 5
                    ? 'hsla(158, 64%, 52%, 0.1)'
                    : results.odds.ev >= 0
                    ? 'hsla(43, 96%, 56%, 0.1)'
                    : 'hsla(0, 72%, 51%, 0.1)',
                  border: `1px solid ${
                    results.odds.ev >= 5
                      ? 'hsla(158, 64%, 52%, 0.2)'
                      : results.odds.ev >= 0
                      ? 'hsla(43, 96%, 56%, 0.2)'
                      : 'hsla(0, 72%, 51%, 0.2)'
                  }`,
                }}>
                  {results.odds.ev >= 0 ? "+" : ""}{results.odds.ev.toFixed(1)}% EV
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 rounded-xl" style={{ background: 'hsla(228, 20%, 10%, 0.4)', border: '1px solid hsla(228, 30%, 18%, 0.2)' }}>
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45 mb-1">Model Prob</span>
                  <span className="block text-lg font-extrabold text-accent">{results.odds.impliedProb}%</span>
                </div>
                <div className="text-center p-3 rounded-xl" style={{ background: 'hsla(228, 20%, 10%, 0.4)', border: '1px solid hsla(228, 30%, 18%, 0.2)' }}>
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45 mb-1">Best Odds</span>
                  <span className="block text-lg font-extrabold text-foreground">
                    {formatOdds(results.odds.bestLine.odds, oddsFormat)}
                  </span>
                </div>
                <div className="text-center p-3 rounded-xl" style={{ background: 'hsla(228, 20%, 10%, 0.4)', border: '1px solid hsla(228, 30%, 18%, 0.2)' }}>
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45 mb-1">Best Book</span>
                  <span className="block text-sm font-extrabold text-foreground truncate">{results.odds.bestLine.book}</span>
                </div>
              </div>

              {results.odds.allBooks && results.odds.allBooks.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/45">All Books</span>
                  {results.odds.allBooks.map((b: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg" style={{ background: 'hsla(228,20%,10%,0.3)' }}>
                      <span className="text-[11px] font-semibold text-foreground/80">{b.book}</span>
                      <span className={`text-[12px] font-extrabold tabular-nums ${
                        i === 0 ? "text-nba-green" : "text-foreground/70"
                      }`}>
                        {formatOdds(b.odds, oddsFormat)}
                        {b.point != null && <span className="text-muted-foreground/50 ml-1">({b.point > 0 ? "+" : ""}{b.point})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[8px] text-muted-foreground/40 text-center mt-3 pt-2" style={{ borderTop: '1px solid hsla(228, 18%, 18%, 0.2)' }}>
                EV = (Model Prob × Decimal Odds − 1) × 100 · Positive EV = edge over the market
              </p>
            </div>
          ) : (
            <div className="vision-card p-4">
              <div className="flex items-start gap-2 text-muted-foreground/70">
                <AlertTriangle className="w-4 h-4 text-nba-yellow shrink-0 mt-0.5" />
                <p className="text-[11px]">
                  Live odds for {results.team1?.shortName || results.team1?.name} vs {results.team2?.shortName || results.team2?.name} aren't posted yet. Analysis still uses our model — odds will appear once books publish them.
                </p>
              </div>
            </div>
          )}

          <MoneylinePlatformOdds team1={results.team1} team2={results.team2} sport={results.sport || sport} modelProb={betType === "moneyline" ? results.team1_pct : results.confidence} activeBetType={betType} activeOverUnder={overUnder} factorBreakdown={results.factorBreakdown} />

          {(results.head_to_head || []).length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {(() => {
                const h2h = results.head_to_head;
                const t1Wins = h2h.filter((g: any) => g.team1_winner).length;
                const avgTotal = (h2h.reduce((a: number, g: any) => a + g.team1_score + g.team2_score, 0) / h2h.length).toFixed(0);
                const avgMargin = (h2h.reduce((a: number, g: any) => a + Math.abs(g.team1_score - g.team2_score), 0) / h2h.length).toFixed(1);
                const highScore = Math.max(...h2h.map((g: any) => Math.max(g.team1_score, g.team2_score)));
                return [
                  { label: "H2H", val: `${t1Wins}-${h2h.length - t1Wins}` },
                  { label: "Avg Tot", val: avgTotal },
                  { label: "Avg Mar", val: avgMargin },
                  { label: "High", val: highScore },
                ].map((s) => (
                  <div key={s.label} className="vision-card p-2.5 text-center">
                    <span className="block text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/45 mb-0.5">{s.label}</span>
                    <span className="block text-base font-extrabold text-accent">{s.val}</span>
                  </div>
                ));
              })()}
            </div>
          )}

          <Section title="Head-to-Head Scores">
            <H2HChart h2h={results.head_to_head || []} team1={results.team1} team2={results.team2} />
          </Section>

          {(results.head_to_head || []).length > 0 && (
            <Section title="Score Differential">
              <DifferentialChart h2h={results.head_to_head} team1={results.team1} />
            </Section>
          )}

          {betType === "total" && (results.head_to_head || []).length > 0 && (
            <Section title="Combined Score History">
              <TotalChart h2h={results.head_to_head} line={parseFloat(totalLine)} />
            </Section>
          )}

          <Section title={getPastMeetingsLabel(results.sport || sport)}>
            <H2HTable h2h={results.head_to_head || []} team1={results.team1} team2={results.team2} />
          </Section>


          {results.injuries && (results.injuries.team1?.length > 0 || results.injuries.team2?.length > 0) && (
            <Section title="Injury Report">
              <div className="space-y-4">
                {results.injuries.fetchedAt && (
                  <p className="text-[10px] text-muted-foreground">
                    As of {new Date(results.injuries.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ESPN
                  </p>
                )}
                {[{ team: results.team1, injuries: results.injuries.team1 }, { team: results.team2, injuries: results.injuries.team2 }].map(({ team, injuries }) => (
                  <div key={team.abbr}>
                    <div className="flex items-center gap-2 mb-2">
                      {team.logo && <img src={team.logo} alt="" className="w-4 h-4 object-contain" />}
                      <span className="text-xs font-bold text-foreground">{team.shortName}</span>
                      {injuries.length === 0 && <span className="text-[10px] text-nba-green ml-auto">Healthy</span>}
                    </div>
                    {injuries.length > 0 && (
                      <div className="space-y-1">
                        {injuries.map((inj: any, i: number) => {
                          // Strict normalized enum: "out" | "doubtful" | "questionable" | "day-to-day" | "probable"
                          const status = String(inj.status || "").toLowerCase();
                          const sc =
                            status === "out" ? "text-nba-red" :
                            status === "doubtful" || status === "questionable" ? "text-nba-yellow" :
                            status === "day-to-day" ? "text-nba-yellow" :
                            "text-muted-foreground";
                          const label =
                            status === "day-to-day" ? "Day-To-Day" :
                            status.charAt(0).toUpperCase() + status.slice(1);
                          return (
                            <div key={i} className="flex items-center gap-2 py-1 border-b border-border/20 last:border-0">
                              <AlertTriangle className={`w-2.5 h-2.5 shrink-0 ${sc}`} />
                              <span className="text-[11px] font-medium text-foreground">{inj.name}</span>
                              <span className={`text-[9px] font-bold uppercase tracking-wider ml-auto ${sc}`}>{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {results.splits && (
            <Section title="Home / Away Splits">
              <div className="space-y-4">
                {[{ team: results.team1, splits: results.splits.team1 }, { team: results.team2, splits: results.splits.team2 }].map(({ team, splits }) => (
                  <div key={team.abbr}>
                    <div className="flex items-center gap-2 mb-2">
                      {team.logo && <img src={team.logo} alt="" className="w-4 h-4 object-contain" />}
                      <span className="text-xs font-bold text-foreground">{team.shortName}</span>
                      <HomeAwayBadge value={team.homeAway} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-secondary/40 rounded-xl p-3 text-center">
                        <Home className="w-3.5 h-3.5 mx-auto mb-1 text-nba-green" />
                        <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">Home</span>
                        <span className="block text-sm font-extrabold text-foreground">{splits.home.wins}-{splits.home.losses}</span>
                        <span className="block text-[10px] text-muted-foreground">{(splits.home.winPct * 100).toFixed(0)}% · {splits.home.ppg.toFixed(1)} PPG</span>
                      </div>
                      <div className="bg-secondary/40 rounded-xl p-3 text-center">
                        <Plane className="w-3.5 h-3.5 mx-auto mb-1 text-nba-blue" />
                        <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">Away</span>
                        <span className="block text-sm font-extrabold text-foreground">{splits.away.wins}-{splits.away.losses}</span>
                        <span className="block text-[10px] text-muted-foreground">{(splits.away.winPct * 100).toFixed(0)}% · {splits.away.ppg.toFixed(1)} PPG</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div className="grid grid-cols-2 gap-2">
            {results.back_to_back && (
              <div className="vision-card p-3">
                <h3 className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/45 mb-2">B2B Status</h3>
                {[{ team: results.team1, b2b: results.back_to_back.team1 }, { team: results.team2, b2b: results.back_to_back.team2 }].map(({ team, b2b }) => (
                  <button
                    key={team.abbr}
                    type="button"
                    onClick={() => setB2bInfo({ team, b2b })}
                    className="w-full flex items-center gap-2 py-1.5 border-b last:border-0 hover:bg-white/5 transition-colors rounded-sm px-1 -mx-1 text-left"
                    style={{ borderColor: 'hsla(228,18%,18%,0.3)' }}
                  >
                    {team.logo && <img src={team.logo} alt="" className="w-4 h-4 object-contain" />}
                    <span className="text-[11px] font-semibold text-foreground truncate">{team.shortName}</span>
                    {b2b.isB2B ? (
                      <span className="ml-auto flex items-center justify-center w-5 h-5 rounded-full bg-nba-green/15 text-nba-green">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="ml-auto flex items-center justify-center w-5 h-5 rounded-full bg-nba-red/15 text-nba-red">
                        <X className="w-3 h-3" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {results.pace && (
              <div className="vision-card p-3">
                <h3 className="text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground/45 mb-2">Pace</h3>
                {[{ team: results.team1, pace: results.pace.team1 }, { team: results.team2, pace: results.pace.team2 }].map(({ team, pace }) => (
                  <button
                    key={team.abbr}
                    type="button"
                    onClick={() => setPaceInfo({ team, pace })}
                    className="w-full text-left py-1.5 border-b last:border-0 hover:bg-white/5 transition-colors rounded-sm px-1 -mx-1"
                    style={{ borderColor: 'hsla(228,18%,18%,0.3)' }}
                  >
                    <div className="flex items-center gap-2">
                      {team.logo && <img src={team.logo} alt="" className="w-4 h-4 object-contain" />}
                      <span className="text-[11px] font-semibold text-foreground truncate">{team.shortName}</span>
                      {pace.pace > 0 && (
                        <span className="ml-auto flex items-center gap-0.5 text-[9px] font-bold text-accent">
                          <Zap className="w-2.5 h-2.5" />{pace.pace}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 text-[9px] text-muted-foreground/65 mt-0.5 pl-6">
                      <span>{pace.recentPpg} {results.sport === 'mlb' ? 'RPG' : results.sport === 'nhl' ? 'GPG' : 'PPG'}</span>
                      <span className={pace.recentPpg - pace.recentOppPpg > 0 ? "text-nba-green" : "text-nba-red"}>
                        {(pace.recentPpg - pace.recentOppPpg) > 0 ? "+" : ""}{(pace.recentPpg - pace.recentOppPpg).toFixed(1)} net
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Written Analysis */}
      {results && (
        <WrittenAnalysis
          type="moneyline"
          verdict={results.verdict}
          confidence={results.confidence}
          playerOrTeam={results.decision?.winning_team_name || results.pick || results.team1?.shortName || "Pick"}
          factors={results.factors}
          injuries={results.injuries}
          sport={results.sport}
          factorBreakdown={results.factorBreakdown}
          decision={results.decision}
          team1Name={results.team1?.shortName || results.team1?.name}
          team2Name={results.team2?.shortName || results.team2?.name}
        />
      )}

      {/* Footer badges */}
      <div className="flex items-center justify-center gap-3 pt-2 pb-4">
        {["ADVANCED REAL-TIME DATA", "REAL-TIME ODDS", "AI INSIGHTS"].map((badge) => (
          <span key={badge} className="text-[7px] font-bold uppercase tracking-[0.2em] text-muted-foreground/65 flex items-center gap-1">
            <span className="text-muted-foreground/10">•</span> {badge}
          </span>
        ))}
      </div>

      {/* Pace / PPG explainer popup */}
      <AnimatePresence>
        {paceInfo && (() => {
          const sportLbl = results?.sport === 'mlb' ? 'Runs Per Game (RPG)' : results?.sport === 'nhl' ? 'Goals Per Game (GPG)' : 'Points Per Game (PPG)';
          const unitShort = results?.sport === 'mlb' ? 'RPG' : results?.sport === 'nhl' ? 'GPG' : 'PPG';
          const paceLabel = results?.sport === 'mlb' ? 'run-scoring environment' : results?.sport === 'nhl' ? 'shot/goal context' : 'estimated possessions per game';
          const net = paceInfo.pace.recentPpg - paceInfo.pace.recentOppPpg;
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              onClick={() => setPaceInfo(null)}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: "spring", damping: 25, stiffness: 350 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm rounded-2xl overflow-hidden"
                style={{
                  background: "linear-gradient(145deg, hsla(228, 25%, 12%, 0.95), hsla(228, 25%, 8%, 0.98))",
                  border: "1px solid hsla(250, 76%, 62%, 0.15)",
                  boxShadow: "0 25px 50px -12px hsla(0, 0%, 0%, 0.5), 0 0 40px -10px hsla(250, 76%, 62%, 0.15)",
                }}
              >
                <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, hsla(250,76%,62%,0.3), transparent)" }} />
                <button
                  onClick={() => setPaceInfo(null)}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50 transition-all z-10"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    {paceInfo.team.logo && (
                      <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-white/5" style={{ border: "1px solid hsla(250, 76%, 62%, 0.2)" }}>
                        <img src={paceInfo.team.logo} alt="" className="w-7 h-7 object-contain" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold text-foreground">What is {unitShort}?</h3>
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Pace & Scoring Explained</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-foreground/80 leading-relaxed">
                    <p><span className="font-semibold text-foreground">{sportLbl}</span> is how many points a team averages per game over their recent stretch.</p>
                    <p><span className="font-semibold text-foreground">Net</span> = team's {unitShort} minus what opponents score on them. Positive = outscoring opponents.</p>
                    <p><span className="font-semibold text-foreground">Pace</span> reflects the {paceLabel}. Higher = faster, higher-scoring style.</p>
                  </div>
                  <div
                    className="rounded-xl p-3.5 space-y-1.5"
                    style={{
                      background: "linear-gradient(135deg, hsla(158, 64%, 52%, 0.08), hsla(158, 64%, 52%, 0.03))",
                      border: "1px solid hsla(158, 64%, 52%, 0.12)",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Lightbulb className="w-3 h-3 text-emerald-400/80" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/70">Example</span>
                    </div>
                    <p className="text-[11px] text-foreground/70 leading-relaxed">
                      {paceInfo.team.shortName} average <span className="font-semibold text-foreground">{paceInfo.pace.recentPpg} {unitShort}</span> and allow <span className="font-semibold text-foreground">{paceInfo.pace.recentOppPpg}</span> over their last {paceInfo.pace.recentGames} games — a <span className={net >= 0 ? "text-nba-green font-semibold" : "text-nba-red font-semibold"}>{net >= 0 ? "+" : ""}{net.toFixed(1)} net rating</span>.
                      {paceInfo.pace.pace > 0 ? <> Their pace number of <span className="font-semibold text-foreground">{paceInfo.pace.pace}</span> indicates a {paceInfo.pace.pace > 100 ? "fast" : "controlled"} tempo.</> : null}
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* B2B explainer popup */}
      <AnimatePresence>
        {b2bInfo && (() => {
          const { team, b2b } = b2bInfo;
          const risk = (b2b?.b2bRisk as "low" | "medium" | "high" | null) || "medium";
          const riskColor = risk === "high" ? "text-nba-red" : risk === "low" ? "text-nba-green" : "text-nba-yellow";
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4"
              onClick={() => setB2bInfo(null)}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: "spring", damping: 25, stiffness: 350 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-sm rounded-2xl overflow-hidden"
                style={{
                  background: "linear-gradient(145deg, hsla(228, 25%, 12%, 0.95), hsla(228, 25%, 8%, 0.98))",
                  border: "1px solid hsla(250, 76%, 62%, 0.15)",
                  boxShadow: "0 25px 50px -12px hsla(0, 0%, 0%, 0.5), 0 0 40px -10px hsla(250, 76%, 62%, 0.15)",
                }}
              >
                <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, hsla(250,76%,62%,0.3), transparent)" }} />
                <button
                  onClick={() => setB2bInfo(null)}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50 transition-all z-10"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    {team.logo && (
                      <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-white/5" style={{ border: "1px solid hsla(250, 76%, 62%, 0.2)" }}>
                        <img src={team.logo} alt="" className="w-7 h-7 object-contain" />
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold text-foreground">Back-to-Back Status</h3>
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Fatigue & Rest Explained</p>
                    </div>
                  </div>
                  {b2b?.isB2B ? (
                    <>
                      <p className="text-xs text-foreground/80 leading-relaxed">
                        <span className="font-semibold text-foreground">{team.shortName}</span> is playing on a back-to-back. They played a game yesterday and are on short rest today. Back-to-back games can impact performance — fatigue, reduced minutes for star players, and lower energy late in games are common. This adds <span className={`font-bold ${riskColor}`}>{risk}</span> risk to the play depending on how many key players logged heavy minutes last night.
                      </p>
                      <div
                        className="rounded-xl p-3.5 space-y-1.5"
                        style={{
                          background: "linear-gradient(135deg, hsla(45, 93%, 58%, 0.08), hsla(45, 93%, 58%, 0.03))",
                          border: "1px solid hsla(45, 93%, 58%, 0.12)",
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Lightbulb className="w-3 h-3 text-nba-yellow/80" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-nba-yellow/70">Risk Level</span>
                        </div>
                        <p className={`text-[11px] font-semibold uppercase tracking-wider ${riskColor}`}>{risk} risk</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-foreground/80 leading-relaxed">
                      <span className="font-semibold text-foreground">{team.shortName}</span> is not playing on a back-to-back. No fatigue risk from travel or short rest — this is a neutral factor for this matchup.
                    </p>
                  )}
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};

export default MoneyLineSection;
