import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Star, Shield, Zap, BarChart3, TrendingUp, Crown, ChevronDown, Lock } from "lucide-react";
import CountdownBanner from "@/components/onboarding/CountdownBanner";

type PlanInterval = "weekly" | "monthly" | "yearly";

interface Plan {
  id: PlanInterval;
  label: string;
  price: string;
  perDay: string;
  badge?: "MOST POPULAR" | "BEST VALUE";
  trialText?: string;
  saving?: string;
  perMonthText?: string;
}

const PLANS: Plan[] = [
  { id: "weekly",  label: "Weekly",  price: "$9.99",   perDay: "$1.43/day",   trialText: "7-DAY FREE TRIAL" },
  { id: "monthly", label: "Monthly", price: "$39.99",  perDay: "$39.99/mo",   trialText: "7-DAY FREE TRIAL", badge: "MOST POPULAR", saving: "Save $19.97 vs Weekly" },
  { id: "yearly",  label: "Yearly",  price: "$219.99", perDay: "$18.33/mo",   trialText: "7-DAY FREE TRIAL", badge: "BEST VALUE",   saving: "Save $339.49 vs Monthly", perMonthText: "= $18.33/mo" },
];

interface Feature {
  icon: typeof BarChart3;
  label: string;
  description: string;
  preview: ReactNode;
}

const FEATURES: Feature[] = [
  {
    icon: BarChart3,
    label: "Real-Time Prop Analysis",
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

  const handleSkip = () => navigate("/auth", { replace: true });

  return (
    <div className="relative min-h-screen w-full bg-[#0A0A0A] text-white overflow-x-hidden">
      <style>{`@keyframes pulse-cta { 0%,100% { box-shadow: 0 0 0 0 rgba(0,255,106,0.35) } 50% { box-shadow: 0 0 24px 6px rgba(0,255,106,0.45) } }`}</style>
      {/* Atmospheric glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[520px] h-[420px] rounded-full bg-[#7B2FFF]/30 blur-[120px]" />
        <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full bg-[#641EDC]/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[360px] h-[320px] rounded-full bg-[#00FF6A]/[0.05] blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-5 py-6 pb-36">
        <ProgressDots current={5} total={6} />

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
          <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-tight">Unlock Your Winning Edge.</h1>
          <p className="mt-2 text-sm text-white/60">Join now and start winning.</p>
        </motion.div>

        {/* Countdown banner */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mt-5">
          <CountdownBanner />
        </motion.div>

        {/* Pricing cards */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-5 grid grid-cols-3 gap-2">
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const isMonthly = plan.id === "monthly";
            return (
              <motion.button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                whileTap={{ scale: 0.97 }}
                className={`relative rounded-2xl border-2 px-2 pt-4 pb-2.5 text-center transition-all flex flex-col items-center ${
                  isSelected
                    ? isMonthly
                      ? "border-[#00FF6A] bg-[#141414] shadow-[0_0_0_3px_rgba(0,255,106,0.15),0_0_24px_rgba(0,255,106,0.25)]"
                      : "border-[#00FF6A] bg-[#141414] shadow-[0_0_18px_rgba(0,255,106,0.18)]"
                    : "border-[#2A2A2A] bg-[#141414]"
                }`}
              >
                {plan.badge && (
                  <div
                    className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider whitespace-nowrap ${
                      plan.badge === "MOST POPULAR" ? "bg-[#FFC93C] text-black" : "bg-[#00FF6A] text-black"
                    }`}
                  >
                    {plan.badge}
                  </div>
                )}

                <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider">{plan.label}</span>

                {plan.trialText && (
                  <span className="mt-1 px-1.5 py-0.5 rounded bg-[#00FF6A]/20 text-[#00FF6A] text-[8px] font-black tracking-wider whitespace-nowrap">
                    7-DAY TRIAL
                  </span>
                )}

                <div className={`mt-2 text-base font-extrabold tabular-nums leading-none ${isMonthly ? "text-[#00FF6A]" : "text-white"}`}>
                  {plan.price}
                </div>
                <div className="text-[9px] text-white/50 mt-0.5">{plan.perDay}</div>

                {plan.saving ? (
                  <div className="mt-1 flex items-center gap-0.5 justify-center">
                    <Check className="w-2.5 h-2.5 text-[#00FF6A]" strokeWidth={3} />
                    <span className="text-[8px] font-semibold text-[#00FF6A] leading-tight">{plan.saving}</span>
                  </div>
                ) : (
                  <div className="mt-1 h-3" />
                )}

                <div
                  className={`mt-2 w-full py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    isSelected
                      ? "bg-[#00FF6A] text-black"
                      : "bg-white/10 text-white"
                  }`}
                >
                  {isMonthly ? "Try Free" : "Subscribe"}
                </div>
              </motion.button>
            );
          })}
        </motion.div>

        {/* Features accordion */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mt-6 space-y-2">
          {FEATURES.map((f) => {
            const isExpanded = expandedFeature === f.label;
            return (
              <div key={f.label}>
                <button
                  onClick={() => setExpandedFeature(isExpanded ? null : f.label)}
                  className={`flex items-center gap-3 w-full rounded-xl px-3.5 py-3 border text-left transition-colors ${
                    isExpanded ? "border-[#00FF6A]/40 bg-[#141414]" : "border-[#2A2A2A] bg-[#141414]"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-[#00FF6A]/15 flex items-center justify-center flex-shrink-0">
                    <f.icon className="w-4 h-4 text-[#00FF6A]" />
                  </div>
                  <span className="text-sm font-semibold text-white flex-1">{f.label}</span>
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
      </div>

      {/* Sticky bottom CTA footer */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 pt-8 pb-5 px-5"
        style={{ background: "linear-gradient(to top, #0A0A0A 60%, rgba(10,10,10,0.85) 85%, transparent)" }}
      >
        <div className="mx-auto max-w-md">
          <div className="mb-2 flex items-center justify-between text-[10px] text-white/40">
            <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Secure & Encrypted</span>
            <span>18+ Bet Responsibly</span>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSubscribe}
            style={{ animation: "pulse-cta 2.5s ease-in-out infinite" }}
            className="w-full py-4 rounded-full bg-[#00FF6A] text-black font-extrabold text-base shadow-lg shadow-[#00FF6A]/20"
          >
            Start Free Trial
          </motion.button>
          <p className="text-center text-[11px] text-white/50 mt-2">Cancel anytime. No hidden fees.</p>
          <p className="text-center text-[12px] text-white/60 mt-1">
            <button onClick={handleSkip} className="underline">Maybe later</button>
          </p>
        </div>
      </div>
    </div>
  );
}
