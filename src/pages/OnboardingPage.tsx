import { useState, useEffect, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { ComponentType, ReactNode } from "react";
import { ArrowLeft, Lock, TrendingUp, Brain, BarChart3, Calendar, Check, X, Sparkles, ShieldCheck, Swords, CheckCircle2 } from "lucide-react";
import logo from "@/assets/sentinel-lock.jpg";
import { preloadGeneratedImage } from "@/hooks/useGeneratedImage";
import type { WaveModel } from "@/utils/generateImage";

/* ─────────── WaveSpeed asset registry (stadium bg only) ─────────── */
const KREA: WaveModel = "wavespeed-ai/flux-dev/lora/krea";

const ASSETS = {
  stadiumBg: {
    key: "stadium-bg",
    model: KREA,
    prompt: "Cinematic silhouette of a person standing in a massive sports stadium at night, looking out at the field, dramatic purple and violet atmospheric lighting from stadium lights, fog, moody, dark, wide angle, ultra realistic",
  },
};

/* ─────────── Direct CDN image sources ─────────── */
const ESPN_HEADSHOTS = {
  lukaDoncic: "https://a.espncdn.com/i/headshots/nba/players/full/3945274.png",
  jaysonTatum: "https://a.espncdn.com/i/headshots/nba/players/full/4065648.png",
  austinMatthews: "https://a.espncdn.com/i/headshots/nhl/players/full/4024123.png",
};

const ESPN_TEAM_LOGOS = {
  rockies: "https://a.espncdn.com/i/teamlogos/mlb/500/col.png",
};

const SCREEN2_PICKS = [
  { img: ESPN_HEADSHOTS.jaysonTatum, name: "J. Tatum", pick: "OVER 28.5 PTS", conf: 62, ev: 6.1 },
  { img: ESPN_HEADSHOTS.austinMatthews, name: "A. Matthews", pick: "OVER 3.5 SOG", conf: 59, ev: 4.3 },
  { img: ESPN_TEAM_LOGOS.rockies, name: "Rockies", pick: "+1.5", conf: 57, ev: 5.7 },
];

/* ─────────── Official league logos (ESPN CDN) ─────────── */
const SPORT_LOGOS: Record<string, string> = {
  nba: "https://a.espncdn.com/i/teamlogos/leagues/500/nba.png",
  mlb: "https://a.espncdn.com/i/teamlogos/leagues/500/mlb.png",
  nhl: "https://a.espncdn.com/i/teamlogos/leagues/500/nhl.png",
  ufc: "https://a.espncdn.com/i/teamlogos/leagues/500/ufc.png",
};

/* ─────────── Storage keys ─────────── */
const STORAGE = {
  oddsFormat: "sentinel_onboarding_odds_format",
  sports: "sentinel_onboarding_sports",
  referral: "sentinel_onboarding_referral",
  style: "sentinel_onboarding_style",
} as const;

/* ─────────── Sport options ─────────── */
const SPORTS = [
  { id: "nba", label: "NBA" },
  { id: "mlb", label: "MLB" },
  { id: "nhl", label: "NHL" },
  { id: "ufc", label: "UFC" },
];

/* ─────────── Animation ─────────── */
const ease = [0.32, 0.72, 0, 1] as const;
const pageT = { duration: 0.3, ease };

/* ─────────── Atoms ─────────── */
function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      <span className="text-xs font-bold text-white/60 tabular-nums">
        {current} / {total}
      </span>
      <div className="flex gap-1.5 ml-1 items-center">
        {Array.from({ length: total }).map((_, i) => {
          const isActive = i === current - 1;
          const isCompleted = i < current - 1;
          return (
            <motion.div
              key={i}
              animate={{
                width: isActive ? 28 : 14,
                backgroundColor: isActive
                  ? "#00FF6A"
                  : isCompleted
                  ? "rgba(0,255,106,0.7)"
                  : "#2A2A2A",
                boxShadow: isActive
                  ? "0 0 12px rgba(0,255,106,0.8), 0 0 24px rgba(0,255,106,0.45), 0 0 4px rgba(0,255,106,1)"
                  : isCompleted
                  ? "0 0 6px rgba(0,255,106,0.35)"
                  : "0 0 0 rgba(0,0,0,0)",
              }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="h-1.5 rounded-full"
            />
          );
        })}
      </div>
    </div>
  );
}

