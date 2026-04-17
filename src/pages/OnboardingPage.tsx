import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";
import logo from "@/assets/sentinel-lock.jpg";
import logoNba from "@/assets/logo-nba.png";
import logoMlb from "@/assets/logo-mlb.png";
import logoUfc from "@/assets/logo-ufc.png";
import logoNhl from "@/assets/logo-nhl.png";
import OnboardingHero from "@/components/onboarding/OnboardingHero";
import { preloadGeneratedImage } from "@/hooks/useGeneratedImage";

/* ───────── WaveSpeed hero prompts ───────── */
const HERO_PROMPTS: Record<string, { key: string; prompt: string }> = {
  welcome: {
    key: "onboarding-welcome",
    prompt:
      "Cinematic dark stadium at night, glowing purple data overlays and neon analytics graphs floating above the field, predator-hunter mood, ultra-detailed, 4k, moody lighting, premium sports intelligence aesthetic",
  },
  edge: {
    key: "onboarding-edge",
    prompt:
      "Split-screen visualization: chaotic red losing chart on the left vs glowing green ascending profit graph on the right, dark cinematic background, holographic data overlays, sharp focus, premium fintech mood",
  },
  odds: {
    key: "onboarding-odds",
    prompt:
      "Glowing dice and floating odds numbers (-110, +150, 1.91) suspended in dark space, electric purple highlights, premium fintech aesthetic, cinematic lighting",
  },
  sports: {
    key: "onboarding-sports",
    prompt:
      "Dark collage of NBA basketball, MLB baseball, NHL hockey, and UFC octagon — silhouetted athletes mid-action with purple and cyan rim lighting, predator vibe, cinematic 4k",
  },
  experience: {
    key: "onboarding-experience",
    prompt:
      "Lone hooded figure analyzing a massive holographic data wall of sports analytics, dark room, deep purple glow, intense focus, cinematic ultra-detailed",
  },
  value: {
    key: "onboarding-valueproof",
    prompt:
      "Glowing premium player card hovering above a dark surface, surrounded by floating heatmaps, shot charts and stat overlays, mint green confidence indicator, cinematic 4k",
  },
};

/* ───────── Constants ───────── */
const ease = [0.32, 0.72, 0, 1] as const;
const pageTransition = { duration: 0.3, ease };

const haptic = () => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(8); } catch {}
  }
};

const SPORTS = [
  { label: "NBA", emoji: "🏀", logo: logoNba },
  { label: "MLB", emoji: "⚾", logo: logoMlb },
  { label: "UFC", emoji: "🥊", logo: logoUfc },
  { label: "NHL", emoji: "🏒", logo: logoNhl },
];

const STYLES = [
  { label: "Beginner", emoji: "🌱", sub: "New to betting, show me the ropes" },
  { label: "Intermediate", emoji: "📊", sub: "I know the basics, want an edge" },
  { label: "Knowledgeable", emoji: "🧠", sub: "Experienced, I'm data-driven" },
  { label: "Expert", emoji: "🔥", sub: "Sharp bettor, give me raw numbers" },
];

const FEATURE_PILLS = [
  { emoji: "📊", text: "AI Prop Analyzer — NBA, MLB, NHL, UFC" },
  { emoji: "🎯", text: "Daily High-EV Picks" },
  { emoji: "📈", text: "Profit Tracker + Parlay Builder" },
  { emoji: "🔴", text: "Live Game Schedules" },
];

type Screen = "welcome" | "edge" | "odds" | "sports" | "experience" | "value";
const STEPS: Screen[] = ["edge", "odds", "sports", "experience", "value"];
const TOTAL_STEPS = STEPS.length; // 5

