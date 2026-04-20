import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Star, Shield, Zap, BarChart3, TrendingUp, Crown, ChevronDown, Lock } from "lucide-react";

type PlanInterval = "weekly" | "monthly" | "yearly";

interface Plan {
  id: PlanInterval;
  label: string;
  price: string;
  subtext: string;
  badge?: string;
  saving?: string;
  extraLine?: string;
}

const PLANS: Plan[] = [
  { id: "weekly",  label: "Weekly",  price: "$9.99",   subtext: "Good for trying it out" },
  { id: "monthly", label: "Monthly", price: "$39.99",  subtext: "$1.33/day", badge: "MOST POPULAR", saving: "Save 60% vs Weekly" },
  { id: "yearly",  label: "Yearly",  price: "$219.99", subtext: "$18.25/month", badge: "Best Long-Term Value", saving: "Save $260 vs weekly", extraLine: "2 months free" },
];

interface Feature {
  icon: typeof BarChart3;
  label: string;
  bullets: string;
  description: string;
  preview: ReactNode;
}

const FEATURES: Feature[] = [
  {
    icon: BarChart3,
    label: "Real-Time Prop Analysis",
    bullets: "Live odds tracking · Top EV plays · Instant updates",
    description: "Instant AI breakdowns for any player prop — hit rates, trends, and a clear verdict.",
    preview: (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="px-2 py-1 rounded-md bg-[#00FF6A]/20 text-[#00FF6A] text-[10px] font-black">72% STRONG PICK</div>
          <span className="text-[10px] text-white/50">Over 24.5 Pts</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {[{ l: "Season", v: "68%" }, { l: "L10", v: "80%" }, { l: "L5", v: "100%" }, { l: "H2H", v: "75%" }].map(s => (
            <div key={s.l} className="text-center rounded bg-white/5 py-1 px-0.5">
              <div className="text-[9px] text-white/50">{s.l}</div>
              <div className="text-[11px] font-bold text-white">{s.v}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: TrendingUp,
    label: "EV & Edge Calculations",
    bullets: "Model vs market · Edge % · Expected value",
    description: "Know exactly when the books are wrong — see your edge and expected value on every prop.",
    preview: (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px]"><span className="text-white/50">Model</span><span className="font-bold text-[#00FF6A]">72%</span></div>
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#00FF6A]" style={{ width: "72%" }} /></div>
        <div className="flex items-center justify-between text-[10px]"><span className="text-white/50">Books Implied</span><span className="font-bold text-[#FF3B3B]">52%</span></div>
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-[#FF3B3B]" style={{ width: "52%" }} /></div>
        <div className="text-center pt-1"><span className="text-[11px] font-black text-[#00FF6A]">+20% Edge · +14.2% EV</span></div>
      </div>
    ),
  },
  {
    icon: Zap,
    label: "Arbitrage Scanner",
    bullets: "Risk-free spots · Cross-book scan · Instant alerts",
    description: "Find guaranteed profit opportunities across sportsbooks — zero risk.",
    preview: (
      <div className="rounded-lg border border-[#2A2A2A] bg-white/5 p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[10px]"><span className="font-bold text-white">DraftKings</span> <span className="text-[#00FF6A]">+150</span></div>
          <div className="text-[10px]"><span className="font-bold text-white">FanDuel</span> <span className="text-[#00FF6A]">-140</span></div>
        </div>
        <div className="text-center"><span className="px-2 py-0.5 rounded bg-[#00FF6A]/20 text-[#00FF6A] text-[10px] font-black">+3.2% GUARANTEED</span></div>
      </div>
    ),
  },
  {
    icon: Shield,
    label: "AI-Powered Picks",
    bullets: "Daily curated · Confidence ranked · Multi-sport",
    description: "Daily curated picks ranked by confidence, powered by our AI model.",
    preview: (
      <div className="space-y-1.5">
        {[{ p: "Jokić O24.5 Pts", c: 89 }, { p: "Tatum O7.5 Reb", c: 76 }].map(pick => (
          <div key={pick.p} className="flex items-center justify-between rounded-lg bg-white/5 border border-[#2A2A2A] px-2 py-1.5">
            <span className="text-[10px] font-semibold text-white">{pick.p}</span>
            <span className={`text-[10px] font-black ${pick.c >= 80 ? "text-[#00FF6A]" : "text-yellow-400"}`}>{pick.c}%</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Star,
    label: "Line Shopping Across Major Books",
    bullets: "Compare books · Best odds · Save on every play",
    description: "Compare odds across major sportsbooks instantly. Always get the best number.",
    preview: (
      <div className="space-y-1">
        {[{ b: "DraftKings", o: "-110", best: true }, { b: "FanDuel", o: "-115" }, { b: "BetMGM", o: "-120" }].map(r => (
          <div key={r.b} className="flex items-center justify-between rounded bg-white/5 px-2 py-1">
            <span className="text-[10px] text-white font-medium">{r.b}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-white">{r.o}</span>
              {r.best && <span className="text-[8px] font-black text-[#00FF6A] bg-[#00FF6A]/20 px-1 rounded">BEST</span>}
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Crown,
    label: "Profit Tracker & Analytics",
    bullets: "P&L calendar · ROI tracking · Shareable cards",
    description: "Track every play, see your P&L calendar, and share your results.",
    preview: (
      <div className="flex gap-1 justify-between">
        {[{ l: "Win Rate", v: "67%" }, { l: "Profit", v: "+$482" }, { l: "ROI", v: "+12.3%" }].map(s => (
          <div key={s.l} className="flex-1 text-center rounded-md bg-white/5 py-1 px-1">
            <div className="text-[8px] text-white/50">{s.l}</div>
            <div className="text-[10px] font-bold text-[#00FF6A]">{s.v}</div>
          </div>
        ))}
      </div>
    ),
  },
];

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-white/60 tabular-nums">{current} / {total}</span>
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

export default function PaywallPage() {
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState<PlanInterval>("monthly");
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  const handleSubscribe = () => {
    localStorage.setItem("sentinel_subscription", "trial");
    localStorage.setItem("sentinel_selected_plan", selectedPlan);
    navigate("/welcome", { replace: true });
  };

  const ctaLabel =
    selectedPlan === "monthly"
      ? "Start Monthly Trial"
      : selectedPlan === "yearly"
      ? "Start Yearly Trial"
      : "Start Free Trial";

  const monthlyValueStack = [
    "Full AI prop access",
    "Daily top-rated plays",
    "Real-time updates",
  ];

  return (
    <div className="relative min-h-screen w-full bg-[#0A0A0A] text-white overflow-x-hidden pt-safe pb-safe">
      <style>{`
        @keyframes pulse-cta { 0%,100% { box-shadow: 0 0 0 0 rgba(0,255,106,0.22) } 50% { box-shadow: 0 0 18px 4px rgba(0,255,106,0.28) } }
        @keyframes card-pulse {
          0%,100% { box-shadow: 0 0 0 2px #00FF6A, 0 0 30px rgba(0,255,106,0.26), 0 0 60px rgba(0,255,106,0.11), inset 0 0 24px rgba(0,255,106,0.04); }
          50% { box-shadow: 0 0 0 2px #00FF6A, 0 0 42px rgba(0,255,106,0.38), 0 0 84px rgba(0,255,106,0.16), inset 0 0 24px rgba(0,255,106,0.05); }
        }
      `}</style>
      {/* Atmospheric glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[520px] h-[420px] rounded-full bg-[#7B2FFF]/30 blur-[120px]" />
        <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full bg-[#641EDC]/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[360px] h-[320px] rounded-full bg-[#00FF6A]/[0.05] blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-5 py-6 pb-36">
        <ProgressDots current={5} total={6} />

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-tight">Start Winning With Data</h1>
          <p className="mt-2 text-sm text-white/60">AI-powered props. Real edge. Proven results.</p>
        </motion.div>

        {/* Trial pill */}
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="mt-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#00FF6A]/12 border border-[#00FF6A]/30 px-3 py-1 text-[11px] font-bold text-[#00FF6A]">
            <Check className="w-3 h-3" strokeWidth={3} />
            7-Day Free Trial • No charge today
          </span>
        </motion.div>

        {/* Social proof — moved up */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <div className="flex -space-x-1.5">
            {[11, 12, 13].map((i) => (
              <img
                key={i}
                src={`https://i.pravatar.cc/32?img=${i}`}
                alt=""
                className="w-6 h-6 rounded-full border border-[#0A0A0A] object-cover"
              />
            ))}
          </div>
          <span className="text-[12px] text-white/70 font-semibold">
            <span className="text-white font-extrabold">10,000+</span> bettors using our AI daily
          </span>
        </div>

        {/* Pricing — Monthly hero + Weekly/Yearly side-by-side */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-5"
        >
          {(() => {
            const monthly = PLANS.find((p) => p.id === "monthly")!;
            const isSelected = selectedPlan === "monthly";
            return (
              <motion.button
                onClick={() => setSelectedPlan("monthly")}
                whileTap={{ scale: 0.98 }}
                className="relative w-full rounded-[20px] border-2 border-[#00FF6A] bg-[#141414] pl-11 pr-5 py-6 mb-3 text-left overflow-hidden block"
                style={{
                  boxShadow: isSelected
                    ? "0 0 0 2px #00FF6A, 0 0 30px rgba(0,255,106,0.26), 0 0 60px rgba(0,255,106,0.11), inset 0 0 24px rgba(0,255,106,0.04)"
                    : "0 0 0 1px rgba(0,255,106,0.4), 0 0 16px rgba(0,255,106,0.12)",
                  animation: isSelected ? "card-pulse 3s ease-in-out infinite" : undefined,
                }}
              >
                <div className="absolute -top-px left-1/2 -translate-x-1/2 bg-[#FFC93C] text-black text-[8px] font-black px-2.5 py-0.5 rounded-b-lg tracking-widest uppercase">
                  MOST POPULAR
                </div>

                <div className="absolute top-4 left-3.5">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-[#00FF6A]" : "border-white/30"}`}>
                    {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-[#00FF6A]" />}
                  </div>
                </div>

                <div className="flex items-start justify-between mt-2 gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-extrabold text-white">{monthly.label}</div>
                    <div className="text-[11px] text-white/50 mt-0.5">{monthly.subtext}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-baseline justify-end gap-1">
                      <span className="text-[34px] font-black text-[#00FF6A] tabular-nums leading-none">{monthly.price}</span>
                      <span className="text-[11px] font-bold text-white/50">/month</span>
                    </div>
                    {monthly.saving && (
                      <div className="flex items-center gap-0.5 mt-1 justify-end">
                        <Check className="w-3 h-3 text-[#00FF6A]" strokeWidth={3} />
                        <span className="text-[10px] font-semibold text-[#00FF6A]">{monthly.saving}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Value stack */}
                <ul className="mt-4 space-y-1.5">
                  {monthlyValueStack.map((v) => (
                    <li key={v} className="flex items-center gap-2 text-[12px] text-white/85">
                      <Check className="w-3.5 h-3.5 text-[#00FF6A] flex-shrink-0" strokeWidth={3} />
                      <span className="font-medium">{v}</span>
                    </li>
                  ))}
                </ul>
              </motion.button>
            );
          })()}

          <div className="grid grid-cols-2 gap-2.5">
            {PLANS.filter((p) => p.id !== "monthly").map((plan) => {
              const isSelected = selectedPlan === plan.id;
              const isWeekly = plan.id === "weekly";
              return (
                <motion.button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  whileTap={{ scale: 0.97 }}
                  className={`relative rounded-2xl border-2 px-4 py-4 pl-9 text-left transition-all overflow-hidden space-y-2 ${
                    isSelected
                      ? "border-[#00FF6A] bg-[#141414]"
                      : "border-[#2A2A2A] bg-[#141414]"
                  } ${isWeekly && !isSelected ? "opacity-70" : ""}`}
                >
                  {plan.badge && (
                    <div className="absolute -top-px left-1/2 -translate-x-1/2 bg-[#1F1F1F] text-amber-400 text-[8px] font-black px-2 py-0.5 rounded-b-md tracking-wider uppercase border-x border-b border-[#2A2A2A] whitespace-nowrap">
                      {plan.badge}
                    </div>
                  )}

                  <div className="absolute top-2 left-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-[#00FF6A]" : "border-white/30"}`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-[#00FF6A]" />}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className={`text-[14px] font-extrabold mb-1.5 ${isWeekly && !isSelected ? "text-white/80" : "text-white"}`}>{plan.label}</div>
                  </div>

                  <div>
                    <div className={`text-[24px] font-extrabold tabular-nums leading-none ${isSelected ? "text-[#00FF6A]" : isWeekly ? "text-white/80" : "text-slate-50"}`}>
                      {plan.price}
                    </div>
                    <div className={`text-[10px] mt-1 ${isWeekly ? "text-white/50" : "text-white/60"}`}>{plan.subtext}</div>
                  </div>

                  {plan.extraLine && (
                    <div className="text-[10px] font-bold text-[#00FF6A]">{plan.extraLine}</div>
                  )}

                  {plan.saving && (
                    <div className="flex items-start gap-1">
                      <Check className="w-3 h-3 text-[#00FF6A] flex-shrink-0 mt-px" strokeWidth={3} />
                      <span className="text-[10px] font-semibold text-[#00FF6A] leading-tight">{plan.saving}</span>
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        {/* Features accordion */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-6 space-y-2">
          {FEATURES.map((f) => {
            const isExpanded = expandedFeature === f.label;
            return (
              <div key={f.label} className="relative z-10">
                <button
                  onClick={() => setExpandedFeature(isExpanded ? null : f.label)}
                  className={`flex items-center gap-3 w-full rounded-xl px-3.5 py-2.5 border text-left transition-colors ${
                    isExpanded ? "border-[#00FF6A]/40 bg-[#141414]" : "border-[#2A2A2A] bg-[#141414]"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-[#00FF6A]/15 flex items-center justify-center flex-shrink-0">
                    <f.icon className="w-4 h-4 text-[#00FF6A]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">{f.label}</div>
                    {!isExpanded && (
                      <div className="text-[10.5px] text-white/45 truncate mt-0.5">{f.bullets}</div>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-white/50 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="mx-1 mt-1 rounded-lg border border-[#2A2A2A] bg-[#141414] p-3 space-y-2">
                        <p className="text-xs text-white/60 leading-relaxed">{f.description}</p>
                        {f.preview}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>
        {/* Trust signal row */}
        <div className="mt-5 flex items-center gap-3 justify-center text-[10px] text-white/40">
          <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Secure & Encrypted</span>
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span>18+ Bet Responsibly</span>
          <span className="w-1 h-1 rounded-full bg-white/20" />
          <span>Cancel Anytime</span>
        </div>
      </div>

      {/* Sticky bottom CTA footer — gradient passes clicks through */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 pt-8 pb-6 px-5"
        style={{
          background: "linear-gradient(to top, #0A0A0A 55%, rgba(10,10,10,0.95) 75%, transparent)",
          pointerEvents: "none",
        }}
      >
        <div className="mx-auto max-w-md" style={{ pointerEvents: "auto" }}>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSubscribe}
            style={{ animation: "pulse-cta 2.5s ease-in-out infinite" }}
            className="w-full py-[18px] rounded-full bg-[#00FF6A] text-black font-extrabold text-[17px] shadow-[0_0_22px_rgba(0,255,106,0.25)]"
          >
            {ctaLabel}
          </motion.button>
          <p className="text-center text-[11px] text-white/55 mt-2">No charge today • Cancel anytime</p>
        </div>
      </div>
    </div>
  );
}
