import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Star, Shield, Zap, BarChart3, TrendingUp, Crown, ChevronRight, ChevronDown, Rocket } from "lucide-react";
import logo from "@/assets/sentinel-lock.jpg";

type PlanInterval = "weekly" | "monthly" | "yearly";

interface Plan {
  id: PlanInterval;
  label: string;
  price: string;
  perMonth: string;
  
  badge?: string;
  trialText?: string;
  saving?: string;
}

const PLANS: Plan[] = [
  {
    id: "weekly",
    label: "Weekly",
    price: "$9.99",
    perMonth: "$1.43 / day",
    trialText: "7-day free trial",
  },
  {
    id: "monthly",
    label: "Monthly",
    price: "$39.99",
    perMonth: "$39.99 / mo",
    trialText: "7-day free trial",
    saving: "Save $19.97 vs Weekly",
  },
  {
    id: "yearly",
    label: "Yearly",
    price: "$219.99",
    perMonth: "$18.33 / mo",
    saving: "Save $339.49 vs Monthly",
    badge: "BEST VALUE",
    trialText: "7-day free trial",
  },
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
          <div className="px-2 py-1 rounded-md bg-green-500/20 text-green-400 text-[10px] font-black">72% STRONG PICK</div>
          <span className="text-[10px] text-muted-foreground">Over 24.5 Pts</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {[{ l: "Season", v: "68%" }, { l: "L10", v: "80%" }, { l: "L5", v: "100%" }, { l: "H2H", v: "75%" }].map(s => (
            <div key={s.l} className="text-center rounded bg-muted/50 py-1 px-0.5">
              <div className="text-[9px] text-muted-foreground">{s.l}</div>
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
    description: "Know exactly when the books are wrong — see your edge and expected value on every prop.",
    preview: (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Model</span>
          <span className="font-bold text-green-400">72%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-green-500" style={{ width: "72%" }} />
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">Books Implied</span>
          <span className="font-bold text-red-400">52%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-red-400" style={{ width: "52%" }} />
        </div>
        <div className="text-center pt-1">
          <span className="text-[11px] font-black text-green-400">+20% Edge · +14.2% EV</span>
        </div>
      </div>
    ),
  },
  {
    icon: Zap,
    label: "Arbitrage Scanner",
    description: "Find guaranteed profit opportunities across sportsbooks — zero risk.",
    preview: (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-[10px]"><span className="font-bold text-foreground">DraftKings</span> <span className="text-green-400">+150</span></div>
          <div className="text-[10px]"><span className="font-bold text-foreground">FanDuel</span> <span className="text-green-400">-140</span></div>
        </div>
        <div className="text-center">
          <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px] font-black">+3.2% GUARANTEED</span>
        </div>
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
          <div key={pick.p} className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/50 px-2 py-1.5">
            <span className="text-[10px] font-semibold text-foreground">{pick.p}</span>
            <span className={`text-[10px] font-black ${pick.c >= 80 ? "text-green-400" : "text-yellow-400"}`}>{pick.c}%</span>
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
          <div key={r.b} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
            <span className="text-[10px] text-foreground font-medium">{r.b}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-foreground">{r.o}</span>
              {r.best && <span className="text-[8px] font-black text-green-400 bg-green-500/20 px-1 rounded">BEST</span>}
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
      <div className="grid grid-cols-7 gap-0.5">
        {[1, 1, -1, 1, 0, 1, -1, 1, 1, 1, -1, 1, 1, 0, -1, 1, 1, 1, -1, 1, 1].map((v, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-sm ${v > 0 ? "bg-green-500/40" : v < 0 ? "bg-red-500/40" : "bg-muted/30"}`}
          />
        ))}
      </div>
    ),
  },
];

const REVIEWS = [
  { name: "CJ", avatar: "https://ui-avatars.com/api/?name=CJ&background=1a1a2e&color=fff&size=80", text: "Arb scanner paid for itself day one. Found 3 plays before the lines moved." },
  { name: "Trey", avatar: "https://ui-avatars.com/api/?name=T&background=2d2d44&color=fff&size=80", text: "Been capping for years but the EV tool showed me edges I was completely missing." },
  { name: "Dez", avatar: "https://ui-avatars.com/api/?name=D&background=0f3460&color=fff&size=80", text: "Hit a 4-leg parlay first week using the correlated props. This app is different." },
  { name: "Big Rob", avatar: "https://ui-avatars.com/api/?name=BR&background=1a1a2e&color=fff&size=80", text: "Line shopping alone saves me juice every single day. No brainer subscription." },
  { name: "Kev", avatar: "https://ui-avatars.com/api/?name=K&background=16213e&color=fff&size=80", text: "Tracker keeps me honest. I can see exactly where my edge is and where I'm leaking." },
  { name: "Ant", avatar: "https://ui-avatars.com/api/?name=A&background=2d2d44&color=fff&size=80", text: "Props analysis is on point. The hit rates are legit, not some cap." },
  { name: "J-Money", avatar: "https://ui-avatars.com/api/?name=JM&background=0f3460&color=fff&size=80", text: "Best betting tool I've used and I've tried em all. Data is clean and fast." },
  { name: "Dame", avatar: "https://ui-avatars.com/api/?name=DM&background=1a1a2e&color=fff&size=80", text: "Free trial got me hooked. The AI picks actually hit different fr." },
];

export default function PaywallPage() {
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState<PlanInterval>("monthly");
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);

  const currentPlan = PLANS.find((p) => p.id === selectedPlan)!;

  const handleSubscribe = () => {
    localStorage.setItem("sentinel_subscription", "trial");
    navigate("/auth", { replace: true, state: { mode: "signup" } });
  };

  const handleSkip = () => {
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center overflow-y-auto py-6">
      {/* Background glow */}
      <style>{`@keyframes glow-pulse-green { 0%,100% { box-shadow: 0 0 8px 1px rgba(34,197,94,0.15) } 50% { box-shadow: 0 0 18px 4px rgba(34,197,94,0.3) } }`}</style>
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-nba-green/5 blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-5 py-4">
        {/* Logo & headline */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6"
        >
          <img
            src={logo}
            alt="Sentinel"
            className="w-14 h-14 rounded-2xl mx-auto mb-4 shadow-lg shadow-primary/20"
          />
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">
            Try Sentinel Pro
          </h1>
          <p className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-300 mt-1">
            for FREE
          </p>
        </motion.div>

        {/* All plans visible */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-3 mb-5 w-full"
        >
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const isPopular = plan.id === "monthly";
            return (
              <motion.button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                whileTap={{ scale: 0.98 }}
                style={plan.id === "monthly" ? { animation: 'glow-pulse-green 2s ease-in-out infinite' } : undefined}
                className={`relative w-full rounded-2xl border-2 px-4 py-3 text-left transition-all duration-200 overflow-hidden ${
                  plan.id === "weekly" ? "opacity-70" : ""
                } ${
                  isSelected
                    ? "border-green-500/60 ring-1 ring-green-500/30 bg-card"
                    : "border-border bg-card/60"
                }`}
              >
                {/* Glow for selected */}
                {isSelected && (
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-green-500/10 to-transparent pointer-events-none" />
                )}

                {/* MOST POPULAR badge */}
                {isPopular && (
                  <div className="absolute -top-px -right-px bg-green-500 text-black text-[9px] font-black px-2.5 py-0.5 rounded-bl-xl rounded-tr-2xl uppercase tracking-wider mb-1">
                    Most Popular
                  </div>
                )}

                {/* BEST VALUE badge */}
                {plan.badge && plan.id === "yearly" && (
                  <div className="absolute -top-px -right-px bg-amber-500 text-black text-[9px] font-black px-2.5 py-0.5 rounded-bl-xl rounded-tr-2xl uppercase tracking-wider mb-1">
                    {plan.badge}
                  </div>
                )}

                <div className={`relative flex items-center gap-3 ${plan.id !== "weekly" ? "pt-1" : ""}`}>
                  {/* Radio indicator */}
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? "border-green-400" : "border-muted-foreground/40"
                  }`}>
                    {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-green-400" />}
                  </div>

                  {/* Plan info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground whitespace-nowrap">{plan.label}</span>
                      {plan.trialText && (
                        <span className="px-2 py-0.5 rounded-md bg-green-500/20 text-green-400 text-[10px] font-bold uppercase flex-shrink-0">
                          {plan.trialText}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{plan.perMonth}</p>
                  </div>

                  {/* Price + saving */}
                  <div className="text-right flex-shrink-0 flex flex-col items-end gap-1.5">
                    <span className="text-lg font-extrabold text-foreground">{plan.price}</span>
                    {plan.id === "yearly" && (
                      <span style={{ fontSize: 10, color: '#8b87b8' }}>= $18.33 / mo</span>
                    )}
                    {plan.saving && (
                      <div className="flex items-center gap-0.5 rounded-full bg-green-500/10 border border-green-500/15 px-1.5 py-px">
                        <span className="text-green-400/80 text-[8px]">✓</span>
                        <span className="text-[9px] font-semibold text-green-400/80">{plan.saving}</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </motion.div>

        {/* Recovery message */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="text-center text-xs text-muted-foreground mb-5"
        >
          💰 Most users recover subscription cost in <span className="font-bold text-foreground">1–3 days</span>
        </motion.p>

        {/* Social proof */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-center mb-5"
        >
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-2xl">🏆</span>
            <span className="text-xl font-extrabold text-foreground">
              1,200+
            </span>
            <span className="text-2xl">🏆</span>
          </div>
          <p className="text-sm font-semibold text-muted-foreground">
            5 Star Ratings
          </p>
        </motion.div>

        {/* Scrolling review rows */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="w-full mb-5 overflow-hidden rounded-xl"
        >
          {[0, 1].map((row) => {
            const rowReviews = row === 0 ? REVIEWS.slice(0, 4) : REVIEWS.slice(4, 8);
            const doubled = [...rowReviews, ...rowReviews];
            return (
              <div key={row} className={`overflow-hidden ${row === 0 ? 'mb-2' : ''}`}>
                <div
                  className={`flex gap-2 ${row === 0 ? 'animate-[scroll-left_20s_linear_infinite]' : 'animate-[scroll-right_22s_linear_infinite]'}`}
                  style={{ width: 'max-content' }}
                >
                  {doubled.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border bg-card p-2 flex-shrink-0"
                      style={{ width: '140px' }}
                    >
                      <p className="text-[9px] text-foreground/80 leading-snug mb-1.5 line-clamp-3">"{r.text}"</p>
                      <div className="flex items-center gap-1">
                        <img src={r.avatar} alt={r.name} className="w-4 h-4 rounded-full object-cover" />
                        <span className="text-[9px] font-semibold text-foreground">{r.name}</span>
                        <div className="flex gap-0.5 ml-auto">
                          {[1,2,3,4,5].map(s => <Star key={s} className="w-2 h-2 fill-yellow-400 text-yellow-400" />)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </motion.div>

        {/* What do I get? */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mb-6"
        >
          <h2 className="text-lg font-bold text-foreground text-center mb-4">
            What do I get?
          </h2>
          <div className="space-y-3">
            {FEATURES.map((f, i) => {
              const isExpanded = expandedFeature === f.label;
              return (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + i * 0.05 }}
                >
                  <button
                    onClick={() => setExpandedFeature(isExpanded ? null : f.label)}
                    className={`flex items-center gap-3 w-full bg-card/50 rounded-xl px-4 py-3 border text-left transition-colors ${
                      isExpanded ? "border-green-500/40 bg-card" : "border-border/50 hover:border-green-500/40 hover:bg-card"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center flex-shrink-0">
                      <f.icon className="w-4 h-4 text-green-400" />
                    </div>
                    <span className="text-sm font-semibold text-foreground flex-1">
                      {f.label}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="mx-1 mt-1 rounded-lg border border-border/50 bg-card p-3 space-y-2">
                          <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
                          {f.preview}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {/* More to come */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.35 + FEATURES.length * 0.05 }}
            className="mt-4 rounded-xl px-4 py-4 border border-dashed border-primary/30 bg-primary/[0.04] text-center"
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <Rocket className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-foreground">More to Come</span>
            </div>
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
              New tools and features are added regularly — correlated props, live alerts, parlay builder, and more. Your subscription unlocks everything, forever.
            </p>
          </motion.div>
        </motion.div>




        {/* No payment now */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <Check className="w-4 h-4 text-green-400" />
          <span className="text-sm text-muted-foreground font-medium">
            No Payment Due Now
          </span>
        </div>

        {/* CTA */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleSubscribe}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-400 text-black font-extrabold text-lg shadow-lg shadow-green-500/30 hover:shadow-green-500/50 transition-shadow mb-3"
        >
          Start Free Trial
        </motion.button>

        <button
          onClick={handleSkip}
          className="w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Maybe later
        </button>

        <p className="text-[11px] text-muted-foreground/60 text-center mt-4 leading-relaxed">
          {"After your 7-day free trial, you'll be charged " +
            currentPlan.price +
            " per " +
            currentPlan.id +
            ". Cancel anytime."}
        </p>
      </div>
    </div>
  );
}