function GreenCTA({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      disabled={disabled}
      onClick={onClick}
      className={`w-full py-4 rounded-full font-extrabold text-base transition-all ${
        disabled
          ? "bg-[#1a1a1a] text-white/40 cursor-not-allowed"
          : "bg-[#00FF6A] text-black shadow-lg shadow-[#00FF6A]/20 hover:shadow-[#00FF6A]/40"
      }`}
      style={!disabled ? { animation: "pulse-cta 2.5s ease-in-out infinite" } : undefined}
    >
      {children}
    </motion.button>
  );
}

function SectionContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen w-full bg-[#0A0A0A] text-white overflow-x-hidden">
      <style>{`
        @keyframes pulse-cta { 0%,100% { box-shadow: 0 0 0 0 rgba(0,255,106,0.35) } 50% { box-shadow: 0 0 24px 6px rgba(0,255,106,0.45) } }
        @keyframes draw-line { from { stroke-dashoffset: 200 } to { stroke-dashoffset: 0 } }
      `}</style>
      {/* Atmospheric corner glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[520px] h-[420px] rounded-full bg-[#7B2FFF]/30 blur-[120px]" />
        <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full bg-[#641EDC]/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[360px] h-[320px] rounded-full bg-[#00FF6A]/[0.05] blur-[120px]" />
      </div>
      <div className="relative z-10 mx-auto max-w-md px-5 py-6 pb-safe-plus-4 pt-safe-plus-4">
        {children}
      </div>
    </div>
  );
}

/* ─────────── Mini sparkline ─────────── */
function Sparkline({ color = "#00FF6A", down = false, className = "" }: { color?: string; down?: boolean; className?: string }) {
  const points = down
    ? [[2, 10], [12, 18], [22, 15], [32, 28], [42, 30], [52, 38]]
    : [[2, 38], [12, 30], [22, 32], [32, 20], [42, 22], [52, 8]];
  const polyPts = points.map((p) => p.join(",")).join(" ");
  const last = points[points.length - 1];
  const fillPath = `M${points[0][0]},40 L${polyPts.split(" ").join(" L")} L${last[0]},40 Z`;
  const gradId = `sg-${color.replace("#", "")}-${down ? "d" : "u"}`;
  const clipId = `sc-${color.replace("#", "")}-${down ? "d" : "u"}`;
  return (
    <svg viewBox="0 0 54 40" className={className} fill="none" preserveAspectRatio="none" overflow="hidden">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="54" height="40" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Subtle grid */}
        {[10, 20, 30].map((y) => (
          <line key={y} x1="0" y1={y} x2="54" y2={y} stroke="#FFFFFF" strokeOpacity="0.04" strokeWidth="0.5" />
        ))}
        {/* Gradient fill under line */}
        <motion.path
          d={fillPath}
          fill={`url(#${gradId})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        />
        {/* Glowing polyline */}
        <motion.polyline
          points={polyPts}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color}80)` }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
        {/* Dot nodes */}
        {points.slice(0, -1).map(([x, y], i) => (
          <motion.circle
            key={i}
            cx={x}
            cy={y}
            r={1.4}
            fill={color}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1 }}
            transition={{ duration: 0.25, delay: 0.5 + i * 0.08 }}
          />
        ))}
        {/* Bright endpoint */}
        <motion.circle
          cx={last[0]}
          cy={last[1]}
          r={2.4}
          fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 10px ${color})` }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: 1.0 }}
        />
      </g>
    </svg>
  );
}

/* ───────────────────────────────────────────────
   Screen 1 — Hero / Welcome
   ─────────────────────────────────────────────── */
function ScreenHero({ onNext }: { onNext: () => void }) {
  const navigate = useNavigate();
  return (
    <SectionContainer>
      <ProgressDots current={1} total={5} />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageT} className="flex flex-col items-center text-center">
        <div className="relative mb-3">
          <div className="absolute -inset-3 rounded-3xl bg-[#00FF6A]/40 blur-2xl" />
          <div className="absolute -inset-1 rounded-2xl bg-[#00FF6A]/30 blur-xl" />
          <img
            src={logo}
            alt="Sentinel"
            className="relative w-16 h-16 rounded-2xl"
            style={{ boxShadow: "0 0 32px 4px rgba(0,255,106,0.45), 0 0 64px 8px rgba(0,255,106,0.2)" }}
          />
        </div>
        <p className="text-[11px] font-extrabold tracking-[0.4em] text-white/80 mb-6">SENTINEL</p>

        <h1 className="text-[34px] leading-[1.05] font-extrabold text-center tracking-tight">
          Stop guessing.<br />
          <span className="text-[#00FF6A]">Start winning.</span>
        </h1>
        <p className="mt-3 text-sm text-white/60 text-center max-w-xs">
          AI-powered props, data-backed decisions, real edge.
        </p>
      </motion.div>

      {/* App preview card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...pageT, delay: 0.1 }}
        className="mt-6 rounded-2xl border border-[#2A2A2A] bg-[#141414] p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-black tracking-wider text-white/60">TODAY'S PICKS</span>
          <span className="text-[10px] font-semibold text-[#00FF6A]">View All</span>
        </div>
        <div className="flex items-center gap-3">
          <img
            src={ESPN_HEADSHOTS.lukaDoncic}
            alt="Luka Doncic"
            className="w-11 h-11 rounded-full object-cover flex-shrink-0 border border-[#2A2A2A] bg-[#1a1a1a]"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white">Luka Doncic</div>
            <div className="text-[10px] text-white/50">LAKERS vs DENVER · 8:30 PM</div>
            <div className="text-[11px] text-white mt-0.5 font-semibold">OVER 32.5 Points</div>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="px-1.5 py-0.5 rounded bg-nba-green/15 text-nba-green text-[8px] font-bold uppercase tracking-wider">HIGH CONF</span>
            <span className="text-nba-green text-[16px] font-extrabold tabular-nums leading-none">64%</span>
            <span className="text-[8px] text-muted-foreground/55 uppercase tracking-wider">Confidence</span>
            <span className="text-[11px] font-extrabold tabular-nums text-nba-green mt-0.5">
              <span className="text-muted-foreground/55 font-bold">+EV:</span> 7.2%
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">YTD ROI</div>
            <div className="text-base font-black text-nba-green tabular-nums">+18.47%</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Win Rate</div>
            <div className="text-base font-black text-foreground tabular-nums">58.3%</div>
          </div>
          <Sparkline color="hsl(var(--nba-green))" className="w-14 h-10" />
        </div>

        {/* AI Analysis Preview */}
        <div className="mt-3 pt-3 border-t border-[#2A2A2A] space-y-2.5">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded-full bg-[#00FF6A]/15 text-[#00FF6A] text-[8px] font-black tracking-wider">
              IN-DEPTH ANALYSIS
            </span>
            <span className="text-[8px] text-white/40 tracking-wider">SENTINEL AI</span>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <BarChart3 className="w-3 h-3 text-[#3B82F6] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-black tracking-wider text-[#3B82F6]">STATISTICAL EDGE</div>
                <p className="text-[10px] text-white/70 leading-snug">
                  Luka is averaging 34.1 PPG over his last 10 games, comfortably above the 32.5 line. Per-36 projection of 35.8 reinforces the over.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Swords className="w-3 h-3 text-[#00FF6A] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-black tracking-wider text-[#00FF6A]">MATCHUP & PACE</div>
                <p className="text-[10px] text-white/70 leading-snug">
                  Denver allows the 6th-most points to opposing guards. Projected pace of 101.4 favors volume scoring.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <TrendingUp className="w-3 h-3 text-[#A78BFA] flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-black tracking-wider text-[#A78BFA]">VERDICT & RISK</div>
                <p className="text-[10px] text-white/70 leading-snug">
                  Strong lean OVER 32.5. Wager 1.5 units with 64% model confidence. Key risk: early blowout limiting minutes.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-[#00FF6A]/[0.08] border border-[#00FF6A]/25 p-2.5">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#00FF6A]" />
              <span className="text-[11px] font-black text-[#00FF6A] tracking-wide">TAKE THIS PICK</span>
            </div>
            <div className="text-[8px] text-white/40 tracking-wider mt-0.5 mb-1">
              OVERALL VERDICT — ALL FACTORS COMBINED
            </div>
            <p className="text-[10px] text-white/80 leading-snug">
              Strong play. Luka OVER 32.5 Points checks the boxes. L10 avg 34.1, +EV 7.2%. Recommended sizing: 1.5–2 units.
            </p>
            <div className="mt-2 pt-2 border-t border-[#00FF6A]/15 flex items-center justify-between">
              <span className="text-[8px] font-bold tracking-wider text-[#00FF6A]">AI CONFIDENCE: 64%</span>
              <span className="text-[8px] tracking-wider text-white/40">POWERED BY SENTINEL AI</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Feature pills — living micro-previews */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...pageT, delay: 0.18 }}
        className="mt-4 grid grid-cols-3 gap-2.5"
      >
        <FeatureCard title="Live Games" icon={Calendar} ariaLabel="Preview of Live Games feature">
          <LiveGameMini />
        </FeatureCard>
        <FeatureCard title="AI Picks" icon={Brain} ariaLabel="Preview of AI Picks feature">
          <AIPickMini />
        </FeatureCard>
        <FeatureCard title="Profit Tracker" icon={BarChart3} ariaLabel="Preview of Profit Tracker feature">
          <ProfitTrackerMini />
        </FeatureCard>
      </motion.div>

      {/* CTA */}
      <div className="mt-6">
        <GreenCTA onClick={onNext}>Get Started</GreenCTA>
        <p className="text-center text-[11px] text-white/50 mt-3">
          Already have an account?{" "}
          <button onClick={() => navigate("/auth")} className="text-[#00FF6A] underline font-semibold">Sign in</button>
        </p>
      </div>
    </SectionContainer>
  );
}

/* ───────────────────────────────────────────────
   Screen 2 — Value Prop
   ─────────────────────────────────────────────── */
function ScreenValue({ onNext }: { onNext: () => void }) {
  return (
    <SectionContainer>
      <ProgressDots current={2} total={5} />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageT}>
        <h1 className="text-[32px] leading-[1.05] font-extrabold tracking-tight">
          See What You're<br />Missing.
        </h1>
        <p className="mt-2 text-sm text-white/60">Pros don't guess. They use data.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...pageT, delay: 0.1 }}
        className="mt-5 rounded-2xl border border-[#2A2A2A] bg-[#141414] p-3.5"
      >
        {/* App header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <img src={logo} alt="" className="w-5 h-5 rounded-md" />
            <span className="text-[10px] font-bold tracking-widest text-white">SENTINEL</span>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-3 overflow-hidden">
          {["Dashboard", "Picks", "Tracker", "Parlay"].map((t, i) => (
            <span
              key={t}
              className={`px-2 py-1 rounded-full text-[9px] font-bold whitespace-nowrap ${
                i === 0 ? "bg-[#00FF6A] text-black" : "text-white/50"
              }`}
            >
              {t}
            </span>
          ))}
        </div>

        {/* Top picks header */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-black tracking-wider text-white/60">TODAY'S TOP PICKS</span>
          <span className="text-[9px] font-semibold text-[#00FF6A]">View All</span>
        </div>

        {/* Picks rows */}
        <div className="space-y-1.5">
          {SCREEN2_PICKS.map((p) => (
            <div key={p.name} className="flex items-center gap-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] px-2 py-1.5">
              <img
                src={p.img}
                alt={p.name}
                className="w-7 h-7 rounded-full object-cover flex-shrink-0 bg-[#1a1a1a]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-white truncate">{p.name}</div>
                <div className="text-[9px] text-white/50">{p.pick}</div>
              </div>
              <span className="text-[#00FF6A] text-xs font-extrabold tabular-nums">{p.conf}%</span>
              <span className="px-1.5 py-0.5 rounded bg-[#00FF6A]/15 text-[#00FF6A] text-[8px] font-black tracking-wider">+EV {p.ev}%</span>
            </div>
          ))}
        </div>

        {/* YTD performance */}
        <div className="mt-3 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] p-2.5 flex items-center justify-between">
          <div>
            <div className="text-[9px] tracking-wider text-white/50">YTD PERFORMANCE</div>
            <div className="text-lg font-extrabold text-[#00FF6A] tabular-nums">+18.47%</div>
          </div>
          <Sparkline className="w-16 h-10" />
        </div>

        {/* Locked blurred area */}
        <div className="mt-2 relative rounded-lg overflow-hidden border border-[#2A2A2A]">
          <div className="absolute inset-0 backdrop-blur-sm bg-[#0A0A0A]/80" />
          <div className="relative px-3 py-3 flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-white/60" />
            <div className="flex-1">
              <div className="text-[10px] font-bold text-white">Advanced Projections & Line Movement</div>
              <div className="text-[9px] text-white/50">Upgrade to Unlock</div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Social proof */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...pageT, delay: 0.18 }}
        className="mt-4 rounded-2xl border border-[#2A2A2A] bg-[#141414] p-3 flex items-center gap-3"
      >
        <div className="flex -space-x-2">
          {[11, 12, 13].map((i) => (
            <img
              key={i}
              src={`https://i.pravatar.cc/80?img=${i}`}
              alt="user"
              className="w-8 h-8 rounded-full border-2 border-[#141414] object-cover bg-[#1a1a1a]"
            />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-white">10,000+ users joined this week</div>
          <div className="text-[11px] font-bold text-[#00FF6A]">20% Average ROI Increase</div>
        </div>
      </motion.div>

      <div className="mt-6">
        <GreenCTA onClick={onNext}>Continue</GreenCTA>
      </div>
    </SectionContainer>
  );
}