/* ───────── Main ───────── */
const OnboardingPage = () => {
  const navigate = useNavigate();
  const [screen, setScreen] = useState<Screen>("welcome");
  const [dir, setDir] = useState(1);

  const [oddsFormat, setOddsFormat] = useState<"american" | "decimal" | null>(null);
  const [sports, setSports] = useState<string[]>([]);
  const [customSport, setCustomSport] = useState("");
  const [extraSports, setExtraSports] = useState<string[]>([]);
  const [style, setStyle] = useState<string | null>(null);

  // Preload paywall + next-screen hero image
  useEffect(() => {
    if (screen === "experience" || screen === "value") {
      import("./PaywallPage").catch(() => {});
    }
    // Preload next screen's hero so it's ready by the time user advances
    const order: Screen[] = ["welcome", "edge", "odds", "sports", "experience", "value"];
    const idx = order.indexOf(screen);
    const next = order[idx + 1];
    if (next && HERO_PROMPTS[next]) {
      preloadGeneratedImage(HERO_PROMPTS[next].prompt, HERO_PROMPTS[next].key);
    }
    // Always make sure current screen's image is preloaded
    if (HERO_PROMPTS[screen]) {
      preloadGeneratedImage(HERO_PROMPTS[screen].prompt, HERO_PROMPTS[screen].key);
    }
  }, [screen]);

  const stepIndex = screen === "welcome" ? -1 : STEPS.indexOf(screen);
  const progress = stepIndex >= 0 ? ((stepIndex + 1) / TOTAL_STEPS) * 100 : 0;

  const saveOnboardingData = useCallback(() => {
    localStorage.setItem("sentinel_onboarding_referral", "Direct");
    localStorage.setItem(
      "sentinel_onboarding_sports",
      JSON.stringify([...sports, ...extraSports])
    );
    localStorage.setItem("sentinel_onboarding_style", style || "");
    localStorage.setItem("sentinel_onboarding_odds_format", oddsFormat || "american");
  }, [sports, extraSports, style, oddsFormat]);

  const goTo = (next: Screen, direction: 1 | -1 = 1) => {
    haptic();
    setDir(direction);
    setScreen(next);
  };

  const goNext = () => {
    const idx = STEPS.indexOf(screen as Screen);
    if (idx < 0) goTo(STEPS[0]);
    else if (idx < STEPS.length - 1) goTo(STEPS[idx + 1]);
    else { saveOnboardingData(); navigate("/paywall", { replace: true }); }
  };

  const goBack = () => {
    if (screen === "welcome") return;
    const idx = STEPS.indexOf(screen);
    if (idx === 0) goTo("welcome", -1);
    else goTo(STEPS[idx - 1], -1);
  };

  const skipAll = () => {
    saveOnboardingData();
    navigate("/paywall", { replace: true });
  };

  const toggleSport = (s: string) => {
    haptic();
    setSports(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  };

  const addCustomSport = () => {
    const t = customSport.trim();
    if (!t) return;
    haptic();
    setExtraSports(p => p.includes(t) ? p : [...p, t]);
    setCustomSport("");
  };

  const slideVariants = {
    enter: (d: number) => ({ opacity: 0, x: d > 0 ? 50 : -50 }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: d > 0 ? -50 : 50 }),
  };

  const showChrome = screen !== "welcome";

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center relative overflow-x-hidden">
      <style>{`
        @keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 32px hsl(var(--primary) / 0.35); } 50% { box-shadow: 0 0 56px hsl(var(--primary) / 0.6); } }
        @keyframes scale-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
        @keyframes draw-line { from { stroke-dashoffset: 400; } to { stroke-dashoffset: 0; } }
        @keyframes bar-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
      `}</style>

      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full opacity-[0.06]"
          style={{ background: "radial-gradient(circle, hsl(var(--primary)), transparent 60%)", filter: "blur(100px)" }} />
      </div>

      {/* Top chrome: progress + back/skip */}
      {showChrome && (
        <div className="w-full max-w-md px-5 pt-[max(env(safe-area-inset-top,16px),16px)] relative z-10">
          {/* Progress bar */}
          <div className="h-1 w-full rounded-full bg-border/30 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--nba-cyan)))" }}
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
          {/* Back + Skip */}
          <div className="flex justify-between items-center mt-3">
            <button onClick={goBack} className="flex items-center gap-1 text-xs text-muted-foreground/70 hover:text-foreground transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <span className="text-[10px] text-muted-foreground/55 uppercase tracking-wider font-medium">
              Step {stepIndex + 1} of {TOTAL_STEPS}
            </span>
            {screen !== "value" ? (
              <button onClick={skipAll} className="text-[11px] text-muted-foreground/55 hover:text-muted-foreground transition-colors">
                Skip all
              </button>
            ) : <span className="w-10" />}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex items-start justify-center w-full px-5 py-6 relative z-10 overflow-y-auto min-h-0">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait" custom={dir}>

            {/* ─── WELCOME ─── */}
            {screen === "welcome" && (
              <motion.div key="welcome" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit"
                transition={pageTransition} className="flex flex-col items-center text-center pt-[max(env(safe-area-inset-top,40px),40px)]">
                <motion.div className="relative mb-6"
                  initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 220, damping: 18 }}>
                  <img src={logo} alt="Sentinel" className="w-20 h-20 rounded-[20px] relative border border-primary/30"
                    style={{ animation: "pulse-glow 2.6s ease-in-out infinite" }} draggable={false} />
                </motion.div>
                <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, ...pageTransition }}
                  className="text-[40px] font-extrabold tracking-tight leading-[1] mb-2">
                  Sentinel
                </motion.h1>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, ...pageTransition }}
                  className="text-[15px] text-muted-foreground max-w-[300px] leading-snug mb-8">
                  The AI edge sharp bettors use to beat the books
                </motion.p>

                {/* Feature pills */}
                <div className="w-full space-y-2.5 mb-8">
                  {FEATURE_PILLS.map((p, i) => (
                    <motion.div
                      key={p.text}
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35 + i * 0.08, ...pageTransition }}
                      className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-card/70 border border-border/50"
                    >
                      <span className="text-xl shrink-0">{p.emoji}</span>
                      <span className="text-sm font-medium text-foreground/90 text-left">{p.text}</span>
                    </motion.div>
                  ))}
                </div>

                <motion.button
                  initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, ...pageTransition }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => goTo("edge")}
                  className="w-full py-4 rounded-xl text-white font-bold text-base relative overflow-hidden"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--primary)), hsl(258, 80%, 58%))",
                    boxShadow: "0 12px 32px hsl(var(--primary) / 0.4)",
                  }}
                >
                  Get Started
                </motion.button>

                <motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }}
                  onClick={() => navigate("/auth")}
                  className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Already have an account? <span className="text-primary font-semibold">Sign in</span>
                </motion.button>
              </motion.div>
            )}

            {/* ─── 1. EDGE / FOMO ─── */}
            {screen === "edge" && (
              <motion.div key="edge" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit"
                transition={pageTransition} className="pt-2">
                <h2 className="text-[28px] font-extrabold tracking-tight leading-[1.1] text-center mb-2">
                  Stop guessing.<br />Start winning.
                </h2>
                <p className="text-sm text-muted-foreground text-center mb-6">Data beats gut feeling — every time.</p>

                <div className="space-y-3 mb-4">
                  {/* Red — Gut */}
                  <div className="rounded-2xl p-4 relative overflow-hidden"
                    style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--destructive) / 0.3)" }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">😬 Going with Your Gut</p>
                        <p className="text-2xl font-extrabold mt-1" style={{ color: "hsl(var(--destructive))" }}>−$1,340</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
                        style={{ background: "hsl(var(--destructive) / 0.12)", color: "hsl(var(--destructive))" }}>
                        −67% ROI
                      </span>
                    </div>
                    <svg viewBox="0 0 360 80" className="w-full h-16" preserveAspectRatio="none">
                      <motion.polyline
                        points="0,12 40,18 80,16 120,28 160,36 200,46 240,54 280,62 320,70 360,78"
                        fill="none" stroke="hsl(var(--destructive))" strokeWidth="2.5" strokeLinecap="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut", delay: 0.2 }}
                      />
                    </svg>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Week 1 → Week 12</p>
                  </div>

                  {/* Green — Sentinel */}
                  <div className="rounded-2xl p-4 relative overflow-hidden"
                    style={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--nba-green) / 0.5)",
                      boxShadow: "0 0 32px hsl(var(--nba-green) / 0.15)",
                    }}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">🤖 Using Sentinel</p>
                        <p className="text-2xl font-extrabold mt-1" style={{ color: "hsl(var(--nba-green))" }}>+$2,847</p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
                        style={{ background: "hsl(var(--nba-green) / 0.12)", color: "hsl(var(--nba-green))" }}>
                        +142% ROI
                      </span>
                    </div>
                    <svg viewBox="0 0 360 80" className="w-full h-16" preserveAspectRatio="none">
                      <motion.polyline
                        points="0,72 40,66 80,58 120,52 160,42 200,36 240,28 280,20 320,14 360,6"
                        fill="none" stroke="hsl(var(--nba-green))" strokeWidth="2.5" strokeLinecap="round"
                        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: "easeOut", delay: 0.3 }}
                      />
                    </svg>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">Week 1 → Week 12</p>
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground/50 text-center mb-5">Hypothetical · Based on +EV strategy</p>

                <button
                  onClick={goNext}
                  className="w-full py-4 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--primary)), hsl(258, 80%, 58%))",
                    boxShadow: "0 10px 28px hsl(var(--primary) / 0.35)",
                  }}
                >
                  Show me the edge <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ─── 2. ODDS FORMAT ─── */}
            {screen === "odds" && (
              <motion.div key="odds" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit"
                transition={pageTransition} className="pt-4">
                <div className="text-center mb-6">
                  <div className="text-4xl mb-3">🎲</div>
                  <h2 className="text-[28px] font-extrabold tracking-tight leading-[1.1]">How do you read odds?</h2>
                  <p className="text-sm text-muted-foreground mt-2">We'll display them your way</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: "american" as const, label: "AMERICAN", val: "−110 / +150", sub: "US sportsbooks" },
                    { id: "decimal" as const, label: "DECIMAL", val: "1.91 / 2.50", sub: "European style" },
                  ].map(o => {
                    const selected = oddsFormat === o.id;
                    return (
                      <motion.button
                        key={o.id}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => {
                          haptic();
                          setOddsFormat(o.id);
                          setTimeout(goNext, 400);
                        }}
                        className={`flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all min-h-[160px] ${
                          selected
                            ? "border-primary bg-primary/10 shadow-[0_0_24px_hsl(var(--primary)/0.3)]"
                            : "border-border/50 bg-card/70 hover:border-primary/40"
                        }`}
                      >
                        <p className="text-[11px] font-bold text-muted-foreground tracking-widest mb-2">{o.label}</p>
                        <p className="text-2xl font-extrabold text-foreground mb-2">{o.val}</p>
                        <p className="text-[11px] text-muted-foreground/70">{o.sub}</p>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ─── 3. SPORTS ─── */}
            {screen === "sports" && (
              <motion.div key="sports" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit"
                transition={pageTransition} className="pt-4">
                <div className="text-center mb-5">
                  <div className="text-4xl mb-3">🎯</div>
                  <h2 className="text-[28px] font-extrabold tracking-tight leading-[1.1]">What do you bet on?</h2>
                  <p className="text-sm text-muted-foreground mt-2">Pick your sports — we'll personalize your feed</p>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  {SPORTS.map((s, i) => {
                    const selected = sports.includes(s.label);
                    return (
                      <motion.button
                        key={s.label}
                        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05, ...pageTransition }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => toggleSport(s.label)}
                        className={`relative flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all min-h-[120px] ${
                          selected
                            ? "border-primary bg-primary/10 shadow-[0_0_24px_hsl(var(--primary)/0.25)]"
                            : "border-border/50 bg-card/70 hover:border-primary/40"
                        }`}
                      >
                        <img src={s.logo} alt={s.label} className="w-12 h-12 object-contain mb-2" />
                        <p className="text-sm font-bold text-foreground">{s.label}</p>
                        <AnimatePresence>
                          {selected && (
                            <motion.div
                              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                              transition={{ type: "spring", stiffness: 500, damping: 20 }}
                              className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                            >
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Custom sport */}
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={customSport}
                    onChange={e => setCustomSport(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addCustomSport()}
                    placeholder="Other sport (e.g. Horse Racing)"
                    className="flex-1 px-3 py-2.5 rounded-xl bg-card/70 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                  />
                  <button
                    onClick={addCustomSport}
                    className="px-4 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors"
                  >
                    Add
                  </button>
                </div>

                {extraSports.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {extraSports.map(es => (
                      <span key={es} className="px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30 text-xs font-semibold text-primary flex items-center gap-1.5">
                        {es}
                        <button onClick={() => setExtraSports(p => p.filter(x => x !== es))} className="text-primary/60 hover:text-primary">×</button>
                      </span>
                    ))}
                  </div>
                )}

                <button
                  onClick={goNext}
                  disabled={sports.length === 0 && extraSports.length === 0}
                  className="w-full py-4 rounded-xl text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--primary)), hsl(258, 80%, 58%))",
                    boxShadow: (sports.length || extraSports.length) ? "0 10px 28px hsl(var(--primary) / 0.35)" : undefined,
                  }}
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ─── 4. EXPERIENCE ─── */}
            {screen === "experience" && (
              <motion.div key="experience" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit"
                transition={pageTransition} className="pt-4">
                <div className="text-center mb-6">
                  <div className="text-4xl mb-3">🎓</div>
                  <h2 className="text-[28px] font-extrabold tracking-tight leading-[1.1]">What's your experience level?</h2>
                  <p className="text-sm text-muted-foreground mt-2">We'll tailor insights to your skill</p>
                </div>

                <div className="space-y-2.5">
                  {STYLES.map((s, i) => {
                    const selected = style === s.label;
                    return (
                      <motion.button
                        key={s.label}
                        initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.06, ...pageTransition }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          haptic();
                          setStyle(s.label);
                          setTimeout(goNext, 400);
                        }}
                        className={`w-full flex items-center gap-3.5 p-4 rounded-2xl border-2 text-left transition-all ${
                          selected
                            ? "border-primary bg-primary/10 shadow-[0_0_24px_hsl(var(--primary)/0.25)]"
                            : "border-border/50 bg-card/70 hover:border-primary/40"
                        }`}
                      >
                        <span className="text-2xl shrink-0">{s.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-foreground">{s.label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{s.sub}</p>
                        </div>
                        {selected && (
                          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          </div>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* ─── 5. VALUE PROOF ─── */}
            {screen === "value" && (
              <motion.div key="value" custom={dir} variants={slideVariants} initial="enter" animate="center" exit="exit"
                transition={pageTransition} className="pt-2">
                <div className="text-center mb-5">
                  <h2 className="text-[26px] font-extrabold tracking-tight leading-[1.15]">Here's what you've been missing</h2>
                  <p className="text-sm text-muted-foreground mt-2">A real Sentinel pick from today</p>
                </div>

                {/* Sample pick card */}
                <div className="rounded-2xl bg-card border border-border/60 p-4 mb-4 relative overflow-hidden">
                  {/* Player header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-full bg-secondary border border-border/50 overflow-hidden shrink-0">
                      <img
                        src="https://a.espncdn.com/i/headshots/nba/players/full/3112335.png"
                        alt="Nikola Jokic"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-foreground">Nikola Jokić</p>
                      <p className="text-[11px] text-muted-foreground">DEN · C</p>
                    </div>
                    <div className="px-2.5 py-1.5 rounded-lg text-[10px] font-black tracking-wide"
                      style={{
                        background: "hsl(var(--nba-green) / 0.18)",
                        color: "hsl(var(--nba-green))",
                        border: "1px solid hsl(var(--nba-green) / 0.4)",
                        boxShadow: "0 0 18px hsl(var(--nba-green) / 0.3)",
                      }}>
                      72% STRONG
                    </div>
                  </div>

                  <div className="px-3 py-2 rounded-xl bg-secondary/50 border border-border/40 mb-3">
                    <p className="text-sm font-bold text-foreground text-center">Over 10.5 Rebounds</p>
                  </div>

                  {/* Stat pills */}
                  <div className="grid grid-cols-4 gap-1.5 mb-3">
                    {[
                      { l: "SEASON", v: "12.4" },
                      { l: "L10", v: "13.1" },
                      { l: "L5", v: "14.2" },
                      { l: "vs LAL", v: "13.8" },
                    ].map(s => (
                      <div key={s.l} className="text-center rounded-lg bg-secondary/40 border border-border/30 py-1.5">
                        <p className="text-[8px] text-muted-foreground font-semibold">{s.l}</p>
                        <p className="text-sm font-extrabold text-foreground">{s.v}</p>
                      </div>
                    ))}
                  </div>

                  {/* Mini bar chart */}
                  <div className="mb-3">
                    <p className="text-[10px] text-muted-foreground font-semibold mb-1.5">GAME LOG</p>
                    <div className="flex items-end gap-1 h-12">
                      {[10, 13, 11, 15, 12, 14, 9, 16, 13, 14].map((h, i) => {
                        const hit = h > 10.5;
                        return (
                          <div key={i} className="flex-1 flex flex-col justify-end">
                            <div
                              className="w-full rounded-sm origin-bottom"
                              style={{
                                height: `${(h / 16) * 100}%`,
                                background: hit ? "hsl(var(--nba-green))" : "hsl(var(--destructive) / 0.7)",
                                animation: `bar-grow 0.5s ease-out ${i * 0.05}s both`,
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Hit rates */}
                  <div className="space-y-1.5 mb-3">
                    {[
                      { l: "Season", v: 72 },
                      { l: "L10", v: 80 },
                      { l: "L5", v: 80 },
                      { l: "vs LAL", v: 83 },
                    ].map((r, i) => (
                      <div key={r.l} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-12">{r.l}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }} animate={{ width: `${r.v}%` }}
                            transition={{ delay: 0.3 + i * 0.1, duration: 0.7, ease: "easeOut" }}
                            className="h-full rounded-full"
                            style={{ background: "hsl(var(--nba-green))" }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-foreground w-8 text-right">{r.v}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Line shopping */}
                  <div className="mb-3">
                    <p className="text-[10px] text-muted-foreground font-semibold mb-1.5">LINE SHOPPING</p>
                    <div className="space-y-1">
                      {[
                        { b: "DraftKings", o: "−105", best: true },
                        { b: "FanDuel", o: "−110" },
                        { b: "BetMGM", o: "−115" },
                        { b: "Caesars", o: "−120" },
                      ].map(r => (
                        <div key={r.b} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${
                          r.best ? "bg-[hsl(var(--nba-green)/0.1)] border border-[hsl(var(--nba-green)/0.3)]" : "bg-secondary/30 border border-border/30"
                        }`}>
                          <span className="text-[11px] text-foreground font-medium">{r.b}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-foreground">{r.o}</span>
                            {r.best && <span className="text-[8px] font-black text-[hsl(var(--nba-green))] bg-[hsl(var(--nba-green)/0.2)] px-1 rounded">BEST</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Blurred analysis preview */}
                  <div className="relative rounded-xl bg-secondary/30 border border-border/40 p-3 overflow-hidden">
                    <div className="blur-[3px] select-none pointer-events-none">
                      <p className="text-[10px] text-muted-foreground font-semibold mb-1">IN-DEPTH ANALYSIS</p>
                      <p className="text-[11px] text-foreground/80 leading-relaxed">
                        Jokić has dominated the boards against LAL with 13.8 RPG over the last 5 matchups. With Davis questionable and Denver pushing pace tonight, the rebounding rate projects elite. Model edge: +8.4%, EV: +6.2%.
                      </p>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-card/60">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30">
                        <Lock className="w-3.5 h-3.5 text-primary" />
                        <span className="text-[11px] font-bold text-primary">Unlock Analysis</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={goNext}
                  className="w-full py-4 rounded-xl text-white font-extrabold text-base flex items-center justify-center gap-2"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--primary)), hsl(258, 80%, 58%))",
                    boxShadow: "0 12px 32px hsl(var(--primary) / 0.45)",
                    animation: "scale-pulse 2.4s ease-in-out infinite",
                  }}
                >
                  Unlock Sentinel <ArrowRight className="w-4 h-4" />
                </motion.button>

                <p className="text-center text-xs font-semibold mt-3 mb-2" style={{ color: "hsl(var(--nba-green))" }}>
                  💰 Most users recover their subscription in 1–3 days
                </p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default OnboardingPage;
