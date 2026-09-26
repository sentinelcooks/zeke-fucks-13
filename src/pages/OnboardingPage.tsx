import { createContext, useState, useEffect, useCallback, useContext, useRef, memo, useMemo, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { ComponentType, ReactNode } from "react";
import { ArrowLeft, Lock, TrendingUp, Brain, BarChart3, Calendar, Check, X, Sparkles, ShieldCheck, Swords, CheckCircle2, ChevronDown } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";

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

const ONBOARDING_IMAGE_URLS = [
  ...Object.values(ESPN_HEADSHOTS),
  ...Object.values(ESPN_TEAM_LOGOS),
  ...Object.values(SPORT_LOGOS),
  "https://i.pravatar.cc/80?img=11",
  "https://i.pravatar.cc/80?img=12",
  "https://i.pravatar.cc/80?img=13",
  "https://i.pravatar.cc/100?img=11",
];

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
const stepT = { duration: 0.14, ease };
const stepVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 10 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -8, pointerEvents: "none" as const }),
};

const LightweightMotionContext = createContext(false);

function useLightweightMotion() {
  const lightweight = useContext(LightweightMotionContext);
  const reduce = useReducedMotion();
  return lightweight || !!reduce;
}

/* ─────────── Atoms ─────────── */
function ProgressDots({ current, total }: { current: number; total: number }) {
  const lightweight = useLightweightMotion();
  return (
    <div className="flex items-center gap-2 mb-6">
      <span className="text-xs font-bold text-foreground/60 tabular-nums">
        {current} / {total}
      </span>
      <div className="flex gap-1.5 ml-1 items-center">
        {Array.from({ length: total }).map((_, i) => {
          const isActive = i === current - 1;
          const isCompleted = i < current - 1;
          return (
            <motion.div
              key={i}
              animate={lightweight ? undefined : {
                width: isActive ? 28 : 14,
                backgroundColor: isActive
                  ? "hsl(var(--primary))"
                  : isCompleted
                  ? "hsl(var(--primary) / 0.7)"
                  : "hsl(var(--secondary))",
                boxShadow: isActive
                  ? "0 0 12px hsl(var(--primary) / 0.8), 0 0 24px hsl(var(--primary) / 0.45), 0 0 4px hsl(var(--primary) / 1)"
                  : isCompleted
                  ? "0 0 6px hsl(var(--primary) / 0.35)"
                  : "0 0 0 rgba(0,0,0,0)",
              }}
              transition={lightweight ? { duration: 0 } : { duration: 0.25, ease: "easeOut" }}
              className="h-1.5 rounded-full"
              style={lightweight ? {
                width: isActive ? 28 : 14,
                backgroundColor: isActive ? "hsl(var(--primary))" : isCompleted ? "hsl(var(--primary) / 0.7)" : "hsl(var(--secondary))",
              } : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function GreenCTA({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  const lightweight = useLightweightMotion();
  return (
    <motion.button
      whileTap={lightweight ? undefined : { scale: 0.97 }}
      disabled={disabled}
      onClick={onClick}
      className={`w-full py-4 rounded-full font-extrabold text-base transition-all ${
        disabled
          ? "bg-card text-muted-foreground/60 cursor-not-allowed"
          : "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-primary/40"
      }`}
      style={!disabled && !lightweight ? { animation: "pulse-cta 2.5s ease-in-out infinite" } : undefined}
    >
      {children}
    </motion.button>
  );
}

function SectionContainer({ children }: { children: React.ReactNode }) {
  const lightweight = useLightweightMotion();
  return (
    <div className="relative min-h-screen-safe w-full bg-background text-foreground overflow-x-hidden">
      <style>{`
        @keyframes pulse-cta { 0%,100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.35) } 50% { box-shadow: 0 0 24px 6px hsl(var(--primary) / 0.45) } }
        @keyframes draw-line { from { stroke-dashoffset: 200 } to { stroke-dashoffset: 0 } }
      `}</style>
      {lightweight ? (
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)_/_0.16),transparent_46%)]" />
      ) : (
        /* Atmospheric corner glows stay off the phone compositing path. */
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[520px] h-[420px] rounded-full bg-primary/30 blur-[120px]" />
          <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full bg-primary/20 blur-[120px]" />
          <div className="absolute bottom-0 right-0 w-[360px] h-[320px] rounded-full bg-primary/[0.05] blur-[120px]" />
        </div>
      )}
      <div className="relative z-10 mx-auto max-w-md px-5 py-6 pb-safe-plus-4 pt-safe-plus-4">
        {children}
      </div>
    </div>
  );
}

/* ─────────── Mini sparkline ─────────── */
function Sparkline({ color = "hsl(var(--primary))", down = false, className = "" }: { color?: string; down?: boolean; className?: string }) {
  const lightweight = useLightweightMotion();
  const points = down
    ? [[2, 10], [12, 18], [22, 15], [32, 28], [42, 30], [52, 38]]
    : [[2, 38], [12, 30], [22, 32], [32, 20], [42, 22], [52, 8]];
  const polyPts = points.map((p) => p.join(",")).join(" ");
  const last = points[points.length - 1];
  const fillPath = `M${points[0][0]},40 L${polyPts.split(" ").join(" L")} L${last[0]},40 Z`;
  const colorKey = color.replace(/[^a-z0-9]/gi, "");
  const gradId = `sg-${colorKey}-${down ? "d" : "u"}`;
  const clipId = `sc-${colorKey}-${down ? "d" : "u"}`;
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
          <line key={y} x1="0" y1={y} x2="54" y2={y} stroke="hsl(var(--foreground))" strokeOpacity="0.06" strokeWidth="0.5" />
        ))}
        {/* Gradient fill under line */}
        <motion.path
          d={fillPath}
          fill={`url(#${gradId})`}
          initial={lightweight ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={lightweight ? { duration: 0 } : { duration: 0.6, delay: 0.3 }}
        />
        {/* Glowing polyline */}
        <motion.polyline
          points={polyPts}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={lightweight ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={lightweight ? { duration: 0 } : { duration: 1.1, ease: "easeOut" }}
        />
        {/* Dot nodes */}
        {points.slice(0, -1).map(([x, y], i) => (
          <motion.circle
            key={i}
            cx={x}
            cy={y}
            r={1.4}
            fill={color}
            initial={lightweight ? false : { opacity: 0, scale: 0 }}
            animate={{ opacity: 0.85, scale: 1 }}
            transition={lightweight ? { duration: 0 } : { duration: 0.25, delay: 0.5 + i * 0.08 }}
          />
        ))}
        {/* Bright endpoint */}
        <motion.circle
          cx={last[0]}
          cy={last[1]}
          r={2.4}
          fill={color}
          style={lightweight ? undefined : { filter: `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 10px ${color})` }}
          initial={lightweight ? false : { opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={lightweight ? { duration: 0 } : { duration: 0.35, delay: 1.0 }}
        />
      </g>
    </svg>
  );
}

/* ───────────────────────────────────────────────
   Screen 1 — Hero / Welcome
   ─────────────────────────────────────────────── */
const ScreenHero = memo(function ScreenHero() {
  const lightweight = useLightweightMotion();
  return (
    <SectionContainer>
      <ProgressDots current={1} total={5} />

      <motion.div initial={lightweight ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : pageT} className="flex flex-col items-center text-center">
        <div className="relative mb-3">
          {!lightweight && <div className="absolute -inset-3 rounded-3xl bg-primary/40 blur-2xl" />}
          {!lightweight && <div className="absolute -inset-1 rounded-2xl bg-primary/30 blur-xl" />}
          <BrandMark size={64} className="relative" />
        </div>
        <p className="text-[11px] font-extrabold tracking-[0.4em] text-foreground/80 mb-6">SENTINEL</p>

        <h1 className="text-[34px] leading-[1.05] font-extrabold text-center tracking-tight">
          Stop guessing.<br />
          <span className="text-primary">Start winning.</span>
        </h1>
        <p className="mt-3 text-sm text-foreground/60 text-center max-w-xs">
          AI-powered props, data-backed decisions, real edge.
        </p>
      </motion.div>

      {/* App preview card */}
      <motion.div
        initial={lightweight ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : { ...pageT, delay: 0.1 }}
        className="mt-6 rounded-2xl border border-border bg-card p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-black tracking-wider text-foreground/60">TODAY'S PICKS</span>
          <span className="text-[10px] font-semibold text-primary">View All</span>
        </div>
        <div className="flex items-center gap-3">
          <img
            src={ESPN_HEADSHOTS.lukaDoncic}
            alt="Luka Doncic"
            className="w-11 h-11 rounded-full object-cover flex-shrink-0 border border-border bg-card"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-foreground">Luka Doncic</div>
            <div className="text-[10px] text-foreground/50">LAKERS vs DENVER · 8:30 PM</div>
            <div className="text-[11px] text-foreground mt-0.5 font-semibold">OVER 32.5 Points</div>
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
        <div className="mt-3 pt-3 border-t border-border space-y-2.5">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[8px] font-black tracking-wider">
              IN-DEPTH ANALYSIS
            </span>
            <span className="text-[8px] text-foreground/40 tracking-wider">SENTINEL AI</span>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <BarChart3 className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-black tracking-wider text-primary">STATISTICAL EDGE</div>
                <p className="text-[10px] text-foreground/70 leading-snug">
                  Luka is averaging 34.1 PPG over his last 10 games, comfortably above the 32.5 line. Per-36 projection of 35.8 reinforces the over.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Swords className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-black tracking-wider text-primary">MATCHUP & PACE</div>
                <p className="text-[10px] text-foreground/70 leading-snug">
                  Denver allows the 6th-most points to opposing guards. Projected pace of 101.4 favors volume scoring.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <TrendingUp className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-black tracking-wider text-primary">VERDICT & RISK</div>
                <p className="text-[10px] text-foreground/70 leading-snug">
                  Strong lean OVER 32.5. Wager 1.5 units with 64% model confidence. Key risk: early blowout limiting minutes.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-primary/[0.08] border border-primary/25 p-2.5">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              <span className="text-[11px] font-black text-primary tracking-wide">TAKE THIS PICK</span>
            </div>
            <div className="text-[8px] text-foreground/40 tracking-wider mt-0.5 mb-1">
              OVERALL VERDICT — ALL FACTORS COMBINED
            </div>
            <p className="text-[10px] text-foreground/80 leading-snug">
              Strong play. Luka OVER 32.5 Points checks the boxes. L10 avg 34.1, +EV 7.2%. Recommended sizing: 1.5–2 units.
            </p>
            <div className="mt-2 pt-2 border-t border-primary/15 flex items-center justify-between">
              <span className="text-[8px] font-bold tracking-wider text-primary">AI CONFIDENCE: 64%</span>
              <span className="text-[8px] tracking-wider text-foreground/40">POWERED BY SENTINEL AI</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Feature pills — living micro-previews (accordion: one open at a time) */}
      <FeatureAccordion />

      {/* Spacer so content doesn't hide behind the sticky CTA bar */}
      <div className="h-28" />
    </SectionContainer>
  );
});

/* ───────────────────────────────────────────────
   Screen 2 — Value Prop
   ─────────────────────────────────────────────── */
const ScreenValue = memo(function ScreenValue({ onNext }: { onNext: () => void }) {
  const [activeTab, setActiveTab] = useState<"Dashboard" | "Picks" | "Tracker" | "Parlay">("Dashboard");
  const lightweight = useLightweightMotion();
  const tabT = { duration: lightweight ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] as const };
  return (
    <SectionContainer>
      <ProgressDots current={2} total={5} />

      <motion.div initial={lightweight ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : pageT}>
        <h1 className="text-[32px] leading-[1.05] font-extrabold tracking-tight">
          See What You're<br />Missing.
        </h1>
        <p className="mt-2 text-sm text-foreground/60">Pros don't guess. They use data.</p>
      </motion.div>

      <motion.div
        initial={lightweight ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : pageT}
        className="mt-5 rounded-2xl border border-border bg-card p-3.5"
      >
        {/* App header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <BrandMark size={20} className="relative" />
            <span className="text-[10px] font-bold tracking-widest text-foreground">SENTINEL</span>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-3 overflow-hidden">
          {(["Dashboard", "Picks", "Tracker", "Parlay"] as const).map((t) => {
            const active = activeTab === t;
            return (
              <motion.button
                key={t}
                onClick={() => setActiveTab(t)}
                whileTap={lightweight ? undefined : { scale: 0.96 }}
                aria-pressed={active}
                className={`px-2 py-1 rounded-full text-[9px] font-bold whitespace-nowrap transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </motion.button>
            );
          })}
        </div>

        {/* Tab body */}
        <div className="min-h-[260px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={tabT}
            >
              {activeTab === "Dashboard" && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black tracking-wider text-foreground/60">TODAY'S TOP PICKS</span>
                    <span className="text-[9px] font-semibold text-primary">View All</span>
                  </div>
                  <div className="space-y-1.5">
                    {SCREEN2_PICKS.map((p) => (
                      <div key={p.name} className="flex items-center gap-2 rounded-lg bg-background border border-border px-2 py-1.5">
                        <img src={p.img} alt={p.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0 bg-card" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-foreground truncate">{p.name}</div>
                          <div className="text-[9px] text-foreground/50">{p.pick}</div>
                        </div>
                        <span className="text-primary text-xs font-extrabold tabular-nums">{p.conf}%</span>
                        <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[8px] font-black tracking-wider">+EV {p.ev}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-lg bg-background border border-border p-2.5 flex items-center justify-between">
                    <div>
                      <div className="text-[9px] tracking-wider text-foreground/50">YTD PERFORMANCE</div>
                      <div className="text-lg font-extrabold text-primary tabular-nums">+18.47%</div>
                    </div>
                    <Sparkline className="w-16 h-10" />
                  </div>
                  <div className="mt-2 relative rounded-lg overflow-hidden border border-border">
                    <div className="absolute inset-0 backdrop-blur-sm bg-background/80" />
                    <div className="relative px-3 py-3 flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-foreground/60" />
                      <div className="flex-1">
                        <div className="text-[10px] font-bold text-foreground">Advanced Projections & Line Movement</div>
                        <div className="text-[9px] text-foreground/50">Upgrade to Unlock</div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "Picks" && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black tracking-wider text-foreground/60">FREE PICKS · TODAY</span>
                      <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[8px] font-black tracking-wider">FREE</span>
                    </div>
                    <span className="text-[9px] font-semibold text-primary">View All</span>
                  </div>
                  <div className="space-y-1.5">
                    {SCREEN2_PICKS.map((p) => (
                      <div key={p.name} className="flex items-center gap-2 rounded-lg bg-background border border-border px-2 py-1.5">
                        <img src={p.img} alt={p.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0 bg-card" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-foreground truncate">{p.name}</div>
                          <div className="text-[9px] text-foreground/50">{p.pick}</div>
                        </div>
                        <span className="text-primary text-xs font-extrabold tabular-nums">{p.conf}%</span>
                        <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[8px] font-black tracking-wider">HIGH CONF</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-lg bg-background border border-border p-2.5 flex items-center justify-between">
                    <div>
                      <div className="text-[9px] tracking-wider text-foreground/50">REFRESHES DAILY · 8AM ET</div>
                      <div className="text-[11px] font-bold text-foreground mt-0.5">3 free plays available</div>
                    </div>
                    <span className="px-2 py-1 rounded bg-primary/15 text-primary text-[9px] font-black tracking-wider">LIVE</span>
                  </div>
                </>
              )}

              {activeTab === "Tracker" && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black tracking-wider text-foreground/60">PROFIT TRACKER · 30D</span>
                    <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[9px] font-black tabular-nums">+18.0%</span>
                  </div>
                  <div className="rounded-lg bg-background border border-border p-3">
                    <div className="flex items-end justify-between mb-2">
                      <div>
                        <div className="text-[9px] tracking-wider text-foreground/50">BANKROLL</div>
                        <div className="text-2xl font-extrabold text-primary tabular-nums leading-none">+$1,284</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] tracking-wider text-foreground/50">UNITS</div>
                        <div className="text-sm font-bold text-foreground tabular-nums">+12.84u</div>
                      </div>
                    </div>
                    <Sparkline className="w-full h-12" />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {[
                      { label: "RECORD", value: "42-18" },
                      { label: "WIN RATE", value: "70%" },
                      { label: "STREAK", value: "W6" },
                    ].map((s) => (
                      <div key={s.label} className="rounded-lg bg-background border border-border p-2 text-center">
                        <div className="text-[8px] tracking-wider text-foreground/50">{s.label}</div>
                        <div className="text-sm font-extrabold text-foreground tabular-nums mt-0.5">{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 rounded-lg bg-background border border-border px-2.5 py-2 flex items-center justify-between">
                    <span className="text-[9px] tracking-wider text-foreground/50">BEST SPORT</span>
                    <span className="text-[10px] font-bold text-foreground">NBA · 73% Win</span>
                  </div>
                </>
              )}

              {activeTab === "Parlay" && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black tracking-wider text-foreground/60">SLIP BUILDER · 3 LEGS</span>
                    <span className="text-[9px] font-semibold text-primary">Edit</span>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { img: ESPN_HEADSHOTS.jaysonTatum, name: "J. Tatum", pick: "OVER 28.5 PTS", conf: 64 },
                      { img: ESPN_HEADSHOTS.lukaDoncic, name: "L. Doncic", pick: "OVER 8.5 AST", conf: 61 },
                      { img: ESPN_HEADSHOTS.austinMatthews, name: "A. Matthews", pick: "OVER 3.5 SOG", conf: 59 },
                    ].map((p) => (
                      <div key={p.name} className="flex items-center gap-2 rounded-lg bg-background border border-border px-2 py-1.5">
                        <img src={p.img} alt={p.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0 bg-card" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-foreground truncate">{p.name}</div>
                          <div className="text-[9px] text-foreground/50">{p.pick}</div>
                        </div>
                        <span className="text-primary text-xs font-extrabold tabular-nums">{p.conf}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 rounded-lg bg-background border border-border p-2.5 flex items-center justify-between">
                    <div>
                      <div className="text-[9px] tracking-wider text-foreground/50">3-LEG PARLAY</div>
                      <div className="text-lg font-extrabold text-primary tabular-nums leading-none">+650</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] tracking-wider text-foreground/50">GRADE</div>
                      <div className="text-base font-extrabold text-primary leading-none mt-0.5">A−</div>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Social proof */}
      <motion.div
        initial={lightweight ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : { ...pageT, delay: 0.05 }}
        className="mt-4 rounded-2xl border border-border bg-card p-3 flex items-center gap-3"
      >
        <div className="flex -space-x-2">
          {[11, 12, 13].map((i) => (
            <img
              key={i}
              src={`https://i.pravatar.cc/80?img=${i}`}
              alt="user"
              className="w-8 h-8 rounded-full border-2 border-card object-cover bg-card"
            />
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-foreground">10,000+ users joined this week</div>
          <div className="text-[11px] font-bold text-primary">20% Average ROI Increase</div>
        </div>
      </motion.div>

      <div className="mt-6">
        <GreenCTA onClick={onNext}>Continue</GreenCTA>
      </div>
    </SectionContainer>
  );
});

/* ───────────────────────────────────────────────
   Screen 3 — Personalize
   ─────────────────────────────────────────────── */
const ScreenPersonalize = memo(function ScreenPersonalize({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const lightweight = useLightweightMotion();
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

      <motion.div initial={lightweight ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : pageT}>
        <h1 className="text-[32px] leading-[1.05] font-extrabold tracking-tight">Make It Yours.</h1>
        <p className="mt-2 text-sm text-foreground/60">We'll personalize your experience.</p>
      </motion.div>

      {/* Odds format */}
      <div className="mt-6">
        <p className="text-[10px] font-black tracking-wider text-foreground/60 mb-1">ODDS FORMAT</p>
        <p className="text-xs text-foreground/50 mb-3">We'll show odds the way you like them.</p>
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
                whileTap={lightweight ? undefined : { scale: 0.97 }}
                className={`rounded-xl border px-3 py-3 text-left transition-all ${
                  active
                    ? "border-primary bg-primary/5 shadow-[0_0_18px_hsl(var(--primary)_/_0.15)]"
                    : "border-border bg-card"
                }`}
              >
                <div className={`text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>{o.label}</div>
                <div className={`text-xs font-mono mt-0.5 ${active ? "text-primary/80" : "text-foreground/50"}`}>{o.sample}</div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Sports */}
      <div className="mt-6">
        <p className="text-[10px] font-black tracking-wider text-foreground/60 mb-1">SPORTS YOU BET ON</p>
        <p className="text-xs text-foreground/50 mb-3">Select all that apply.</p>
        <div className="grid grid-cols-2 gap-3">
          {SPORTS.map((s) => {
            const active = sports.includes(s.id);
            return (
              <motion.button
                key={s.id}
                onClick={() => toggleSport(s.id)}
                whileTap={lightweight ? undefined : { scale: 0.97 }}
                className={`relative rounded-xl border p-3 transition-all ${
                  active
                    ? "border-primary bg-primary/5 shadow-[0_0_18px_hsl(var(--primary)_/_0.15)]"
                    : "border-border bg-card"
                }`}
              >
                {active && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
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
                <div className={`text-center text-sm font-bold ${active ? "text-primary" : "text-foreground"}`}>{s.label}</div>
              </motion.button>
            );
          })}
        </div>

        {/* Other tile — full width */}
        <motion.button
          type="button"
          onClick={toggleOther}
          whileTap={lightweight ? undefined : { scale: 0.98 }}
          className={`mt-3 relative w-full rounded-xl border p-3 flex items-center gap-3 transition-all ${
            otherActive
              ? "border-primary bg-primary/5 shadow-[0_0_18px_hsl(var(--primary)_/_0.15)]"
              : "border-border bg-card"
          }`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-black shrink-0 ${otherActive ? "bg-primary/15 text-primary" : "bg-foreground/5 text-muted-foreground"}`}>
            +
          </div>
          <div className="flex-1 text-left">
            <div className={`text-sm font-bold ${otherActive ? "text-primary" : "text-foreground"}`}>Other</div>
            <div className="text-[11px] text-foreground/50">Esports, Soccer, Tennis, and more</div>
          </div>
          {otherActive && (
            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
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
              className="w-full rounded-xl border border-border bg-card px-3 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </motion.div>
        )}
      </div>

      <div className="mt-5 flex items-start gap-2 text-[11px] text-foreground/50">
        <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
        <span>We'll personalize picks &amp; insights based on your preferences.</span>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={onBack} className="px-5 py-3 text-sm font-semibold text-foreground/70">
          <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
        </button>
        <div className="flex-1">
          <GreenCTA onClick={handleNext} disabled={!canContinue}>Next</GreenCTA>
        </div>
      </div>
    </SectionContainer>
  );
});

/* ───────────────────────────────────────────────
   Screen 4 — Without vs With
   ─────────────────────────────────────────────── */
const ScreenComparison = memo(function ScreenComparison({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const lightweight = useLightweightMotion();
  return (
    <SectionContainer>
      <ProgressDots current={4} total={6} />

      <motion.div initial={lightweight ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : pageT}>
        <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-tight">
          Don't Bet Blind.<br />
          <span className="text-primary">See The Difference.</span>
        </h1>
        <p className="mt-2 text-sm text-foreground/60">Data beats luck. Every time.</p>
      </motion.div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {/* WITHOUT */}
        <motion.div
          initial={lightweight ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : { ...pageT, delay: 0.1 }}
          className="rounded-2xl border border-danger/30 bg-card p-2.5"
          style={{ boxShadow: "inset 0 0 30px rgba(255,59,59,0.06)" }}
        >
          <div className="text-[9px] font-black tracking-wider text-foreground/60 mb-2">WITHOUT SENTINEL</div>
          <div className="text-2xl font-extrabold text-danger tabular-nums leading-none">-12.34%</div>
          <div className="text-[10px] text-foreground/50 mt-1">ROI After 30 Days</div>
          <div className="mt-2 flex justify-center"><Sparkline color="hsl(var(--danger))" down className="h-12 w-full max-w-[120px]" /></div>
          <div className="mt-3 space-y-1.5">
            {["Guessing & Hope", "Emotional Bets", "Chasing Losses", "No Real Strategy"].map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <X className="w-3 h-3 text-danger flex-shrink-0" strokeWidth={3} />
                <span className="text-[10px] text-foreground/70">{t}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* WITH */}
        <motion.div
          initial={lightweight ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : { ...pageT, delay: 0.18 }}
          className="rounded-2xl border border-primary/40 bg-card p-2.5"
          style={{ boxShadow: "inset 0 0 30px hsl(var(--primary) / 0.08), 0 0 24px hsl(var(--primary) / 0.12)" }}
        >
          <div className="text-[9px] font-black tracking-wider text-primary mb-2">WITH SENTINEL</div>
          <div className="text-2xl font-extrabold text-primary tabular-nums leading-none">+18.47%</div>
          <div className="text-[10px] text-foreground/50 mt-1">ROI After 30 Days</div>
          <div className="mt-2 flex justify-center"><Sparkline color="hsl(var(--primary))" className="h-12 w-full max-w-[120px]" /></div>
          <div className="mt-3 space-y-1.5">
            {["AI-Powered Picks", "High Confidence & +EV", "Track & Improve", "Smarter Parlays"].map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-primary flex-shrink-0" strokeWidth={3} />
                <span className="text-[10px] text-foreground/70">{t}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Testimonial */}
      <motion.div
        initial={lightweight ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={lightweight ? { duration: 0 } : { ...pageT, delay: 0.26 }}
        className="mt-5 rounded-2xl border border-border bg-card p-4 flex items-start gap-3"
      >
        <img
          src="https://i.pravatar.cc/100?img=11"
          alt="Mike R."
          className="w-12 h-12 rounded-full flex-shrink-0 border border-border object-cover bg-card"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground/80 italic leading-snug">
            "I was skeptical at first. Now I'm up 23% this season. Sentinel changed the way I bet."
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">- Mike R.</span>
            <span className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground text-[8px] font-black tracking-wider flex items-center gap-0.5">
              <ShieldCheck className="w-2.5 h-2.5" strokeWidth={3} /> VERIFIED
            </span>
          </div>
        </div>
      </motion.div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={onBack} className="px-5 py-3 text-sm font-semibold text-foreground/70">
          <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
        </button>
        <div className="flex-1">
          <GreenCTA onClick={onNext}>Continue</GreenCTA>
        </div>
      </div>
    </SectionContainer>
  );
});

/* ───────────────────────────────────────────────
   Top-level Onboarding orchestrator
   ─────────────────────────────────────────────── */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const stepTapLocked = useRef(false);
  const stepTapUnlockTimer = useRef<number>();
  const reduce = useReducedMotion();
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );
  const lightweight = !!reduce || isMobile;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => () => {
    if (stepTapUnlockTimer.current !== undefined) {
      window.clearTimeout(stepTapUnlockTimer.current);
    }
  }, []);

  // Default referral if missing (used downstream)
  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE.referral)) {
        localStorage.setItem(STORAGE.referral, "Direct");
      }
    } catch {}
  }, []);

  useEffect(() => {
    const preloadStepImages = () => {
      ONBOARDING_IMAGE_URLS.forEach((url) => {
        const image = new Image();
        image.decoding = "async";
        image.src = url;
        void image.decode().catch(() => undefined);
      });
    };

    if (!lightweight) {
      preloadStepImages();
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(preloadStepImages, { timeout: 1000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timerId = window.setTimeout(preloadStepImages, 250);
    return () => window.clearTimeout(timerId);
  }, [lightweight]);

  const changeStep = useCallback((nextDirection: 1 | -1) => {
    if (stepTapLocked.current) return;

    stepTapLocked.current = true;
    setDirection(nextDirection);
    setStep((s) => nextDirection === 1 ? Math.min(3, s + 1) : Math.max(0, s - 1));
    stepTapUnlockTimer.current = window.setTimeout(() => {
      stepTapLocked.current = false;
    }, 220);
  }, []);
  const goNext = useCallback(() => changeStep(1), [changeStep]);
  const goBack = useCallback(() => changeStep(-1), [changeStep]);
  const goPaywall = useCallback(() => navigate("/paywall"), [navigate]);

  const current = useMemo(() =>
    step === 0 ? <ScreenHero        key="s1" /> :
    step === 1 ? <ScreenValue       key="s2" onNext={goNext} /> :
    step === 2 ? <ScreenPersonalize key="s3" onBack={goBack} onNext={goNext} /> :
                 <ScreenComparison  key="s4" onBack={goBack} onNext={goPaywall} />,
  [step, goNext, goBack, goPaywall]);

  return (
    <LightweightMotionContext.Provider value={lightweight}>
      <div className="relative min-h-screen-safe bg-background">
        {lightweight ? (
          <div className="w-full">{current}</div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={reduce ? undefined : stepVariants}
              initial={reduce ? false : "enter"}
              animate={reduce ? undefined : "center"}
              exit={reduce ? undefined : "exit"}
              transition={reduce ? { duration: 0 } : stepT}
              className="w-full"
              style={reduce ? undefined : { willChange: "opacity, transform" }}
            >
              {current}
            </motion.div>
          </AnimatePresence>
        )}
        {step === 0 && (
          /* Keep the viewport-fixed CTA outside the transformed step animation wrapper. */
          <div
            className="fixed inset-x-0 bottom-0 z-50"
            style={{
              background: lightweight ? "hsl(var(--background))" : "hsl(var(--background) / 0.92)",
              backdropFilter: lightweight ? undefined : "blur(20px)",
              WebkitBackdropFilter: lightweight ? undefined : "blur(20px)",
              borderTop: "1px solid hsl(var(--foreground) / 0.06)",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
            }}
          >
            <div className="mx-auto max-w-md px-5 pt-3">
              <GreenCTA onClick={goNext}>Get Started</GreenCTA>
              <p className="text-center text-[11px] text-foreground/50 mt-2.5">
                Already have an account?{" "}
                <button onClick={() => navigate("/auth")} className="text-primary underline font-semibold">Sign in</button>
              </p>
            </div>
          </div>
        )}
      </div>
    </LightweightMotionContext.Provider>
  );
}

/* ───────────────────────────────────────────────
   Feature micro-preview subcomponents
   ─────────────────────────────────────────────── */
const microEase = [0.32, 0.72, 0, 1] as const;

function FeatureAccordion() {
  const lightweight = useLightweightMotion();
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));
  return (
    <motion.div
      initial={lightweight ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={lightweight ? { duration: 0 } : { duration: 0.4, delay: 0.18 }}
      className="mt-4 space-y-2"
    >
      <FeatureCard id="live" title="Live Games" icon={Calendar}
        isExpanded={expanded === "live"} onToggle={() => toggle("live")}>
        <LiveGameMini active={expanded === "live"} />
      </FeatureCard>
      <FeatureCard id="ai" title="AI Picks" icon={Brain}
        isExpanded={expanded === "ai"} onToggle={() => toggle("ai")}>
        <AIPickMini />
      </FeatureCard>
      <FeatureCard id="profit" title="Profit Tracker" icon={BarChart3}
        isExpanded={expanded === "profit"} onToggle={() => toggle("profit")}>
        <ProfitTrackerMini />
      </FeatureCard>
    </motion.div>
  );
}

function FeatureCard({
  id,
  title,
  icon: Icon,
  isExpanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const reduce = useLightweightMotion();
  return (
    <div
      className={`rounded-xl border bg-card transition-colors ${
        isExpanded ? "border-primary/40" : "border-border"
      }`}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={`feature-${id}`}
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left focus:outline-none"
      >
        <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--nba-green))" }} />
        <div className="text-sm font-semibold text-foreground flex-1">{title}</div>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: reduce ? 0 : 0.2, ease: microEase }}
          className="flex-shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-foreground/50" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="content"
            id={`feature-${id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: microEase }}
            className="overflow-hidden"
          >
            <div className="mx-1 mb-1 mt-0 rounded-lg border border-border bg-secondary p-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LiveGameMini({ active }: { active?: boolean }) {
  const reduce = useLightweightMotion();
  const [seconds, setSeconds] = useState(134);
  useEffect(() => {
    if (reduce || !active) return;
    const id = setInterval(() => setSeconds((s) => (s <= 1 ? 134 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [reduce, active]);
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toString().padStart(2, "0");

  return (
    <div className="w-full flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-nba-red"
            animate={reduce ? undefined : { opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="text-[10px] font-black uppercase tracking-wider text-nba-red">LIVE</span>
          <span className="text-[10px] text-muted-foreground/60 tabular-nums ml-1">Q4 · {m}:{s}</span>
        </div>
        <span className="text-[9px] text-muted-foreground/55">NBA · MLB · NHL</span>
      </div>
      <div className="bg-foreground/[0.03] rounded-lg px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="w-2 h-2 rounded-full bg-[#FDB927] flex-shrink-0" />
          <span className="text-xs font-bold text-foreground/90">LAL</span>
          <span className="text-base font-extrabold tabular-nums text-foreground/90 ml-auto">108</span>
        </div>
        <span className="text-[9px] text-muted-foreground/40 px-1">vs</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-base font-extrabold tabular-nums text-nba-green">112</span>
          <span className="text-xs font-bold text-foreground ml-auto">BOS</span>
          <span className="w-2 h-2 rounded-full bg-[#007A33] flex-shrink-0" />
        </div>
      </div>
    </div>
  );
}

function AIPickMini() {
  const reduce = useLightweightMotion();
  const picks = [
    { name: "J. Tatum", matchup: "BOS vs MIA", line: "Over 24.5 Pts", conf: 78, ev: "+7.2%" },
    { name: "L. Doncic", matchup: "DAL vs PHX", line: "Over 8.5 Ast", conf: 72, ev: "+5.8%" },
    { name: "S. Curry", matchup: "GSW vs LAL", line: "Over 4.5 3PM", conf: 68, ev: "+4.1%" },
  ];
  return (
    <div className="w-full flex flex-col gap-1.5">
      {picks.map((p, i) => (
        <PickRow key={p.name} pick={p} delay={reduce ? 0 : 0.05 * i} />
      ))}
      <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-border/15">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Today's Edge</span>
        <span className="text-[9px] font-bold text-nba-green">3 of 12 picks</span>
      </div>
    </div>
  );
}

function PickRow({ pick, delay }: { pick: { name: string; matchup: string; line: string; conf: number; ev: string }; delay: number }) {
  const reduce = useLightweightMotion();
  const radius = 9;
  const c = 2 * Math.PI * radius;
  const offset = c - (pick.conf / 100) * c;
  return (
    <motion.div
      initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay, ease: microEase }}
      className="flex items-center gap-2.5 bg-foreground/[0.03] rounded-md px-2.5 py-1.5"
    >
      <div className="relative w-7 h-7 flex-shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 22 22">
          <circle cx="11" cy="11" r={radius} fill="none" stroke="hsl(var(--muted) / 0.3)" strokeWidth="2.5" />
          <motion.circle
            cx="11" cy="11" r={radius}
            fill="none"
            stroke="hsl(var(--nba-green))"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: reduce ? offset : c }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.6, delay, ease: microEase }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[9px] font-black tabular-nums text-nba-green">{pick.conf}</span>
        </div>
      </div>
      <div className="flex flex-col leading-tight min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-foreground truncate">{pick.name}</span>
          <span className="text-[9px] font-extrabold tabular-nums text-nba-green flex-shrink-0">{pick.ev}</span>
        </div>
        <span className="text-[9px] text-muted-foreground/60 truncate">{pick.matchup} · {pick.line}</span>
      </div>
    </motion.div>
  );
}

function ProfitTrackerMini() {
  const reduce = useLightweightMotion();
  // Polyline across 240x60 viewBox — left-to-right uptrend with realistic dips
  const points = "0,48 20,44 40,46 60,38 80,40 100,32 120,30 140,22 160,26 180,16 200,18 220,10 240,6";
  const lastX = 240;
  const lastY = 6;

  return (
    <div className="w-full flex flex-col gap-2.5">
      {/* Top row: bankroll + ROI badge */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col leading-none">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">Bankroll · 30D</span>
          <span className="text-xl font-extrabold tabular-nums text-nba-green">+$1,284</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">ROI</span>
          <span
            className="text-[11px] font-extrabold tabular-nums text-nba-green px-1.5 py-0.5 rounded"
            style={{ backgroundColor: "hsl(var(--nba-green) / 0.15)" }}
          >
            +18.0%
          </span>
        </div>
      </div>

      {/* Sparkline with gradient fill */}
      <svg viewBox="0 0 240 60" preserveAspectRatio="none" className="w-full h-14 overflow-visible">
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--nba-green))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(var(--nba-green))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.polygon
          points={`0,60 ${points} 240,60`}
          fill="url(#sparkFill)"
          initial={{ opacity: reduce ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: reduce ? 0 : 0.3, ease: microEase }}
        />
        <motion.polyline
          points={points}
          fill="none"
          stroke="hsl(var(--nba-green))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: microEase }}
        />
        <motion.circle
          cx={lastX} cy={lastY} r="3"
          fill="hsl(var(--nba-green))"
          initial={{ opacity: reduce ? 1 : 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.9, duration: 0.2 }}
          style={{ filter: "drop-shadow(0 0 4px hsl(var(--nba-green)))" }}
        />
      </svg>

      {/* Bottom stats grid */}
      <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-border/15">
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/55">Record</span>
          <span className="text-[11px] font-bold text-foreground tabular-nums">42-18</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/55">Win Rate</span>
          <span className="text-[11px] font-bold text-foreground tabular-nums">70%</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/55">Streak</span>
          <span className="text-[11px] font-bold text-nba-green tabular-nums">W6</span>
        </div>
      </div>
    </div>
  );
}