/* ───────────────────────────────────────────────
   Screen 3 — Personalize
   ─────────────────────────────────────────────── */
function ScreenPersonalize({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [oddsFormat, setOddsFormat] = useState<"american" | "decimal" | null>(() => {
    try { return (localStorage.getItem(STORAGE.oddsFormat) as any) || "american"; } catch { return "american"; }
  });
  const [sports, setSports] = useState<string[]>(() => {
    try { const r = localStorage.getItem(STORAGE.sports); return r ? JSON.parse(r) : ["nba"]; } catch { return ["nba"]; }
  });
  const [customSport, setCustomSport] = useState<string>(() => {
    const existing = sports.find((s) => s.startsWith("other:"));
    return existing ? existing.slice(6) : "";
  });
  const [otherActive, setOtherActive] = useState<boolean>(() => sports.some((s) => s.startsWith("other:")));

  const toggleSport = (id: string) =>
    setSports((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const toggleOther = () => {
    setOtherActive((prev) => {
      const next = !prev;
      if (!next) {
        setSports((s) => s.filter((x) => !x.startsWith("other:")));
        setCustomSport("");
      }
      return next;
    });
  };

  const updateCustomSport = (value: string) => {
    const trimmed = value.slice(0, 40);
    setCustomSport(trimmed);
    setSports((s) => {
      const without = s.filter((x) => !x.startsWith("other:"));
      const clean = trimmed.trim();
      return clean ? [...without, `other:${clean}`] : without;
    });
  };

  const otherValid = !otherActive || customSport.trim().length > 0;
  const canContinue = !!oddsFormat && sports.length > 0 && otherValid;

  const handleNext = () => {
    if (!canContinue) return;
    try {
      localStorage.setItem(STORAGE.oddsFormat, oddsFormat!);
      localStorage.setItem(STORAGE.sports, JSON.stringify(sports));
    } catch {}
    onNext();
  };

  return (
    <SectionContainer>
      <ProgressDots current={3} total={5} />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageT}>
        <h1 className="text-[32px] leading-[1.05] font-extrabold tracking-tight">Make It Yours.</h1>
        <p className="mt-2 text-sm text-white/60">We'll personalize your experience.</p>
      </motion.div>

      {/* Odds format */}
      <div className="mt-6">
        <p className="text-[10px] font-black tracking-wider text-white/60 mb-1">ODDS FORMAT</p>
        <p className="text-xs text-white/50 mb-3">We'll show odds the way you like them.</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "american" as const, label: "American", sample: "+150 -110" },
            { id: "decimal" as const, label: "Decimal", sample: "2.50 1.91" },
          ].map((o) => {
            const active = oddsFormat === o.id;
            return (
              <motion.button
                key={o.id}
                onClick={() => setOddsFormat(o.id)}
                whileTap={{ scale: 0.97 }}
                className={`rounded-xl border px-3 py-3 text-left transition-all ${
                  active
                    ? "border-[#00FF6A] bg-[#00FF6A]/5 shadow-[0_0_18px_rgba(0,255,106,0.15)]"
                    : "border-[#2A2A2A] bg-[#141414]"
                }`}
              >
                <div className={`text-sm font-bold ${active ? "text-[#00FF6A]" : "text-white"}`}>{o.label}</div>
                <div className={`text-xs font-mono mt-0.5 ${active ? "text-[#00FF6A]/80" : "text-white/50"}`}>{o.sample}</div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Sports */}
      <div className="mt-6">
        <p className="text-[10px] font-black tracking-wider text-white/60 mb-1">SPORTS YOU BET ON</p>
        <p className="text-xs text-white/50 mb-3">Select all that apply.</p>
        <div className="grid grid-cols-2 gap-3">
          {SPORTS.map((s) => {
            const active = sports.includes(s.id);
            return (
              <motion.button
                key={s.id}
                onClick={() => toggleSport(s.id)}
                whileTap={{ scale: 0.97 }}
                className={`relative rounded-xl border p-3 transition-all ${
                  active
                    ? "border-[#00FF6A] bg-[#00FF6A]/5 shadow-[0_0_18px_rgba(0,255,106,0.15)]"
                    : "border-[#2A2A2A] bg-[#141414]"
                }`}
              >
                {active && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#00FF6A] flex items-center justify-center">
                    <Check className="w-3 h-3 text-black" strokeWidth={3} />
                  </div>
                )}
                <div className="flex justify-center mb-2">
                  <img
                    src={SPORT_LOGOS[s.id]}
                    alt={s.label}
                    className={`w-12 h-12 object-contain transition-all ${active ? "" : "opacity-60 grayscale"}`}
                  />
                </div>
                <div className={`text-center text-sm font-bold ${active ? "text-[#00FF6A]" : "text-white"}`}>{s.label}</div>
              </motion.button>
            );
          })}
        </div>

        {/* Other tile — full width */}
        <motion.button
          type="button"
          onClick={toggleOther}
          whileTap={{ scale: 0.98 }}
          className={`mt-3 relative w-full rounded-xl border p-3 flex items-center gap-3 transition-all ${
            otherActive
              ? "border-[#00FF6A] bg-[#00FF6A]/5 shadow-[0_0_18px_rgba(0,255,106,0.15)]"
              : "border-[#2A2A2A] bg-[#141414]"
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-black shrink-0 ${otherActive ? "bg-[#00FF6A]/15 text-[#00FF6A]" : "bg-white/5 text-white/60"}`}>
            +
          </div>
          <div className="flex-1 text-left">
            <div className={`text-sm font-bold ${otherActive ? "text-[#00FF6A]" : "text-white"}`}>Other</div>
            <div className="text-[11px] text-white/50">Esports, Soccer, Tennis, and more</div>
          </div>
          {otherActive && (
            <div className="w-5 h-5 rounded-full bg-[#00FF6A] flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-black" strokeWidth={3} />
            </div>
          )}
        </motion.button>

        {otherActive && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3"
          >
            <input
              type="text"
              value={customSport}
              onChange={(e) => updateCustomSport(e.target.value)}
              placeholder="e.g. Esports, Soccer, Tennis…"
              maxLength={40}
              autoFocus
              className="w-full rounded-xl border border-[#2A2A2A] bg-[#141414] px-3 py-3 text-sm text-white placeholder:text-white/30 focus:border-[#00FF6A] focus:outline-none focus:ring-1 focus:ring-[#00FF6A]/40"
            />
          </motion.div>
        )}
      </div>

      <div className="mt-5 flex items-start gap-2 text-[11px] text-white/50">
        <Sparkles className="w-3.5 h-3.5 text-[#00FF6A] flex-shrink-0 mt-0.5" />
        <span>We'll personalize picks &amp; insights based on your preferences.</span>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={onBack} className="px-5 py-3 text-sm font-semibold text-white/70">
          <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
        </button>
        <div className="flex-1">
          <GreenCTA onClick={handleNext} disabled={!canContinue}>Next</GreenCTA>
        </div>
      </div>
    </SectionContainer>
  );
}

/* ───────────────────────────────────────────────
   Screen 4 — Without vs With
   ─────────────────────────────────────────────── */
function ScreenComparison({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <SectionContainer>
      <ProgressDots current={4} total={6} />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageT}>
        <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-tight">
          Don't Bet Blind.<br />
          <span className="text-[#00FF6A]">See The Difference.</span>
        </h1>
        <p className="mt-2 text-sm text-white/60">Data beats luck. Every time.</p>
      </motion.div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {/* WITHOUT */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...pageT, delay: 0.1 }}
          className="rounded-2xl border border-[#FF3B3B]/30 bg-[#141414] p-2.5"
          style={{ boxShadow: "inset 0 0 30px rgba(255,59,59,0.06)" }}
        >
          <div className="text-[9px] font-black tracking-wider text-white/60 mb-2">WITHOUT SENTINEL</div>
          <div className="text-2xl font-extrabold text-[#FF3B3B] tabular-nums leading-none">-12.34%</div>
          <div className="text-[10px] text-white/50 mt-1">ROI After 30 Days</div>
          <div className="mt-2 flex justify-center"><Sparkline color="#FF3B3B" down className="h-12 w-full max-w-[120px]" /></div>
          <div className="mt-3 space-y-1.5">
            {["Guessing & Hope", "Emotional Bets", "Chasing Losses", "No Real Strategy"].map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <X className="w-3 h-3 text-[#FF3B3B] flex-shrink-0" strokeWidth={3} />
                <span className="text-[10px] text-white/70">{t}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* WITH */}
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...pageT, delay: 0.18 }}
          className="rounded-2xl border border-[#00FF6A]/40 bg-[#141414] p-2.5"
          style={{ boxShadow: "inset 0 0 30px rgba(0,255,106,0.08), 0 0 24px rgba(0,255,106,0.12)" }}
        >
          <div className="text-[9px] font-black tracking-wider text-[#00FF6A] mb-2">WITH SENTINEL</div>
          <div className="text-2xl font-extrabold text-[#00FF6A] tabular-nums leading-none">+18.47%</div>
          <div className="text-[10px] text-white/50 mt-1">ROI After 30 Days</div>
          <div className="mt-2 flex justify-center"><Sparkline color="#00FF6A" className="h-12 w-full max-w-[120px]" /></div>
          <div className="mt-3 space-y-1.5">
            {["AI-Powered Picks", "High Confidence & +EV", "Track & Improve", "Smarter Parlays"].map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-[#00FF6A] flex-shrink-0" strokeWidth={3} />
                <span className="text-[10px] text-white/70">{t}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Testimonial */}
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...pageT, delay: 0.26 }}
        className="mt-5 rounded-2xl border border-[#2A2A2A] bg-[#141414] p-4 flex items-start gap-3"
      >
        <img
          src="https://i.pravatar.cc/100?img=11"
          alt="Mike R."
          className="w-12 h-12 rounded-full flex-shrink-0 border border-[#2A2A2A] object-cover bg-[#1a1a1a]"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-white/80 italic leading-snug">
            "I was skeptical at first. Now I'm up 23% this season. Sentinel changed the way I bet."
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-bold text-white">- Mike R.</span>
            <span className="px-1.5 py-0.5 rounded bg-[#00FF6A] text-black text-[8px] font-black tracking-wider flex items-center gap-0.5">
              <ShieldCheck className="w-2.5 h-2.5" strokeWidth={3} /> VERIFIED
            </span>
          </div>
        </div>
      </motion.div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={onBack} className="px-5 py-3 text-sm font-semibold text-white/70">
          <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
        </button>
        <div className="flex-1">
          <GreenCTA onClick={onNext}>Continue</GreenCTA>
        </div>
      </div>
    </SectionContainer>
  );
}

