import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Star, Shield, Zap, BarChart3, TrendingUp, Crown, ChevronDown, Lock } from "lucide-react";
import {
  purchasePlan,
  restorePurchases,
  getCurrentOfferingPackages,
} from "@/lib/revenuecat";
import { openExternal } from "@/lib/openExternal";
import { usePremium } from "@/contexts/PremiumContext";
import { useAuth } from "@/contexts/AuthContext";

const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_URL = "https://sentinelprops.com/privacy";
const MANAGE_SUBSCRIPTION_URL = "https://apps.apple.com/account/subscriptions";

type PlanInterval = "weekly" | "monthly" | "yearly";

import { planCopy } from "@/lib/planPricing";
const TRIAL_DAYS = 3;
const TRIAL_LABEL = `${TRIAL_DAYS}-Day Free Trial`;
const CTA_LABEL = `Start Your ${TRIAL_DAYS}-Day Free Trial`;

interface Plan {
  id: PlanInterval;
  label: string;
  /** Fallback price shown until RevenueCat returns the localized App Store price. */
  price: string;
  /** Fallback amount (USD) used to derive per-period prices and savings. */
  amount: number;
  period: string;
  periodShort: string;
  badge?: string;
}

// Per-day/per-month prices and savings are computed in planCopy() from the
// actual prices, so the claims always match what the App Store charges.
const PLANS: Plan[] = [
  { id: "weekly",  label: "Weekly",  price: "$9.99",   amount: 9.99,   period: "/week",  periodShort: "/wk" },
  { id: "monthly", label: "Monthly", price: "$39.99",  amount: 39.99,  period: "/month", periodShort: "/mo", badge: "MOST POPULAR" },
  { id: "yearly",  label: "Yearly",  price: "$219.99", amount: 219.99, period: "/year",  periodShort: "/yr", badge: "Best Long-Term Value" },
];
const WEEKLY_SUBTEXT = "Good for trying it out";

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
          <div className="px-2 py-1 rounded-md bg-primary/20 text-primary text-[10px] font-black">72% STRONG PICK</div>
          <span className="text-[10px] text-foreground/50">Over 24.5 Pts</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {[{ l: "Season", v: "68%" }, { l: "L10", v: "80%" }, { l: "L5", v: "100%" }, { l: "H2H", v: "75%" }].map(s => (
            <div key={s.l} className="text-center rounded bg-foreground/5 py-1 px-0.5">
              <div className="text-[9px] text-foreground/50">{s.l}</div>
              <div className="text-[11px] font-bold text-foreground">{s.v}</div>
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
        <div className="flex items-center justify-between text-[10px]"><span className="text-foreground/50">Model</span><span className="font-bold text-primary">72%</span></div>
        <div className="w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden"><div className="h-full bg-primary" style={{ width: "72%" }} /></div>
        <div className="flex items-center justify-between text-[10px]"><span className="text-foreground/50">Books Implied</span><span className="font-bold text-danger">52%</span></div>
        <div className="w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden"><div className="h-full bg-danger" style={{ width: "52%" }} /></div>
        <div className="text-center pt-1"><span className="text-[11px] font-black text-primary">+20% Edge · +14.2% EV</span></div>
      </div>
    ),
  },
  {
    icon: Zap,
    label: "Arbitrage Scanner",
    bullets: "Risk-free spots · Cross-book scan · Instant alerts",
    description: "Find guaranteed profit opportunities across sportsbooks — zero risk.",
    preview: (
      <div className="rounded-lg border border-border bg-foreground/5 p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[10px]"><span className="font-bold text-foreground">DraftKings</span> <span className="text-primary">+150</span></div>
          <div className="text-[10px]"><span className="font-bold text-foreground">FanDuel</span> <span className="text-primary">-140</span></div>
        </div>
        <div className="text-center"><span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-[10px] font-black">+3.2% GUARANTEED</span></div>
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
          <div key={pick.p} className="flex items-center justify-between rounded-lg bg-foreground/5 border border-border px-2 py-1.5">
            <span className="text-[10px] font-semibold text-foreground">{pick.p}</span>
            <span className={`text-[10px] font-black ${pick.c >= 80 ? "text-primary" : "text-warning"}`}>{pick.c}%</span>
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
          <div key={r.b} className="flex items-center justify-between rounded bg-foreground/5 px-2 py-1">
            <span className="text-[10px] text-foreground font-medium">{r.b}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-foreground">{r.o}</span>
              {r.best && <span className="text-[8px] font-black text-primary bg-primary/20 px-1 rounded">BEST</span>}
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
          <div key={s.l} className="flex-1 text-center rounded-md bg-foreground/5 py-1 px-1">
            <div className="text-[8px] text-foreground/50">{s.l}</div>
            <div className="text-[10px] font-bold text-primary">{s.v}</div>
          </div>
        ))}
      </div>
    ),
  },
];

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-foreground/60 tabular-nums">{current} / {total}</span>
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
  const { isAuthenticated } = useAuth();
  const { isPremium, refresh: refreshPremium } = usePremium();
  const [selectedPlan, setSelectedPlan] = useState<PlanInterval>("monthly");
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Partial<Record<PlanInterval, string>>>({});
  const [liveAmounts, setLiveAmounts] = useState<Partial<Record<PlanInterval, number>>>({});
  const [liveCurrency, setLiveCurrency] = useState<string | null>(null);

  // Pull localized App Store prices from RevenueCat offerings so we never
  // display hardcoded prices on the paywall (Apple requires this).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pkgs = await getCurrentOfferingPackages();
        if (cancelled) return;
        setLivePrices({
          weekly: pkgs.weekly?.product.priceString,
          monthly: pkgs.monthly?.product.priceString,
          yearly: pkgs.yearly?.product.priceString,
        });
        setLiveAmounts({
          weekly: pkgs.weekly?.product.price,
          monthly: pkgs.monthly?.product.price,
          yearly: pkgs.yearly?.product.price,
        });
        setLiveCurrency(
          pkgs.monthly?.product.currencyCode ?? pkgs.yearly?.product.currencyCode ?? pkgs.weekly?.product.currencyCode ?? null,
        );
      } catch (err) {
        console.error("Failed to load offerings:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const priceFor = (id: PlanInterval) => livePrices[id] || PLANS.find((p) => p.id === id)!.price;
  // Derive copy from the same prices we display: live store prices when loaded,
  // otherwise the USD fallbacks. Never mix a live price with a fallback amount.
  const hasLive = Object.values(livePrices).some(Boolean);
  const amountFor = (id: PlanInterval) =>
    hasLive ? (livePrices[id] ? liveAmounts[id] : undefined) : PLANS.find((p) => p.id === id)!.amount;
  const copy = planCopy(
    { weekly: amountFor("weekly"), monthly: amountFor("monthly"), yearly: amountFor("yearly") },
    hasLive ? liveCurrency ?? "USD" : "USD",
  );

  const handleSubscribe = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const success = await purchasePlan(selectedPlan);
      if (success) {
        console.info("[paywall] purchase completed before auth", { isAuthenticated });
        if (isAuthenticated) {
          await refreshPremium("purchase_completed");
          navigate("/welcome", { replace: true });
        } else {
          navigate("/auth", { replace: true, state: { mode: "signup" } });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      if (msg.includes("only work inside the iOS app")) {
        setError("Purchases are only available in the iOS app.");
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const success = await restorePurchases();
      if (success) {
        if (isAuthenticated) {
          await refreshPremium("restore_completed");
          navigate("/welcome", { replace: true });
        } else {
          navigate("/auth", { replace: true, state: { mode: "login" } });
        }
      } else {
        setError("No active Sentinel Premium subscription was found for this Apple ID.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Restore failed.";
      if (msg.includes("only works inside the iOS app")) {
        setError("Restore is only available in the iOS app.");
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const ctaLabel = CTA_LABEL;

  const monthlyValueStack = [
    "Full AI prop access",
    "Daily top-rated plays",
    "Real-time updates",
  ];

  return (
    <div className="relative min-h-screen w-full bg-background text-foreground overflow-x-hidden pt-safe pb-safe">
      <style>{`
        @keyframes pulse-cta { 0%,100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.22) } 50% { box-shadow: 0 0 18px 4px hsl(var(--primary) / 0.28) } }
        @keyframes card-pulse {
          0%,100% { box-shadow: 0 0 0 2px hsl(var(--primary)), 0 0 30px hsl(var(--primary) / 0.26), 0 0 60px hsl(var(--primary) / 0.11), inset 0 0 24px hsl(var(--primary) / 0.04); }
          50% { box-shadow: 0 0 0 2px hsl(var(--primary)), 0 0 42px hsl(var(--primary) / 0.38), 0 0 84px hsl(var(--primary) / 0.16), inset 0 0 24px hsl(var(--primary) / 0.05); }
        }
        @keyframes card-pulse-sm {
          0%,100% { box-shadow: 0 0 0 2px hsl(var(--primary)), 0 0 18px hsl(var(--primary) / 0.24), 0 0 36px hsl(var(--primary) / 0.10), inset 0 0 16px hsl(var(--primary) / 0.04); }
          50% { box-shadow: 0 0 0 2px hsl(var(--primary)), 0 0 28px hsl(var(--primary) / 0.36), 0 0 56px hsl(var(--primary) / 0.16), inset 0 0 16px hsl(var(--primary) / 0.05); }
        }
      `}</style>
      {/* Atmospheric glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[520px] h-[420px] rounded-full bg-primary/30 blur-[120px]" />
        <div className="absolute -bottom-32 -left-32 w-[420px] h-[420px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[360px] h-[320px] rounded-full bg-primary/[0.05] blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-md px-5 py-6 pb-36">
        <ProgressDots current={5} total={6} />

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <div className="text-[11px] font-extrabold tracking-[0.18em] uppercase text-primary">Sentinel Premium</div>
          <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-tight mt-1">Start Winning With Data</h1>
          <p className="mt-2 text-sm text-foreground/60">AI-powered props. Real edge. Proven results.</p>
        </motion.div>

        {/* Trial pill */}
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }} className="mt-3 flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/12 border border-primary/30 px-3 py-1 text-[11px] font-bold text-primary">
            <Check className="w-3 h-3" strokeWidth={3} />
            {TRIAL_LABEL} • No charge today
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
                className="w-6 h-6 rounded-full border border-background object-cover"
              />
            ))}
          </div>
          <span className="text-[12px] text-foreground/70 font-semibold">
            <span className="text-foreground font-extrabold">10,000+</span> bettors using our AI daily
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
                className={`relative w-full rounded-[20px] border-2 bg-card pl-11 pr-5 py-6 mb-3 text-left overflow-hidden block transition-colors ${
                  isSelected ? "border-primary" : "border-border"
                }`}
                style={{
                  animation: isSelected ? "card-pulse 3s ease-in-out infinite" : undefined,
                }}
              >
                <div className="absolute -top-px left-1/2 -translate-x-1/2 bg-[hsl(var(--nba-yellow))] text-black text-[8px] font-black px-2.5 py-0.5 rounded-b-lg tracking-widest uppercase">
                  MOST POPULAR
                </div>

                <div className="absolute top-4 left-3.5">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-primary" : "border-foreground/30"}`}>
                    {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                  </div>
                </div>

                <div className="flex items-start justify-between mt-2 gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-extrabold text-foreground">{monthly.label}</div>
                    {copy.monthly.subtext && <div className="text-[11px] text-foreground/50 mt-0.5">{copy.monthly.subtext}</div>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-baseline justify-end gap-1">
                      <span className="text-[34px] font-black text-primary tabular-nums leading-none">{priceFor("monthly")}</span>
                      <span className="text-[11px] font-bold text-foreground/50">{monthly.period}</span>
                    </div>
                    <div className="text-[10px] font-semibold text-foreground/70 mt-1">
                      {TRIAL_DAYS} days free, then {priceFor("monthly")}{monthly.period}
                    </div>
                    {copy.monthly.saving && (
                      <div className="flex items-center gap-0.5 mt-1 justify-end">
                        <Check className="w-3 h-3 text-primary" strokeWidth={3} />
                        <span className="text-[10px] font-semibold text-primary">{copy.monthly.saving}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Value stack */}
                <ul className="mt-4 space-y-1.5">
                  {monthlyValueStack.map((v) => (
                    <li key={v} className="flex items-center gap-2 text-[12px] text-foreground/85">
                      <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" strokeWidth={3} />
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
              const subtext = isWeekly ? WEEKLY_SUBTEXT : copy.yearly.subtext;
              const extraLine = isWeekly ? undefined : copy.yearly.extraLine;
              const saving = isWeekly ? undefined : copy.yearly.saving;
              return (
                <motion.button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  whileTap={{ scale: 0.97 }}
                  className={`relative rounded-2xl border-2 px-4 py-4 pl-9 text-left transition-all overflow-hidden space-y-2 ${
                    isSelected
                      ? "border-primary bg-card"
                      : "border-border bg-card"
                  } ${isWeekly && !isSelected ? "opacity-70" : ""}`}
                  style={{
                    animation: isSelected ? "card-pulse-sm 3s ease-in-out infinite" : undefined,
                  }}
                >
                  {plan.badge && (
                    <div className="absolute -top-px left-1/2 -translate-x-1/2 bg-secondary text-warning text-[8px] font-black px-2 py-0.5 rounded-b-md tracking-wider uppercase border-x border-b border-border whitespace-nowrap">
                      {plan.badge}
                    </div>
                  )}

                  <div className="absolute top-2 left-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-primary" : "border-foreground/30"}`}>
                      {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className={`text-[14px] font-extrabold mb-1.5 ${isWeekly && !isSelected ? "text-foreground/80" : "text-foreground"}`}>{plan.label}</div>
                  </div>

                  <div>
                    <div className={`text-[24px] font-extrabold tabular-nums leading-none ${isSelected ? "text-primary" : isWeekly ? "text-foreground/80" : "text-foreground"}`}>
                      {priceFor(plan.id)}
                    </div>
                    {subtext && <div className={`text-[10px] mt-1 ${isWeekly ? "text-foreground/50" : "text-foreground/60"}`}>{subtext}</div>}
                    <div className="text-[9px] font-semibold text-foreground/70 mt-1 leading-tight">
                      {TRIAL_DAYS} days free, then {priceFor(plan.id)}{plan.periodShort}
                    </div>
                  </div>

                  {extraLine && (
                    <div className="text-[10px] font-bold text-primary">{extraLine}</div>
                  )}

                  {saving && (
                    <div className="flex items-start gap-1">
                      <Check className="w-3 h-3 text-primary flex-shrink-0 mt-px" strokeWidth={3} />
                      <span className="text-[10px] font-semibold text-primary leading-tight">{saving}</span>
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
                    isExpanded ? "border-primary/40 bg-card" : "border-border bg-card"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <f.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">{f.label}</div>
                    {!isExpanded && (
                      <div className="text-[10.5px] text-foreground/45 truncate mt-0.5">{f.bullets}</div>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-foreground/50 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="mx-1 mt-1 rounded-lg border border-border bg-card p-3 space-y-2">
                        <p className="text-xs text-foreground/60 leading-relaxed">{f.description}</p>
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
        <div className="mt-5 flex items-center gap-3 justify-center text-[10px] text-foreground/40">
          <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Secure & Encrypted</span>
          <span className="w-1 h-1 rounded-full bg-foreground/20" />
          <span>18+ Bet Responsibly</span>
          <span className="w-1 h-1 rounded-full bg-foreground/20" />
          <span>Cancel Anytime</span>
        </div>
      </div>

      {/* Sticky bottom CTA footer — gradient passes clicks through */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 pt-8 px-5 pb-safe-plus-4"
        style={{
          background: "linear-gradient(to top, hsl(var(--background)) 55%, hsl(var(--background) / 0.95) 75%, transparent)",
          pointerEvents: "none",
        }}
      >
        <div className="mx-auto max-w-md" style={{ pointerEvents: "auto" }}>
          <motion.button
            whileTap={isLoading ? {} : { scale: 0.97 }}
            onClick={handleSubscribe}
            disabled={isLoading}
            style={{ animation: isLoading ? undefined : "pulse-cta 2.5s ease-in-out infinite" }}
            className="w-full py-[18px] rounded-full bg-primary text-primary-foreground font-extrabold text-[17px] shadow-[0_0_22px_hsl(var(--primary) / 0.25)] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Processing…
              </>
            ) : (
              ctaLabel
            )}
          </motion.button>
          {error && (
            <p className="text-center text-[11px] text-danger mt-2 px-2">{error}</p>
          )}
          <p className="text-center text-[11px] text-foreground/55 mt-2">No charge today • Cancel anytime</p>
          <button
            onClick={handleRestore}
            disabled={isLoading}
            className="w-full text-center text-[11px] text-foreground/35 mt-1 disabled:opacity-40"
          >
            Restore Purchases
          </button>

          <p className="text-[10px] text-foreground/40 mt-3 leading-snug px-1">
            Subscription auto-renews at the selected price until cancelled. Cancel anytime in your
            Apple ID subscription settings at least 24 hours before the end of the current period.
            Any unused portion of a free trial is forfeited when purchasing a subscription.
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-foreground/50">
            <button onClick={() => void openExternal(TERMS_URL)} className="underline underline-offset-2 hover:text-foreground/80">
              Terms of Use
            </button>
            <span className="w-1 h-1 rounded-full bg-foreground/20" />
            <button onClick={() => void openExternal(PRIVACY_URL)} className="underline underline-offset-2 hover:text-foreground/80">
              Privacy Policy
            </button>
            {isPremium && (
              <>
                <span className="w-1 h-1 rounded-full bg-foreground/20" />
                <button onClick={() => void openExternal(MANAGE_SUBSCRIPTION_URL)} className="underline underline-offset-2 hover:text-foreground/80">
                  Manage Subscription
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
