import React, { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Zap,
  Search,
  BarChart3,
  Shield,
  Target,
  Flame,
  Trophy,
  Dumbbell,
  Check,
  Sparkles,
  LineChart,
  ChevronRight,
  Clock,
  Layers,
  DollarSign,
  Brain,
  CheckCircle,
  FileText,
  Swords,
  AlertTriangle,
} from "lucide-react";
import logo from "@/assets/sentinel-lock.jpg";
// lukaImg removed — now using sport-specific ESPN headshots
import iconSmartProps from "@/assets/icon-smart-props.png";
import iconEvEdges from "@/assets/icon-ev-edges.png";
import iconLiveOdds from "@/assets/icon-live-odds.png";
import iconAiPicks from "@/assets/icon-ai-picks.png";

/* ═══ Smooth transitions ═══ */
const ease = [0.32, 0.72, 0, 1];
const pageTransition = { duration: 0.55, ease };
const stagger = (i: number, base = 0.07) => ({ delay: i * base, duration: 0.5, ease });

/* ═══ Sport logos (high-quality images) ═══ */
import logoNba from "@/assets/logo-nba.png";
import logoMlb from "@/assets/logo-mlb.png";
import logoUfc from "@/assets/logo-ufc.png";
import logoNfl from "@/assets/logo-nfl.png";
import logoNhl from "@/assets/logo-nhl.png";
import logoSoccer from "@/assets/logo-soccer.png";

/* ═══ Types ═══ */
type Step = "hero" | "referral" | "sports" | "style" | "what-are-props" | "how-it-works";
const ALL_STEPS: Step[] = ["hero", "referral", "sports", "style", "what-are-props", "how-it-works"];

const XLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const InstagramLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
    <rect x="2" y="2" width="20" height="20" rx="5" stroke="url(#ig)" strokeWidth="1.8" />
    <circle cx="12" cy="12" r="5" stroke="url(#ig)" strokeWidth="1.8" />
    <circle cx="17.5" cy="6.5" r="1.3" fill="url(#ig)" />
    <defs>
      <linearGradient id="ig" x1="2" y1="22" x2="22" y2="2">
        <stop stopColor="#feda75" />
        <stop offset="0.3" stopColor="#fa7e1e" />
        <stop offset="0.6" stopColor="#d62976" />
        <stop offset="1" stopColor="#962fbf" />
      </linearGradient>
    </defs>
  </svg>
);

const YouTubeLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31.9 31.9 0 000 12a31.9 31.9 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31.9 31.9 0 0024 12a31.9 31.9 0 00-.5-5.8z" fill="#FF0000" />
    <path d="M9.75 15.02l6.28-3.02-6.28-3.02v6.04z" fill="#fff" />
  </svg>
);

const TikTokLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
    <path d="M16.6 5.82A4.28 4.28 0 0115.55 3h-3.07v12.4a2.59 2.59 0 01-2.59 2.35 2.59 2.59 0 01-2.59-2.59 2.59 2.59 0 012.59-2.59c.27 0 .53.04.78.11V9.55a5.73 5.73 0 00-.78-.05 5.72 5.72 0 00-5.72 5.72A5.72 5.72 0 009.89 21a5.72 5.72 0 005.72-5.72V8.87a7.34 7.34 0 004.29 1.37V7.17a4.28 4.28 0 01-3.3-1.35z" fill="currentColor" />
    <path d="M16.6 5.82A4.28 4.28 0 0115.55 3h-3.07v12.4a2.59 2.59 0 01-2.59 2.35 2.59 2.59 0 01-2.59-2.59 2.59 2.59 0 012.59-2.59c.27 0 .53.04.78.11V9.55a5.73 5.73 0 00-.78-.05 5.72 5.72 0 00-5.72 5.72A5.72 5.72 0 009.89 21a5.72 5.72 0 005.72-5.72V8.87a7.34 7.34 0 004.29 1.37V7.17a4.28 4.28 0 01-3.3-1.35z" fill="#25F4EE" opacity="0.6" transform="translate(-0.5, -0.5)" />
    <path d="M16.6 5.82A4.28 4.28 0 0115.55 3h-3.07v12.4a2.59 2.59 0 01-2.59 2.35 2.59 2.59 0 01-2.59-2.59 2.59 2.59 0 012.59-2.59c.27 0 .53.04.78.11V9.55a5.73 5.73 0 00-.78-.05 5.72 5.72 0 00-5.72 5.72A5.72 5.72 0 009.89 21a5.72 5.72 0 005.72-5.72V8.87a7.34 7.34 0 004.29 1.37V7.17a4.28 4.28 0 01-3.3-1.35z" fill="#FE2C55" opacity="0.6" transform="translate(0.5, 0.5)" />
  </svg>
);

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const REFERRALS = [
  { label: "X (Twitter)", icon: XLogo },
  { label: "Instagram", icon: InstagramLogo },
  { label: "YouTube", icon: YouTubeLogo },
  { label: "TikTok", icon: TikTokLogo },
  { label: "Friend", emoji: "🤝" },
  { label: "Google", icon: GoogleLogo },
  { label: "Other", emoji: "💬" },
];

const SPORTS = [
  { label: "NBA", logoSrc: logoNba },
  { label: "MLB", logoSrc: logoMlb },
  { label: "UFC", logoSrc: logoUfc },
  { label: "NFL", logoSrc: logoNfl },
  { label: "NHL", logoSrc: logoNhl },
  { label: "Soccer", logoSrc: logoSoccer },
];

const STYLES = [
  { icon: Target, label: "Beginner", sub: "New to sports analysis — show me the ropes", emoji: "🌱" },
  { icon: Dumbbell, label: "Intermediate", sub: "I know the basics, want an edge", emoji: "📈" },
  { icon: Trophy, label: "Knowledgeable", sub: "Experienced — I'm data-driven", emoji: "🧠" },
  { icon: Flame, label: "Expert", sub: "Sharp analyst — give me the raw numbers", emoji: "🔥" },
];

const FEATURES = [
  { icon: Search, title: "Line Shopping", desc: "Major sportsbooks", detail: "Compare odds across all major sportsbooks in real time to always get the best number on any prop." },
  { icon: BarChart3, title: "EV Calculator", desc: "Find +EV edges", detail: "Our model calculates the true probability of any prop and compares it to the book's line to find +EV edges." },
  { icon: TrendingUp, title: "Multi-Sport", desc: "NBA · MLB · UFC", detail: "Full prop analysis across NBA, MLB, and UFC — same powerful models adapted for each sport." },
  { icon: Zap, title: "Arb Scanner", desc: "Risk-free plays", detail: "Automatically detects arbitrage opportunities across sportsbooks so you can lock in guaranteed profit." },
  { icon: Shield, title: "AI Picks", desc: "Daily top plays", detail: "Our AI engine surfaces the top daily plays ranked by confidence, edge, and historical hit rate." },
  { icon: LineChart, title: "Profit Tracker", desc: "Track bankroll", detail: "Log your bets, track P&L on a visual calendar, and monitor your bankroll over time with charts." },
];