/* ───────────────────────────────────────────────
   Top-level Onboarding orchestrator
   ─────────────────────────────────────────────── */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Default referral if missing (used downstream)
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE.referral)) {
        localStorage.setItem(STORAGE.referral, "Direct");
      }
    } catch {}
  }, []);

  // Batch-preload all WaveSpeed assets in parallel on mount.
  // Stadium (slowest) and avatars get fired immediately.
  useEffect(() => {
    Object.values(ASSETS).forEach((a) => {
      preloadGeneratedImage(a.prompt, a.key, a.model);
    });
  }, []);

  const goNext = () => setStep((s) => s + 1);
  const goBack = () => setStep((s) => Math.max(0, s - 1));
  const goPaywall = () => navigate("/paywall");

  const screens = [
    <ScreenHero key="s1" onNext={goNext} />,
    <ScreenValue key="s2" onNext={goNext} />,
    <ScreenPersonalize key="s3" onBack={goBack} onNext={goNext} />,
    <ScreenComparison key="s4" onBack={goBack} onNext={goPaywall} />,
  ];

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={pageT}
      >
        {screens[step]}
      </motion.div>
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────
   Feature micro-preview subcomponents
   ─────────────────────────────────────────────── */
const microEase = [0.32, 0.72, 0, 1] as const;

function FeatureCard({
  title,
  icon: Icon,
  ariaLabel,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={ariaLabel}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="rounded-xl border border-border/40 bg-card/80 p-3 text-left flex flex-col gap-2 overflow-hidden focus:outline-none shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
    >
      <div className="flex items-center justify-between border-b border-border/20 pb-1.5 mb-0.5">
        <div className="text-[11px] font-bold text-white">{title}</div>
        <Icon className="w-3.5 h-3.5 opacity-50" style={{ color: "hsl(var(--nba-green) / 0.7)" }} />
      </div>
      <div className="min-h-[56px] flex items-center">{children}</div>
    </motion.button>
  );
}

function LiveGameMini() {
  const reduce = useReducedMotion();
  const [seconds, setSeconds] = useState(134);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setSeconds((s) => (s <= 1 ? 134 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [reduce]);
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toString().padStart(2, "0");

  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <motion.span
          className="w-1.5 h-1.5 rounded-full bg-nba-red"
          animate={reduce ? undefined : { opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="text-[8px] font-black uppercase tracking-wider text-nba-red">LIVE</span>
        <span className="ml-auto text-[8px] text-muted-foreground/55 tabular-nums">Q4 · {m}:{s}</span>
      </div>
      <div className="flex items-center justify-between bg-white/[0.03] rounded-md px-1.5 py-1">
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#FDB927]" />
          <span className="text-[10px] font-bold text-white/90">LAL</span>
        </div>
        <span className="text-[12px] font-extrabold tabular-nums text-white">108–112</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-white/90">BOS</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#007A33]" />
        </div>
      </div>
      <div className="text-[7px] text-muted-foreground/55 mt-0.5">NBA · MLB · NHL</div>
    </div>
  );
}

function AIPickMini() {
  const reduce = useReducedMotion();
  const radius = 9;
  const c = 2 * Math.PI * radius;
  const pct = 64;
  const offset = c - (pct / 100) * c;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative w-6 h-6 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r={radius} fill="none" stroke="hsl(var(--muted) / 0.3)" strokeWidth="2" />
            <motion.circle
              cx="11" cy="11" r={radius}
              fill="none"
              stroke="hsl(var(--nba-green))"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={c}
              initial={{ strokeDashoffset: reduce ? offset : c }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 0.6, ease: microEase }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[8px] font-black tabular-nums text-nba-green">{pct}</span>
          </div>
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <span className="text-[9px] font-bold text-white/90 truncate">OVER 32.5</span>
          <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground/55">PTS</span>
        </div>
      </div>
      <div className="border-t border-border/20 pt-1.5">
        <span
          className="self-start text-nba-green text-[9px] font-extrabold tabular-nums px-2 py-0.5 rounded"
          style={{ backgroundColor: "hsl(var(--nba-green) / 0.15)" }}
        >
          +EV 7.2%
        </span>
      </div>
    </div>
  );
}

function ProfitTrackerMini() {
  const reduce = useReducedMotion();
  const points = "0,20 10,17 20,18 30,13 40,14 50,9 60,10 70,5 80,6 90,2";
  const lastX = 90;
  const lastY = 2;

  return (
    <div className="w-full flex flex-col gap-1.5">
      <svg viewBox="0 0 92 24" className="w-full h-7 overflow-visible">
        <motion.polyline
          points={points}
          fill="none"
          stroke="hsl(var(--nba-green))"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: microEase }}
        />
        <motion.circle
          cx={lastX}
          cy={lastY}
          r="1.5"
          fill="hsl(var(--nba-green))"
          initial={{ opacity: reduce ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.9, duration: 0.2 }}
          style={{ filter: "drop-shadow(0 0 3px hsl(var(--nba-green)))" }}
        />
      </svg>
      <div className="inline-block rounded px-1.5 py-0.5" style={{ backgroundColor: "hsl(var(--nba-green) / 0.06)" }}>
        <div className="text-[13px] font-extrabold tabular-nums text-nba-green leading-none">+$1,284</div>
      </div>
      <div className="text-[8px] uppercase tracking-wider text-muted-foreground/55 mt-0.5">30D · ROI +18%</div>
    </div>
  );
}