/* ═══ Glassmorphic selection tile ═══ */
const Tile = ({ label, emoji, icon: Icon, sub, selected, onClick, idx, sportLogo: SportLogo, sportColor, sportLogoSrc }: {
  label: string; emoji?: string; icon?: React.ElementType; sub?: string;
  selected: boolean; onClick: () => void; idx: number;
  sportLogo?: React.ElementType; sportColor?: string; sportLogoSrc?: string;
}) => (
  <motion.button
    initial={{ opacity: 0, y: 18 }}
    animate={{ opacity: 1, y: 0 }}
    transition={stagger(idx, 0.05)}
    onClick={onClick}
    whileTap={{ scale: 0.96 }}
    className={`relative w-full flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-left transition-all duration-300
      ${selected
        ? "bg-primary/[0.12] border border-primary/40 shadow-[0_0_24px_hsla(250,76%,62%,0.12)]"
        : "bg-card/80 border border-border/60 hover:border-primary/25 hover:bg-card"}`}
  >
    <div className={`${sportLogoSrc ? "w-11 h-11" : "w-10 h-10"} rounded-lg flex items-center justify-center shrink-0 transition-colors duration-300
      ${selected ? "bg-primary/20 border border-primary/30" : "bg-secondary/80 border border-border/50"}`}>
      {sportLogoSrc
        ? <img src={sportLogoSrc} alt={label} className="w-10 h-10 object-contain" />
        : SportLogo
        ? <SportLogo className={`w-5 h-5 ${sportColor || "text-muted-foreground/80"}`} />
        : emoji
          ? <span className="text-lg">{emoji}</span>
          : Icon ? <Icon className={`w-4.5 h-4.5 transition-colors ${selected ? "text-primary" : "text-muted-foreground/70"}`} /> : null}
    </div>
    <div className="flex-1 min-w-0">
      <p className={`text-sm font-semibold transition-colors ${selected ? "text-foreground" : "text-foreground/80"}`}>{label}</p>
      {sub && <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{sub}</p>}
    </div>
    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300
      ${selected ? "border-primary bg-primary" : "border-muted-foreground/50 bg-transparent"}`}>
      {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
    </div>
  </motion.button>
);

/* ═══ Section header ═══ */
const Header = ({ emoji, title, sub }: { emoji?: string; title: string; sub: string }) => (
  <div className="text-center mb-5">
    {emoji && (
      <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 15 }}
        className="text-4xl mb-4">{emoji}</motion.div>
    )}
    <motion.h2 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, ...pageTransition }}
      className="text-2xl font-extrabold text-foreground tracking-tight">{title}</motion.h2>
    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12, ...pageTransition }}
      className="text-sm text-muted-foreground/70 mt-2 max-w-[280px] mx-auto leading-relaxed">{sub}</motion.p>
  </div>
);

/* ═══ Feature Badge with popover ═══ */
const FeatureBadge = ({ item, index, pageTransition }: {
  item: { img?: string; icon?: React.ComponentType<any>; iconColor?: string; label: string; desc: string; example: string };
  index: number;
  pageTransition: typeof ease extends any ? any : never;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 + index * 0.06, ...pageTransition }}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-card/70 border border-border/40 text-foreground/70 cursor-pointer hover:bg-card hover:border-primary/30 transition-colors"
      >
        {item.img ? <img src={item.img} alt={item.label} className="w-4 h-4 object-contain" /> : item.icon ? <item.icon className={`w-4 h-4 ${item.iconColor || "text-primary"}`} /> : null}
        {item.label}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 p-4 rounded-2xl bg-card border border-border shadow-xl shadow-black/40"
          >
            <div className="flex items-center gap-2 mb-2">
              {item.img ? <img src={item.img} alt={item.label} className="w-6 h-6 object-contain" /> : item.icon ? <item.icon className={`w-6 h-6 ${item.iconColor || "text-primary"}`} /> : null}
              <span className="text-sm font-bold text-foreground">{item.label}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">{item.desc}</p>
            <div className="px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-[11px] text-primary font-medium">{item.example}</p>
            </div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-border" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ═══ Feature Card with hover popover ═══ */
const FeatureCard = ({ feature: f, index: i }: {
  feature: typeof FEATURES[number];
  index: number;
}) => {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={stagger(i, 0.06)}
      className="relative rounded-xl p-4 flex flex-col items-center text-center bg-card/60 border border-border/30 hover:border-primary/30 transition-all cursor-pointer"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onClick={() => setHovered(h => !h)}>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-2.5 bg-primary/10 border border-primary/12">
        <f.icon className="w-4.5 h-4.5 text-primary" />
      </div>
      <p className="text-[13px] font-bold text-foreground">{f.title}</p>
      <p className="text-[10px] text-muted-foreground/35 mt-0.5">{f.desc}</p>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="absolute z-50 bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 p-3.5 rounded-2xl"
            style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border) / 0.5)",
              boxShadow: "0 16px 48px hsla(228,40%,4%,0.6), 0 0 1px hsl(var(--border) / 0.3)",
            }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center bg-primary/10 border border-primary/15">
                <f.icon className="w-3 h-3 text-primary" />
              </div>
              <span className="text-[12px] font-bold text-foreground">{f.title}</span>
            </div>
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">{f.detail}</p>
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent" style={{ borderTopColor: "hsl(var(--border) / 0.5)" }} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};


const ToolkitCard = ({ tool, index }: {
  tool: { icon: React.ElementType; color: string; bg: string; border: string; title: string; desc: string; example: string; details: string };
  index: number;
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={stagger(index, 0.08)}
      onClick={() => setExpanded(e => !e)}
      className={`rounded-2xl bg-card/70 border ${tool.border} cursor-pointer transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_24px_hsla(250,76%,62%,0.06)] overflow-hidden`}
    >
      <div className="flex gap-3.5 p-4 items-center">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tool.bg} border ${tool.border}`}>
          <tool.icon className={`w-5 h-5 ${tool.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">{tool.title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{tool.desc}</p>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.25 }}
          className="shrink-0"
        >
          <TrendingDown className="w-4 h-4 text-muted-foreground/65" />
        </motion.div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 space-y-3">
              <div className="h-px bg-border/30" />
              <p className="text-xs text-muted-foreground leading-relaxed">{tool.details}</p>
              <div className="px-3 py-2.5 rounded-xl bg-primary/[0.06] border border-primary/15">
                <p className="text-[11px] text-primary font-semibold italic">{tool.example}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* ═══ Main ═══ */
const OnboardingPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [referral, setReferral] = useState<string | null>(null);
  const [otherReferralText, setOtherReferralText] = useState("");
  const [sports, setSports] = useState<string[]>([]);
  const [style, setStyle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customSport, setCustomSport] = useState("");
  const [headErr, setHeadErr] = useState(false);

  const STEPS = useMemo(() => {
    const skipProps = style === "Knowledgeable" || style === "Expert";
    return skipProps ? ALL_STEPS.filter(s => s !== "what-are-props") : ALL_STEPS;
  }, [style]);

  const total = STEPS.length;
  const current = STEPS[step];
  const isLast = step === total - 1;

  const saveOnboardingData = () => {
    // Store in localStorage for post-auth save
    localStorage.setItem("sentinel_onboarding_referral", referral === "Other" && otherReferralText.trim() ? `Other: ${otherReferralText.trim()}` : referral || "");
    localStorage.setItem("sentinel_onboarding_sports", JSON.stringify(sports));
    localStorage.setItem("sentinel_onboarding_style", style || "");
  };

  const toggleSport = (s: string) => setSports(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  const next = useCallback(() => {
    if (isLast) {
      saveOnboardingData();
      navigate("/paywall", { replace: true });
    }
    else { setDir(1); setStep(s => s + 1); }
  }, [isLast, navigate, referral, sports, style, saving]);
  const back = () => { if (step > 0) { setDir(-1); setStep(s => s - 1); } };
  const skip = () => {
    saveOnboardingData();
    navigate("/paywall", { replace: true });
  };


  const slideVariants = {
    enter: (d: number) => ({ opacity: 0, x: d > 0 ? 60 : -60, scale: 0.97 }),
    center: { opacity: 1, x: 0, scale: 1 },
    exit: (d: number) => ({ opacity: 0, x: d > 0 ? -40 : 40, scale: 0.97 }),
  };

  // Show progress + CTA on all steps
  const isRevealStep = false;

  return (
    <div className="h-[100dvh] bg-background flex flex-col items-center relative overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, hsl(var(--primary)), transparent 60%)", filter: "blur(100px)" }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, hsl(var(--nba-cyan)), transparent 60%)", filter: "blur(80px)" }} />
      </div>

      {/* Progress */}
      <AnimatePresence>
        {!isRevealStep && (
          <motion.div
            initial={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md px-8 pt-[max(env(safe-area-inset-top,20px),20px)] relative z-10"
          >
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div key={i} className="h-[3px] flex-1 rounded-full overflow-hidden bg-border/30">
                  <motion.div className="h-full rounded-full"
                    initial={false}
                    animate={{
                      width: i < step ? "100%" : i === step ? "100%" : "0%",
                      opacity: i <= step ? 1 : 0,
                    }}
                    style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--nba-cyan)))" }}
                    transition={{ duration: 0.5, ease: "easeOut" }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-3">
              <span className="text-[10px] text-muted-foreground/55 font-medium tracking-wider uppercase">
                Step {step + 1} of {total}
              </span>
              {!isLast && (
                <button onClick={skip} className="text-[10px] text-muted-foreground/55 hover:text-muted-foreground/50 transition-colors font-medium">
                  Skip all
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center w-full px-6 py-6 relative z-10 overflow-y-auto min-h-0">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait" custom={dir}>

            {/* ─── HERO (combined with bankroll graphs) ─── */}
            {current === "hero" && (
              <motion.div key="hero" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit"
                transition={pageTransition} className="flex flex-col items-center text-center">
                <motion.div className="relative mb-4"
                  initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 200, damping: 18 }}>
                  <div className="absolute -inset-4 rounded-2xl opacity-30 blur-2xl"
                    style={{ background: "hsl(var(--primary))" }} />
                  <img src={logo} alt="Sentinel" className="w-16 h-16 rounded-2xl relative border border-primary/20"
                    style={{ boxShadow: "0 12px 40px hsla(250,76%,50%,0.25)" }} draggable={false} />
                </motion.div>
                <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, ...pageTransition }}
                  className="text-2xl font-extrabold tracking-tight leading-[1.1] mb-2">
                  Welcome to{" "}
                  <span className="bg-clip-text text-transparent"
                    style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--nba-cyan)))" }}>
                    Sentinel
                  </span>
                </motion.h1>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, ...pageTransition }}
                  className="text-sm text-muted-foreground/50 max-w-[280px] leading-relaxed mb-6">
                  Data beats gut feeling — every time.
                </motion.p>

                {/* Bankroll comparison graphs */}
                <div className="w-full space-y-3">
                  {/* Emotional betting — RED declining graph */}
                  <motion.div className="rounded-2xl p-4 text-left relative overflow-hidden"
                    style={{ background: "hsl(var(--card))", border: "1px solid hsl(0 72% 51% / 0.2)" }}
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, ...pageTransition }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground/65 uppercase tracking-widest font-semibold">😤 Going with Your Gut</p>
                        <motion.p className="text-xl font-extrabold mt-0.5"
                          style={{ color: "hsl(0 72% 60%)" }}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                          -$1,340
                        </motion.p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold"
                        style={{ background: "hsl(0 72% 51% / 0.1)", color: "hsl(0 72% 60%)", border: "1px solid hsl(0 72% 51% / 0.15)" }}>
                        -67% ROI
                      </span>
                    </div>
                    <svg viewBox="0 0 360 80" className="w-full h-16" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="redFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(0 72% 51%)" stopOpacity="0.12" />
                          <stop offset="100%" stopColor="hsl(0 72% 51%)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <motion.polygon
                        points="0,10 30,14 60,12 90,22 120,28 150,35 180,42 210,50 240,55 270,62 300,68 330,72 360,78 360,80 0,80"
                        fill="url(#redFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} />
                      <motion.polyline
                        points="0,10 30,14 60,12 90,22 120,28 150,35 180,42 210,50 240,55 270,62 300,68 330,72 360,78"
                        fill="none" stroke="hsl(0 72% 51%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                        transition={{ delay: 0.4, duration: 1, ease: "easeOut" }} />
                    </svg>
                    <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1 font-medium tracking-wider uppercase">
                      <span>Week 1</span><span>Week 12</span>
                    </div>
                  </motion.div>

                  {/* Data-driven — GREEN rising graph */}
                  <motion.div className="rounded-2xl p-4 text-left relative overflow-hidden"
                    style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--nba-green) / 0.2)" }}
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, ...pageTransition }}>
                    <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-[0.06] blur-3xl pointer-events-none"
                      style={{ background: "hsl(var(--nba-green))" }} />
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground/65 uppercase tracking-widest font-semibold">🤖 Using Sentinel</p>
                        <motion.p className="text-xl font-extrabold text-nba-green mt-0.5"
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
                          +$2,847
                        </motion.p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-nba-green/10 text-nba-green border border-nba-green/15">
                        +142% ROI
                      </span>
                    </div>
                    <svg viewBox="0 0 360 80" className="w-full h-16" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="greenFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(158 64% 52%)" stopOpacity="0.12" />
                          <stop offset="100%" stopColor="hsl(158 64% 52%)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <motion.polygon
                        points="0,72 30,65 60,62 90,54 120,48 150,38 180,32 210,26 240,18 270,12 300,8 330,5 360,2 360,80 0,80"
                        fill="url(#greenFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }} />
                      <motion.polyline
                        points="0,72 30,65 60,62 90,54 120,48 150,38 180,32 210,26 240,18 270,12 300,8 330,5 360,2"
                        fill="none" stroke="hsl(158 64% 52%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
                        transition={{ delay: 0.55, duration: 1.2, ease: "easeOut" }} />
                    </svg>
                    <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1 font-medium tracking-wider uppercase">
                      <span>Week 1</span><span>Week 12</span>
                    </div>
                  </motion.div>
                </div>

                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}
                  className="text-[10px] text-muted-foreground/55 mt-4">Hypothetical · Based on +EV strategy</motion.p>
              </motion.div>
            )}

            {/* ─── REFERRAL ─── */}
            {current === "referral" && (
              <motion.div key="referral" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={pageTransition}>
                <Header emoji="👋" title="Where'd you find us?" sub="Help us understand where our community grows" />
                <div className="space-y-1.5">
                  {REFERRALS.map((r, i) => (
                    <Tile key={r.label} emoji={'emoji' in r ? r.emoji : undefined} sportLogo={'icon' in r ? r.icon : undefined} label={r.label} selected={referral === r.label}
                      onClick={() => setReferral(r.label)} idx={i} />
                  ))}
                  {referral === "Other" && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} transition={{ duration: 0.2 }}>
                      <input
                        type="text"
                        value={otherReferralText}
                        onChange={(e) => setOtherReferralText(e.target.value)}
                        placeholder="Tell us where..."
                        maxLength={100}
                        autoFocus
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card/80 border border-primary/40 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ─── SPORTS (with SVG logos) ─── */}
            {current === "sports" && (
              <motion.div key="sports" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={pageTransition}>
                <Header emoji="🎯" title="What do you bet on?" sub="Select all that apply — we'll personalize your feed" />
                <div className="grid grid-cols-2 gap-2">
                  {SPORTS.map((s, i) => (
                    <Tile key={s.label} label={s.label} selected={sports.includes(s.label)}
                      onClick={() => toggleSport(s.label)} idx={i}
                      sportLogoSrc={s.logoSrc} />
                  ))}
                </div>

                {/* Other sport input */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, ...pageTransition }}
                  className="mt-3"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customSport}
                      onChange={(e) => setCustomSport(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customSport.trim()) {
                          toggleSport(customSport.trim());
                          setCustomSport("");
                        }
                      }}
                      placeholder="Other sport (e.g. Horse Racing)"
                      className="flex-1 px-4 py-3 rounded-xl bg-card/60 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/65 focus:outline-none focus:border-primary/40 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (customSport.trim()) {
                          toggleSport(customSport.trim());
                          setCustomSport("");
                        }
                      }}
                      className="px-4 py-3 rounded-xl bg-primary/15 border border-primary/25 text-primary text-sm font-bold hover:bg-primary/25 transition-colors"
                    >
                      Add
                    </button>
                  </div>

                  {/* Show custom-added sports as removable chips */}
                  {sports.filter(s => !SPORTS.some(sp => sp.label === s)).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {sports.filter(s => !SPORTS.some(sp => sp.label === s)).map(s => (
                        <motion.button
                          key={s}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          type="button"
                          onClick={() => toggleSport(s)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/25 text-xs font-semibold text-primary"
                        >
                          🏅 {s} <span className="text-primary/50 ml-0.5">✕</span>
                        </motion.button>
                      ))}
                    </div>
                  )}
                </motion.div>

                <AnimatePresence>
                  {sports.length > 0 && (
                    <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="text-center text-xs font-semibold text-nba-green mt-5">
                      {sports.length} sport{sports.length > 1 ? "s" : ""} selected
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ─── WHAT ARE PROPS (Beginner-friendly) ─── */}
            {current === "what-are-props" && (() => {
              const PROP_EXAMPLES: Record<string, { name: string; pos: string; img: string; initials: string; stat: string; line: number; overDesc: string; underDesc: string; accentHsl: string }> = {
                NBA: { name: "Luka Dončić", pos: "PG · Lakers", img: "https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/3945274.png&w=350&h=254", initials: "LD", stat: "Points", line: 32.5, overDesc: "He scores 33+", underDesc: "He scores 32 or less", accentHsl: "250 76% 62%" },
                MLB: { name: "Shohei Ohtani", pos: "DH · Dodgers", img: "https://a.espncdn.com/combiner/i?img=/i/headshots/mlb/players/full/39832.png&w=350&h=254", initials: "SO", stat: "Strikeouts", line: 7.5, overDesc: "He gets 8+", underDesc: "He gets 7 or less", accentHsl: "0 72% 50%" },
                NHL: { name: "Connor McDavid", pos: "C · Oilers", img: "https://a.espncdn.com/combiner/i?img=/i/headshots/nhl/players/full/3895074.png&w=350&h=254", initials: "CM", stat: "Points", line: 1.5, overDesc: "He gets 2+", underDesc: "He gets 1 or less", accentHsl: "210 100% 55%" },
                NFL: { name: "Patrick Mahomes", pos: "QB · Chiefs", img: "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/3139477.png&w=350&h=254", initials: "PM", stat: "Pass Yards", line: 274.5, overDesc: "He throws 275+", underDesc: "He throws 274 or less", accentHsl: "145 60% 42%" },
                UFC: { name: "Islam Makhachev", pos: "LW Champion", img: "https://a.espncdn.com/i/headshots/mma/players/full/2563592.png", initials: "IM", stat: "Round", line: 2.5, overDesc: "Fight goes 3+ rounds", underDesc: "Fight ends in 2 or less", accentHsl: "38 90% 50%" },
                Soccer: { name: "Lionel Messi", pos: "CF · Inter Miami", img: "https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/45843.png&w=350&h=254", initials: "LM", stat: "Shots on Target", line: 2.5, overDesc: "He takes 3+", underDesc: "He takes 2 or less", accentHsl: "145 60% 42%" },
              };
              const selectedSport = sports[0] || "NBA";
              const ex = PROP_EXAMPLES[selectedSport] || PROP_EXAMPLES.NBA;
              
              return (
              <motion.div key="props" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={pageTransition}>
                <div className="text-center mb-6">
                  <motion.span initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 mb-4">
                    <Sparkles className="w-3 h-3" /> Props 101
                  </motion.span>
                  <h2 className="text-2xl font-extrabold text-foreground tracking-tight">What's a Prop?</h2>
                  <p className="text-sm text-muted-foreground/50 mt-2 max-w-[280px] mx-auto leading-relaxed">
                    Instead of picking who wins, you predict a player's stats
                  </p>
                </div>

                <motion.div className="rounded-2xl overflow-hidden bg-card border border-border/40 mb-4"
                  style={{ boxShadow: "0 16px 48px hsla(228,40%,4%,0.5)" }}
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, ...pageTransition }}>
                  <div className="flex items-center gap-3.5 p-5 pb-3">
                    <div className="relative">
                      <div className="absolute -inset-1.5 rounded-full opacity-50 blur-lg"
                        style={{ background: `linear-gradient(135deg, hsl(${ex.accentHsl}), hsl(${ex.accentHsl} / 0.4))` }} />
                      {!headErr ? (
                        <img src={ex.img} alt={ex.name}
                          className="w-16 h-16 rounded-full object-cover object-top relative border-2"
                          style={{ borderColor: `hsl(${ex.accentHsl} / 0.4)`, boxShadow: `0 4px 20px hsl(${ex.accentHsl} / 0.25)` }}
                          onError={() => setHeadErr(true)}
                          loading="lazy" />
                      ) : (
                        <div className="w-16 h-16 rounded-full relative flex items-center justify-center border-2"
                          style={{ borderColor: `hsl(${ex.accentHsl} / 0.4)`, background: `linear-gradient(135deg, hsl(${ex.accentHsl} / 0.2), hsl(${ex.accentHsl} / 0.05))` }}>
                          <span className="text-lg font-black text-muted-foreground/60">{ex.initials}</span>
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-foreground">{ex.name}</h3>
                      <p className="text-xs text-muted-foreground/65 font-medium">{ex.pos}</p>
                    </div>
                  </div>
                  <div className="px-5 pb-5 space-y-2">
                    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25, ...pageTransition }}
                      className="flex items-center gap-3 p-3 rounded-xl border bg-nba-green/[0.05] border-nba-green/15">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-nba-green/10">
                        <TrendingUp className="w-4 h-4 text-nba-green" />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-bold text-nba-green">OVER {ex.line}</span>
                        <span className="text-xs text-muted-foreground/55 ml-1.5">{ex.stat}</span>
                      </div>
                      <span className="text-[10px] text-nba-green/60 font-medium">{ex.overDesc}</span>
                    </motion.div>
                    <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.35, ...pageTransition }}
                      className="flex items-center gap-3 p-3 rounded-xl border bg-destructive/[0.04] border-destructive/10">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-destructive/10">
                        <TrendingDown className="w-4 h-4 text-destructive" />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-bold text-destructive">UNDER {ex.line}</span>
                        <span className="text-xs text-muted-foreground/55 ml-1.5">{ex.stat}</span>
                      </div>
                      <span className="text-[10px] text-destructive/60 font-medium">{ex.underDesc}</span>
                    </motion.div>
                  </div>
                </motion.div>

                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                  className="text-center text-[11px] text-muted-foreground/55">
                  That's it! Now let's show you the tools that give you the edge
                </motion.p>
              </motion.div>
              );
            })()}



            {/* ─── HOW IT WORKS — Realistic App Preview ─── */}
            {current === "how-it-works" && (() => {
              const sportPreviewData: Record<string, {
                name: string; team: string; img: string; initials: string;
                prop: string; line: number; confidence: number; verdict: string;
                season: string; l10: string; l5: string; vsOpp: string; oppLabel: string;
                hitSeason: number; hitL10: number; hitL5: number; hitVsOpp: number;
                hitSeasonFrac: string; hitL10Frac: string; hitL5Frac: string; hitVsOppFrac: string;
                bars: { h: number; hit: boolean }[];
                books: { emoji: string; name: string; line: string; odds: string; best: boolean }[];
                analysis: { icon: React.ReactNode; color: string; title: string; text: string }[];
                verdictText: string; sportLabel: string;
              }> = {
                NBA: {
                  name: "Nikola Jokić", team: "DEN · #15 · C",
                  img: "https://a.espncdn.com/combiner/i?img=/i/headshots/nba/players/full/3112335.png&w=350&h=254",
                  initials: "NJ", prop: "Rebounds", line: 10.5, confidence: 72, verdict: "Strong Pick",
                  season: "12.4", l10: "13.1", l5: "14.2", vsOpp: "13.8", oppLabel: "vs LAL",
                  hitSeason: 72, hitL10: 80, hitL5: 80, hitVsOpp: 83,
                  hitSeasonFrac: "36/50", hitL10Frac: "8/10", hitL5Frac: "4/5", hitVsOppFrac: "5/6",
                  bars: [
                    { h: 48, hit: true }, { h: 32, hit: false }, { h: 52, hit: true }, { h: 44, hit: true },
                    { h: 28, hit: false }, { h: 50, hit: true }, { h: 55, hit: true }, { h: 46, hit: true },
                    { h: 42, hit: true }, { h: 54, hit: true }, { h: 40, hit: true }, { h: 36, hit: false },
                  ],
                  books: [
                    { emoji: "👑", name: "DraftKings", line: "10.5", odds: "-110", best: true },
                    { emoji: "🎯", name: "FanDuel", line: "10.5", odds: "-118", best: false },
                    { emoji: "🦁", name: "BetMGM", line: "10.5", odds: "-125", best: false },
                    { emoji: "📺", name: "ESPN BET", line: "11.5", odds: "+100", best: false },
                  ],
                  analysis: [
                    { icon: <BarChart3 className="w-3 h-3" />, color: "text-nba-blue", title: "Statistical Edge",
                      text: "Jokić averages 12.4 rebounds, clearing 10.5 in 72% of games. L5 avg of 14.2 shows strong upward trend." },
                    { icon: <Swords className="w-3 h-3" />, color: "text-nba-green", title: "Matchup Breakdown",
                      text: "LAL ranks 28th in defensive rebounding rate. Jokić has cleared this line in 5 of his last 6 vs LAL, averaging 13.8 boards." },
                    { icon: <AlertTriangle className="w-3 h-3" />, color: "text-nba-yellow", title: "Injury & Roster Impact",
                      text: "Aaron Gordon (OUT) — without Gordon, Jokić averages +2.3 rebounds per game. Expanded role expected tonight." },
                  ],
                  verdictText: "Strong play. Jokić OVER 10.5 Rebounds checks all the boxes. Season hit rate at 72%. Recommended: 1.5–2 units.",
                  sportLabel: "NBA",
                },
                MLB: {
                  name: "Shohei Ohtani", team: "LAD · #17 · DH",
                  img: "https://a.espncdn.com/combiner/i?img=/i/headshots/mlb/players/full/39832.png&w=350&h=254",
                  initials: "SO", prop: "Total Bases", line: 1.5, confidence: 68, verdict: "Strong Pick",
                  season: "2.1", l10: "2.4", l5: "2.8", vsOpp: "2.3", oppLabel: "vs NYM",
                  hitSeason: 65, hitL10: 70, hitL5: 80, hitVsOpp: 75,
                  hitSeasonFrac: "52/80", hitL10Frac: "7/10", hitL5Frac: "4/5", hitVsOppFrac: "6/8",
                  bars: [
                    { h: 40, hit: true }, { h: 20, hit: false }, { h: 48, hit: true }, { h: 35, hit: true },
                    { h: 18, hit: false }, { h: 52, hit: true }, { h: 45, hit: true }, { h: 30, hit: false },
                    { h: 55, hit: true }, { h: 50, hit: true }, { h: 42, hit: true }, { h: 38, hit: true },
                  ],
                  books: [
                    { emoji: "👑", name: "DraftKings", line: "1.5", odds: "-135", best: true },
                    { emoji: "🎯", name: "FanDuel", line: "1.5", odds: "-145", best: false },
                    { emoji: "🦁", name: "BetMGM", line: "1.5", odds: "-150", best: false },
                    { emoji: "📺", name: "ESPN BET", line: "1.5", odds: "-140", best: false },
                  ],
                  analysis: [
                    { icon: <BarChart3 className="w-3 h-3" />, color: "text-nba-blue", title: "Statistical Edge",
                      text: "Ohtani averages 2.1 total bases per game, clearing 1.5 in 65% of starts. L5 avg of 2.8 shows a hot streak." },
                    { icon: <Swords className="w-3 h-3" />, color: "text-nba-green", title: "Matchup Breakdown",
                      text: "NYM starter has a 4.82 ERA and 1.45 WHIP. Ohtani is 6-for-8 with 2 HR in his last 2 games vs this pitcher." },
                    { icon: <AlertTriangle className="w-3 h-3" />, color: "text-nba-yellow", title: "Injury & Roster Impact",
                      text: "Full lineup healthy. Ohtani batting 3rd in a stacked order — high RBI and AB opportunities tonight." },
                  ],
                  verdictText: "Strong play. Ohtani OVER 1.5 Total Bases checks all the boxes. Season hit rate at 65%. Recommended: 1–1.5 units.",
                  sportLabel: "MLB",
                },
                UFC: {
                  name: "Islam Makhachev", team: "LW Champion",
                  img: "https://a.espncdn.com/i/headshots/mma/players/full/2563592.png",
                  initials: "IM", prop: "Fight Rounds", line: 2.5, confidence: 74, verdict: "Strong Pick",
                  season: "3.8", l10: "3.4", l5: "3.2", vsOpp: "4.0", oppLabel: "vs Poirier",
                  hitSeason: 71, hitL10: 75, hitL5: 80, hitVsOpp: 80,
                  hitSeasonFrac: "5/7", hitL10Frac: "3/4", hitL5Frac: "4/5", hitVsOppFrac: "4/5",
                  bars: [
                    { h: 55, hit: true }, { h: 50, hit: true }, { h: 28, hit: false }, { h: 52, hit: true },
                    { h: 48, hit: true }, { h: 55, hit: true }, { h: 30, hit: false }, { h: 54, hit: true },
                    { h: 46, hit: true }, { h: 52, hit: true }, { h: 50, hit: true }, { h: 44, hit: true },
                  ],
                  books: [
                    { emoji: "👑", name: "DraftKings", line: "2.5", odds: "-130", best: true },
                    { emoji: "🎯", name: "FanDuel", line: "2.5", odds: "-140", best: false },
                    { emoji: "🦁", name: "BetMGM", line: "2.5", odds: "-145", best: false },
                    { emoji: "📺", name: "ESPN BET", line: "2.5", odds: "-125", best: false },
                  ],
                  analysis: [
                    { icon: <BarChart3 className="w-3 h-3" />, color: "text-nba-blue", title: "Statistical Edge",
                      text: "Makhachev's fights average 3.8 rounds. 71% of his bouts go past 2.5 rounds — he controls pace methodically." },
                    { icon: <Swords className="w-3 h-3" />, color: "text-nba-green", title: "Matchup Breakdown",
                      text: "Poirier has excellent takedown defense (76%). This likely stays on the feet longer, pushing rounds higher." },
                    { icon: <AlertTriangle className="w-3 h-3" />, color: "text-nba-yellow", title: "Injury & Roster Impact",
                      text: "Both fighters in full camp with no reported injuries. Championship rounds expected in this 5-round main event." },
                  ],
                  verdictText: "Strong play. OVER 2.5 Rounds checks all the boxes. Season hit rate at 71%. Recommended: 1.5–2 units.",
                  sportLabel: "UFC",
                },
                NFL: {
                  name: "Patrick Mahomes", team: "KC · #15 · QB",
                  img: "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/3139477.png&w=350&h=254",
                  initials: "PM", prop: "Pass Yards", line: 274.5, confidence: 70, verdict: "Strong Pick",
                  season: "285.3", l10: "292.1", l5: "301.4", vsOpp: "310.2", oppLabel: "vs BUF",
                  hitSeason: 68, hitL10: 75, hitL5: 80, hitVsOpp: 83,
                  hitSeasonFrac: "11/16", hitL10Frac: "6/8", hitL5Frac: "4/5", hitVsOppFrac: "5/6",
                  bars: [
                    { h: 50, hit: true }, { h: 35, hit: false }, { h: 48, hit: true }, { h: 55, hit: true },
                    { h: 30, hit: false }, { h: 52, hit: true }, { h: 58, hit: true }, { h: 44, hit: true },
                    { h: 56, hit: true }, { h: 42, hit: true }, { h: 46, hit: true }, { h: 38, hit: false },
                  ],
                  books: [
                    { emoji: "👑", name: "DraftKings", line: "274.5", odds: "-115", best: true },
                    { emoji: "🎯", name: "FanDuel", line: "274.5", odds: "-120", best: false },
                    { emoji: "🦁", name: "BetMGM", line: "274.5", odds: "-125", best: false },
                    { emoji: "📺", name: "ESPN BET", line: "279.5", odds: "+100", best: false },
                  ],
                  analysis: [
                    { icon: <BarChart3 className="w-3 h-3" />, color: "text-nba-blue", title: "Statistical Edge",
                      text: "Mahomes averages 285.3 pass yards, clearing 274.5 in 68% of games. L5 avg of 301.4 shows an upward trend." },
                    { icon: <Swords className="w-3 h-3" />, color: "text-nba-green", title: "Matchup Breakdown",
                      text: "BUF allows 248.6 pass yards per game but Mahomes has thrown for 310+ in 5 of 6 career matchups vs them." },
                    { icon: <AlertTriangle className="w-3 h-3" />, color: "text-nba-yellow", title: "Injury & Roster Impact",
                      text: "Travis Kelce (active) and Rashee Rice (active) — full weapons. Game script favors a shootout at 52.5 total." },
                  ],
                  verdictText: "Strong play. Mahomes OVER 274.5 Pass Yards checks all the boxes. Season hit rate at 68%. Recommended: 1–1.5 units.",
                  sportLabel: "NFL",
                },
                NHL: {
                  name: "Connor McDavid", team: "EDM · #97 · C",
                  img: "https://a.espncdn.com/combiner/i?img=/i/headshots/nhl/players/full/3895074.png&w=350&h=254",
                  initials: "CM", prop: "Points", line: 0.5, confidence: 76, verdict: "Strong Pick",
                  season: "1.4", l10: "1.6", l5: "1.8", vsOpp: "1.7", oppLabel: "vs VAN",
                  hitSeason: 78, hitL10: 85, hitL5: 90, hitVsOpp: 83,
                  hitSeasonFrac: "64/82", hitL10Frac: "8/10", hitL5Frac: "4/5", hitVsOppFrac: "5/6",
                  bars: [
                    { h: 50, hit: true }, { h: 45, hit: true }, { h: 52, hit: true }, { h: 20, hit: false },
                    { h: 55, hit: true }, { h: 48, hit: true }, { h: 54, hit: true }, { h: 22, hit: false },
                    { h: 56, hit: true }, { h: 50, hit: true }, { h: 46, hit: true }, { h: 52, hit: true },
                  ],
                  books: [
                    { emoji: "👑", name: "DraftKings", line: "0.5", odds: "-175", best: true },
                    { emoji: "🎯", name: "FanDuel", line: "0.5", odds: "-185", best: false },
                    { emoji: "🦁", name: "BetMGM", line: "0.5", odds: "-190", best: false },
                    { emoji: "📺", name: "ESPN BET", line: "0.5", odds: "-170", best: false },
                  ],
                  analysis: [
                    { icon: <BarChart3 className="w-3 h-3" />, color: "text-nba-blue", title: "Statistical Edge",
                      text: "McDavid averages 1.4 points per game, recording a point in 78% of games. L5 avg of 1.8 is elite." },
                    { icon: <Swords className="w-3 h-3" />, color: "text-nba-green", title: "Matchup Breakdown",
                      text: "VAN allows 3.4 goals per game (25th). McDavid has recorded a point in 5 of 6 career games vs VAN." },
                    { icon: <AlertTriangle className="w-3 h-3" />, color: "text-nba-yellow", title: "Injury & Roster Impact",
                      text: "Draisaitl (active) on the top line. Full power play unit intact — 28.4% PP conversion rate this season." },
                  ],
                  verdictText: "Strong play. McDavid OVER 0.5 Points checks all the boxes. Season hit rate at 78%. Recommended: 1.5–2 units.",
                  sportLabel: "NHL",
                },
                Soccer: {
                  name: "Lionel Messi", team: "Inter Miami · #10",
                  img: "https://a.espncdn.com/combiner/i?img=/i/headshots/soccer/players/full/45843.png&w=350&h=254",
                  initials: "LM", prop: "Shots on Target", line: 1.5, confidence: 71, verdict: "Strong Pick",
                  season: "2.3", l10: "2.5", l5: "2.8", vsOpp: "2.7", oppLabel: "vs ATL",
                  hitSeason: 70, hitL10: 78, hitL5: 80, hitVsOpp: 75,
                  hitSeasonFrac: "21/30", hitL10Frac: "7/9", hitL5Frac: "4/5", hitVsOppFrac: "3/4",
                  bars: [
                    { h: 45, hit: true }, { h: 50, hit: true }, { h: 30, hit: false }, { h: 48, hit: true },
                    { h: 52, hit: true }, { h: 25, hit: false }, { h: 55, hit: true }, { h: 44, hit: true },
                    { h: 50, hit: true }, { h: 46, hit: true }, { h: 42, hit: true }, { h: 28, hit: false },
                  ],
                  books: [
                    { emoji: "👑", name: "DraftKings", line: "1.5", odds: "-120", best: true },
                    { emoji: "🎯", name: "FanDuel", line: "1.5", odds: "-130", best: false },
                    { emoji: "🦁", name: "BetMGM", line: "1.5", odds: "-135", best: false },
                    { emoji: "📺", name: "ESPN BET", line: "1.5", odds: "-115", best: false },
                  ],
                  analysis: [
                    { icon: <BarChart3 className="w-3 h-3" />, color: "text-nba-blue", title: "Statistical Edge",
                      text: "Messi averages 2.3 shots on target per game, clearing 1.5 in 70% of matches. L5 avg of 2.8 is trending up." },
                    { icon: <Swords className="w-3 h-3" />, color: "text-nba-green", title: "Matchup Breakdown",
                      text: "ATL concedes 5.2 shots on target per game (24th in MLS). Messi historically thrives against weaker backlines." },
                    { icon: <AlertTriangle className="w-3 h-3" />, color: "text-nba-yellow", title: "Injury & Roster Impact",
                      text: "Messi fully fit and starting. Busquets (active) in midfield — expect more creative service into the box." },
                  ],
                  verdictText: "Strong play. Messi OVER 1.5 Shots on Target checks all the boxes. Season hit rate at 70%. Recommended: 1–1.5 units.",
                  sportLabel: "Soccer",
                },
              };

              const selectedSport = sports[0] || "NBA";
              const d = sportPreviewData[selectedSport] || sportPreviewData["NBA"];

              return (
              <motion.div key="how" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={pageTransition}>
                {/* Header with more visual weight */}
                <div className="text-center mb-6">
                  <motion.span initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-primary/10 text-primary border border-primary/20 mb-3">
                    <Zap className="w-3 h-3" /> Full Breakdown
                  </motion.span>
                  <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                    className="text-[28px] font-black text-foreground tracking-tight leading-tight">What You Get</motion.h2>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
                    className="text-sm text-muted-foreground/50 mt-2 max-w-[280px] mx-auto leading-relaxed">
                    Every play comes with a complete analysis — here's a real preview
                  </motion.p>
                </div>

                {/* App preview container */}
                <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.15, ...pageTransition }}
                  className="rounded-[20px] overflow-hidden relative"
                  style={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border) / 0.6)",
                    boxShadow: "0 24px 80px hsla(228,40%,4%,0.8), 0 0 0 1px hsl(var(--border) / 0.2), inset 0 1px 0 hsl(var(--border) / 0.15)",
                  }}>

                  {/* Top bar */}
                  <div className="px-4 py-2.5 flex items-center justify-between"
                    style={{ background: "hsl(var(--card) / 0.8)", borderBottom: "1px solid hsl(var(--border) / 0.4)" }}>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-pulse" />
                      <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest">Props Analyzer</span>
                    </div>
                    <span className="text-[8px] text-muted-foreground/40 font-medium">{d.sportLabel}</span>
                  </div>

                  <div className="p-4 space-y-3">
                    {/* Player + Verdict row */}
                    <div className="flex gap-3">
                      <div className="flex-1 rounded-xl p-3 flex items-center gap-2.5"
                        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.5)" }}>
                        <div className="relative">
                          <div className="absolute -inset-0.5 rounded-full opacity-30 blur-sm"
                            style={{ background: "hsl(var(--primary))" }} />
                          <img src={d.img} alt={d.name}
                            className="w-10 h-10 rounded-full object-cover object-top relative border"
                            style={{ borderColor: "hsl(var(--primary) / 0.3)" }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} loading="lazy" />
                        </div>
                        <div>
                          <p className="text-[12px] font-bold text-foreground">{d.name}</p>
                          <p className="text-[9px] text-primary font-semibold">{d.team}</p>
                        </div>
                      </div>

                      <motion.div className="rounded-xl p-3 flex flex-col items-center justify-center min-w-[90px]"
                        style={{
                          background: "hsl(var(--card))",
                          border: "2px solid hsl(var(--nba-green))",
                          boxShadow: "0 0 24px hsl(var(--nba-green) / 0.2)",
                        }}
                        initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.3, type: "spring", stiffness: 200 }}>
                        <motion.p className="text-[24px] font-black text-nba-green leading-none"
                          initial={{ scale: 0.5 }} animate={{ scale: 1 }}
                          transition={{ delay: 0.4, type: "spring", stiffness: 300 }}>{d.confidence}%</motion.p>
                        <p className="text-[7px] font-black text-nba-green uppercase tracking-[0.2em] mt-1">{d.verdict}</p>
                        <p className="text-[8px] text-muted-foreground/50 mt-0.5">Over {d.line} {d.prop}</p>
                      </motion.div>
                    </div>

                    {/* Stat averages */}
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { label: "Season", val: d.season },
                        { label: "L10", val: d.l10 },
                        { label: "L5", val: d.l5 },
                        { label: d.oppLabel, val: d.vsOpp },
                      ].map((s, i) => (
                        <motion.div key={s.label}
                          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.35 + i * 0.05 }}
                          className="rounded-lg p-2 text-center"
                          style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.4)" }}>
                          <p className="text-[7px] text-muted-foreground/50 uppercase tracking-wider font-semibold">{s.label}</p>
                          <p className="text-[14px] font-extrabold text-primary tabular-nums mt-0.5">{s.val}</p>
                        </motion.div>
                      ))}
                    </div>

                    {/* Game log chart */}
                    <motion.div className="rounded-xl p-3"
                      style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.4)" }}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
                      <p className="text-[8px] text-muted-foreground/50 uppercase tracking-widest font-bold mb-2">Game Log</p>
                      <svg viewBox="0 0 300 60" className="w-full h-12">
                        <line x1="0" y1="38" x2="300" y2="38" stroke="hsl(0 0% 100% / 0.15)" strokeWidth="1" strokeDasharray="4 3" />
                        <text x="292" y="36" fill="hsl(0 0% 100% / 0.25)" fontSize="5" textAnchor="end">{d.line}</text>
                        {d.bars.map((bar, i) => (
                          <motion.rect key={i} x={10 + i * 25} y={60 - bar.h} width="16" height={bar.h} rx="3"
                            fill={bar.hit ? "hsl(158 64% 52% / 0.75)" : "hsl(0 72% 51% / 0.5)"}
                            initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
                            style={{ transformOrigin: "bottom" }}
                            transition={{ delay: 0.55 + i * 0.03, duration: 0.3 }} />
                        ))}
                      </svg>
                    </motion.div>

                    {/* Hit rates */}
                    <motion.div className="rounded-xl p-3"
                      style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.4)" }}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
                      <p className="text-[8px] text-muted-foreground/50 uppercase tracking-widest font-bold mb-2.5">Hit Rates</p>
                      <div className="space-y-2">
                        {[
                          { label: "Season", pct: d.hitSeason },
                          { label: "Last 10", pct: d.hitL10 },
                          { label: "Last 5", pct: d.hitL5 },
                          { label: d.oppLabel, pct: d.hitVsOpp },
                        ].map((hr, i) => (
                          <div key={hr.label} className="flex items-center gap-2.5">
                            <span className="text-[9px] text-muted-foreground/60 font-semibold w-12 shrink-0">{hr.label}</span>
                            <div className="flex-1 h-[6px] rounded-full overflow-hidden" style={{ background: "hsl(var(--border) / 0.3)" }}>
                              <motion.div className="h-full rounded-full"
                                style={{ background: hr.pct >= 65 ? "hsl(var(--nba-green))" : hr.pct >= 50 ? "hsl(var(--nba-blue))" : "hsl(var(--nba-yellow))" }}
                                initial={{ width: 0 }} animate={{ width: `${hr.pct}%` }}
                                transition={{ delay: 0.75 + i * 0.08, duration: 0.6 }} />
                            </div>
                            <span className="text-[9px] font-bold text-nba-green tabular-nums w-10 text-right">{hr.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>

                    {/* Line shopping */}
                    <motion.div className="rounded-xl p-3"
                      style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border) / 0.4)" }}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <Trophy className="w-3 h-3 text-primary" />
                          <span className="text-[8px] text-muted-foreground/50 uppercase tracking-widest font-bold">Line Shopping</span>
                        </div>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                          style={{ background: "hsl(var(--nba-green) / 0.08)", border: "1px solid hsl(var(--nba-green) / 0.15)" }}>
                          <div className="w-1 h-1 rounded-full bg-nba-green animate-pulse" />
                          <span className="text-[6px] font-bold text-nba-green uppercase">Live</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {d.books.map((b, i) => (
                          <motion.div key={b.name}
                            initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.95 + i * 0.04 }}
                            className="grid grid-cols-[1fr_40px_40px] items-center py-1.5 px-2 rounded-lg"
                            style={{
                              background: b.best ? "hsl(var(--primary) / 0.06)" : "transparent",
                              border: b.best ? "1px solid hsl(var(--primary) / 0.12)" : "1px solid transparent",
                            }}>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px]">{b.emoji}</span>
                              <span className={`text-[10px] font-semibold ${b.best ? "text-foreground" : "text-foreground/60"}`}>{b.name}</span>
                            </div>
                            <span className="text-[10px] font-bold text-foreground/50 text-center tabular-nums">{b.line}</span>
                            <div className="text-right">
                              <span className={`text-[10px] font-extrabold tabular-nums ${b.best ? "text-nba-green" : "text-foreground/50"}`}>{b.odds}</span>
                              {b.best && (
                                <div className="flex items-center justify-end gap-0.5">
                                  <TrendingUp className="w-2 h-2 text-nba-green" />
                                  <span className="text-[5px] font-bold text-nba-green uppercase">Best</span>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))}

                    {/* In-Depth Analysis */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1.1, type: "spring", stiffness: 200 }}
                      className="rounded-xl border border-nba-green/30 overflow-hidden"
                      style={{ background: "hsla(228, 20%, 6%, 0.7)", backdropFilter: "blur(20px)" }}>
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/10"
                        style={{ background: "linear-gradient(to right, hsl(var(--primary) / 0.08), transparent)" }}>
                        <div className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center">
                          <FileText className="w-3 h-3 text-accent" />
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-accent">In-Depth Analysis</span>
                      </div>
                      <div className="p-3 space-y-2.5">
                        {d.analysis.map((s, i) => (
                          <motion.div key={s.title}
                            initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 1.15 + i * 0.06 }}
                            className="flex items-start gap-2">
                            <div className="flex flex-col items-center shrink-0 pt-0.5">
                              <div className={`w-5 h-5 rounded-md bg-card/80 border border-border/20 flex items-center justify-center ${s.color}`}>
                                {s.icon}
                              </div>
                              {i < 2 && <div className="w-px h-full min-h-[6px] bg-border/10 mt-0.5" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className={`text-[8px] font-bold uppercase tracking-[0.1em] mb-0.5 ${s.color}`}>{s.title}</h4>
                              <p className="text-[9px] leading-[1.4] text-foreground/60">{s.text}</p>
                            </div>
                          </motion.div>
                        ))}

                        {/* Verdict */}
                        <motion.div
                          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 1.35 }}
                          className="rounded-lg p-2.5 mt-1"
                          style={{
                            background: "linear-gradient(135deg, hsla(158, 64%, 52%, 0.08), hsla(158, 64%, 52%, 0.02))",
                            border: "1px solid hsla(158, 64%, 52%, 0.2)",
                          }}>
                          <div className="flex items-center gap-1.5 mb-1">
                            <CheckCircle className="w-3.5 h-3.5 text-nba-green" />
                            <span className="text-[9px] font-extrabold uppercase tracking-wider text-nba-green">✅ Take This Pick</span>
                          </div>
                          <p className="text-[8px] leading-[1.4] text-foreground/60">{d.verdictText}</p>
                        </motion.div>

                        <div className="flex items-center justify-between pt-1.5 border-t border-border/10">
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-nba-green animate-pulse" />
                            <span className="text-[7px] font-bold uppercase tracking-widest text-muted-foreground/50">AI Confidence: {d.confidence + 6}%</span>
                          </div>
                          <span className="text-[6px] font-medium uppercase tracking-wider text-muted-foreground/40">Powered by Sentinel AI</span>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
                  </div>
                </motion.div>
                {/* Bottom tagline */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
                  className="text-center mt-4 flex items-center justify-center gap-3">
                  <div className="h-[1px] flex-1 max-w-[50px]" style={{ background: "linear-gradient(90deg, transparent, hsl(var(--primary) / 0.2))" }} />
                  <p className="text-[11px] font-bold text-foreground/60 tracking-wide">
                    This is what you get. <span className="text-nba-green font-extrabold">Every play.</span>
                  </p>
                  <div className="h-[1px] flex-1 max-w-[50px]" style={{ background: "linear-gradient(90deg, hsl(var(--primary) / 0.2), transparent)" }} />
                </motion.div>
              </motion.div>
              );
            })()}


            {/* ─── STYLE ─── */}
            {current === "style" && (
              <motion.div key="style" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={pageTransition}>
                <Header emoji="🎓" title="What's your experience level?" sub="We'll tailor the experience to your skill" />
                <div className="space-y-2">
                  {STYLES.map((s, i) => (
                    <Tile key={s.label} emoji={s.emoji} label={s.label} sub={s.sub}
                      selected={style === s.label} onClick={() => setStyle(s.label)} idx={i} />
                  ))}
                </div>
              </motion.div>
            )}


          </AnimatePresence>
        </div>
      </div>

      {/* Bottom CTA */}
      <AnimatePresence>
        {!isRevealStep && (
          <motion.div
            initial={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="w-full max-w-md px-6 pb-[max(env(safe-area-inset-bottom,24px),24px)] pt-3 relative z-10"
          >
            <div className="flex items-center gap-3">
              {step > 0 && (
                <motion.button initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  onClick={back}
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-card/60 border border-border/40 hover:border-border/60 transition-colors">
                  <ArrowLeft className="w-4 h-4 text-muted-foreground/60" />
                </motion.button>
              )}
              <motion.button whileTap={{ scale: 0.97 }} onClick={next}
                className="flex-1 h-[52px] rounded-xl text-[15px] font-bold text-primary-foreground flex items-center justify-center gap-2 relative overflow-hidden group"
                style={{
                  background: "linear-gradient(135deg, hsl(var(--primary)), hsl(250 70% 48%))",
                  boxShadow: "0 6px 24px hsla(250,76%,50%,0.25), inset 0 1px 0 hsla(0,0%,100%,0.08)",
                }}>
                <span>{isLast ? "Let's Go" : "Continue"}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </motion.button>
            </div>
            {!isLast && step > 0 && (
              <button onClick={() => { setDir(1); setStep(s => s + 1); }}
                className="w-full text-center text-xs text-muted-foreground/65 hover:text-muted-foreground/60 transition-colors font-medium mt-2 py-1">
                Skip this step
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OnboardingPage;
