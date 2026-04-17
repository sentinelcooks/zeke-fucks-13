import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, ArrowRight, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import sentinelLogo from "@/assets/sentinel-lock.jpg";

// Sentinel purple brand
const ACCENT = "#A855F7";       // primary purple
const ACCENT_DEEP = "#7B2FFF";  // deeper purple for gradients

// Generate stars once
const STARS = Array.from({ length: 32 }, (_, i) => ({
  id: i,
  top: Math.random() * 100,
  left: Math.random() * 100,
  size: Math.random() * 1.6 + 0.4,
  delay: Math.random() * 4,
  duration: Math.random() * 3 + 2,
  opacity: Math.random() * 0.35 + 0.1,
}));

// Brand glyphs
const GoogleGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.95l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
  </svg>
);

const AppleGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.365 1.43c0 1.14-.46 2.23-1.21 3.03-.81.86-2.13 1.52-3.21 1.43-.13-1.11.43-2.27 1.16-3.03.82-.87 2.22-1.51 3.26-1.43zM20.5 17.27c-.57 1.32-.85 1.91-1.59 3.07-.99 1.62-2.39 3.65-4.13 3.66-1.55.02-1.95-1-4.06-.99-2.11.01-2.55 1.01-4.1.99-1.74-.02-3.07-1.85-4.06-3.47C-.18 17.4-.43 12.92 1.62 10.5c1.45-1.71 3.74-2.71 5.9-2.71 2.2 0 3.59 1.21 5.41 1.21 1.77 0 2.85-1.21 5.4-1.21 1.93 0 3.97 1.05 5.43 2.86-4.77 2.61-3.99 9.42-3.26 6.62z" />
  </svg>
);

const AuthPage = () => {
  const location = useLocation();
  const locationState = location.state as { mode?: "login" | "signup" } | null;
  const [mode, setMode] = useState<"login" | "signup">(locationState?.mode || "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [remember, setRemember] = useState(true);
  const { signIn, signUp, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const saveOnboardingToDb = useCallback(async (userId: string) => {
    try {
      const referral = localStorage.getItem("sentinel_onboarding_referral") || null;
      const sports = JSON.parse(localStorage.getItem("sentinel_onboarding_sports") || "[]");
      const style = localStorage.getItem("sentinel_onboarding_style") || null;

      if (referral || sports.length || style) {
        const { data: aiData } = await supabase.functions.invoke("personalize", {
          body: { referral, sports, betting_style: style },
        });

        await supabase.from("onboarding_responses").upsert({
          user_id: userId,
          referral,
          sports,
          betting_style: style,
          ai_recommendations: aiData?.recommendations || null,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: "user_id" });

        localStorage.removeItem("sentinel_onboarding_referral");
        localStorage.removeItem("sentinel_onboarding_sports");
        localStorage.removeItem("sentinel_onboarding_style");
      }

      localStorage.setItem("sentinel_onboarding_complete", "true");
      await supabase.from("profiles").update({ onboarding_complete: true } as any).eq("id", userId);
    } catch (err) {
      console.error("Failed to save onboarding:", err);
      localStorage.setItem("sentinel_onboarding_complete", "true");
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // After OAuth redirect lands us back on this page already authenticated,
  // capture the user and save onboarding. The useEffect above will then route to /dashboard.
  useEffect(() => {
    let mounted = true;
    const sub = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) {
        await saveOnboardingToDb(session.user.id);
      }
    });
    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
  }, [saveOnboardingToDb]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Please fill in all fields"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }

    setLoading(true);
    try {
      const result = mode === "login"
        ? await signIn(email, password)
        : await signUp(email, password, displayName || undefined);
      if (result.error) setError(result.error);
      else {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) await saveOnboardingToDb(authUser.id);
        navigate("/dashboard");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    setError("");
    setOauthLoading(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/auth",
      });
      if (result.error) {
        setError(result.error.message || `${provider} sign-in failed`);
        setOauthLoading(null);
        return;
      }
      if (result.redirected) {
        // Browser navigates away to provider; nothing more to do.
        return;
      }
      // Tokens received & session set — onAuthStateChange will save onboarding
      // and the isAuthenticated effect will redirect to /dashboard.
    } catch (err) {
      setError(err instanceof Error ? err.message : `${provider} sign-in failed`);
      setOauthLoading(null);
    }
  };

  if (isAuthenticated) return null;

  const isSignup = mode === "signup";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden px-4 py-8">
      {/* Animated stars */}
      {STARS.map((star) => (
        <motion.div
          key={star.id}
          className="absolute rounded-full bg-foreground pointer-events-none"
          style={{ top: `${star.top}%`, left: `${star.left}%`, width: star.size, height: star.size }}
          animate={{ opacity: [star.opacity * 0.3, star.opacity, star.opacity * 0.3], scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: star.duration, repeat: Infinity, delay: star.delay, ease: "easeInOut" }}
        />
      ))}

      {/* Ambient purple orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'hsl(270 70% 45% / 0.22)' }} />
      <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full blur-[110px] pointer-events-none" style={{ background: `${ACCENT}1f` }} />
      <div className="absolute top-0 left-0 w-[320px] h-[320px] rounded-full blur-[90px] pointer-events-none" style={{ background: 'hsl(265 80% 55% / 0.14)' }} />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-[440px] relative z-10 rounded-[28px] p-7 sm:p-8 border overflow-hidden"
        style={{
          background: 'hsla(265, 25%, 9%, 0.72)',
          borderColor: 'hsla(0, 0%, 100%, 0.06)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          boxShadow: '0 20px 60px hsla(265, 50%, 4%, 0.65), inset 0 1px 0 hsla(0, 0%, 100%, 0.04)',
        }}
      >
        {/* Top inner light gradient */}
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, hsla(0,0%,100%,0.12), transparent)' }} />
        {/* Purple corner glow */}
        <div className="absolute -top-20 -right-20 w-[260px] h-[260px] rounded-full blur-[80px] pointer-events-none" style={{ background: `${ACCENT}33` }} />

        {/* Wordmark + progress */}
        <div className="relative flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div
              className="relative w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center"
              style={{ boxShadow: `0 0 20px ${ACCENT}66, inset 0 0 0 1px ${ACCENT}55` }}
            >
              <img src={sentinelLogo} alt="Sentinel" className="w-full h-full object-cover" />
            </div>
            <span
              className="text-[13px] font-bold tracking-[0.22em]"
              style={{ color: ACCENT, textShadow: `0 0 12px ${ACCENT}66` }}
            >
              SENTINEL
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-1 rounded-full" style={{ background: 'hsla(0,0%,100%,0.08)' }} />
            <div className="w-6 h-1 rounded-full" style={{ background: 'hsla(0,0%,100%,0.08)' }} />
            <div className="w-8 h-1 rounded-full" style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DEEP})`, boxShadow: `0 0 10px ${ACCENT}88` }} />
          </div>
        </div>

        {/* Headline */}
        <div className="relative mb-6">
          <h1 className="text-[28px] leading-[1.15] font-bold tracking-tight text-white">
            {isSignup ? (
              <>
                Create your<br />
                <span style={{ color: ACCENT, textShadow: `0 0 24px ${ACCENT}55` }}>free account</span>
              </>
            ) : (
              <>
                Welcome<br />
                <span style={{ color: ACCENT, textShadow: `0 0 24px ${ACCENT}55` }}>back to Sentinel</span>
              </>
            )}
          </h1>
          <p className="text-[13px] text-white/55 mt-2.5 leading-relaxed">
            {isSignup ? "Unlock your personalized AI picks in seconds." : "Sign in to access today's edge."}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="relative flex p-1 rounded-full mb-5" style={{ background: 'hsla(0,0%,100%,0.04)', border: '1px solid hsla(0,0%,100%,0.05)' }}>
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(""); }}
              className={`relative flex-1 py-2 text-[12px] font-semibold rounded-full transition-colors duration-200 ${mode === m ? "text-white" : "text-white/55 hover:text-white/75"}`}
              style={mode === m ? {
                background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`,
                boxShadow: `0 4px 14px ${ACCENT}55`,
              } : {}}
            >
              {m === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="relative space-y-4" autoComplete="on">
          <AnimatePresence mode="wait">
            {isSignup && (
              <motion.div
                key="name"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <label className="block text-[10px] font-semibold tracking-[0.15em] text-white/50 mb-1.5 uppercase">Display Name</label>
                <input
                  type="text"
                  placeholder="Your name (optional)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-xl py-3 px-4 text-[14px] text-white placeholder:text-white/30 focus:outline-none transition-all"
                  style={{
                    background: 'hsla(0,0%,100%,0.03)',
                    border: '1px solid hsla(0,0%,100%,0.06)',
                    boxShadow: 'inset 0 1px 2px hsla(0,0%,0%,0.25)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = `${ACCENT}66`; e.currentTarget.style.boxShadow = `inset 0 1px 2px hsla(0,0%,0%,0.25), 0 0 0 3px ${ACCENT}26`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'hsla(0,0%,100%,0.06)'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px hsla(0,0%,0%,0.25)'; }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <label className="block text-[10px] font-semibold tracking-[0.15em] text-white/50 mb-1.5 uppercase">Email Address</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-xl py-3 px-4 text-[14px] text-white placeholder:text-white/30 focus:outline-none transition-all"
              style={{
                background: 'hsla(0,0%,100%,0.03)',
                border: '1px solid hsla(0,0%,100%,0.06)',
                boxShadow: 'inset 0 1px 2px hsla(0,0%,0%,0.25)',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = `${ACCENT}66`; e.currentTarget.style.boxShadow = `inset 0 1px 2px hsla(0,0%,0%,0.25), 0 0 0 3px ${ACCENT}26`; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'hsla(0,0%,100%,0.06)'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px hsla(0,0%,0%,0.25)'; }}
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold tracking-[0.15em] text-white/50 mb-1.5 uppercase">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                className="w-full rounded-xl py-3 pl-4 pr-11 text-[14px] text-white placeholder:text-white/30 focus:outline-none transition-all"
                style={{
                  background: 'hsla(0,0%,100%,0.03)',
                  border: '1px solid hsla(0,0%,100%,0.06)',
                  boxShadow: 'inset 0 1px 2px hsla(0,0%,0%,0.25)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = `${ACCENT}66`; e.currentTarget.style.boxShadow = `inset 0 1px 2px hsla(0,0%,0%,0.25), 0 0 0 3px ${ACCENT}26`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'hsla(0,0%,100%,0.06)'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px hsla(0,0%,0%,0.25)'; }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center text-[12px] text-destructive font-medium"
            >
              {error}
            </motion.p>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-3.5 h-3.5 rounded"
              style={{ accentColor: ACCENT }}
            />
            <span className="text-[12px] text-white/55">Remember me on this device</span>
          </label>

          {/* CTA */}
          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.985 }}
            className="w-full py-3.5 rounded-full text-[14px] font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 group"
            style={{
              background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DEEP})`,
              boxShadow: `0 8px 32px ${ACCENT}66, inset 0 1px 0 hsla(0,0%,100%,0.25)`,
            }}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                {isSignup ? "Launch Sentinel" : "Sign In"}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </>
            )}
          </motion.button>
        </form>

        {/* Divider */}
        <div className="relative flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ background: 'hsla(0,0%,100%,0.06)' }} />
          <span className="text-[10px] tracking-[0.18em] uppercase text-white/35 font-medium">
            or {isSignup ? "sign up" : "continue"} with
          </span>
          <div className="flex-1 h-px" style={{ background: 'hsla(0,0%,100%,0.06)' }} />
        </div>

        {/* Social buttons */}
        <div className="relative space-y-2.5">
          <button
            type="button"
            onClick={() => handleOAuth("google")}
            disabled={!!oauthLoading}
            className="w-full py-3 rounded-full text-[13px] font-semibold text-white flex items-center justify-center gap-2.5 transition-all hover:bg-white/[0.06] disabled:opacity-50"
            style={{
              background: 'hsla(0,0%,100%,0.03)',
              border: '1px solid hsla(0,0%,100%,0.08)',
            }}
          >
            {oauthLoading === "google" ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <GoogleGlyph />
                Continue with Google
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => handleOAuth("apple")}
            disabled={!!oauthLoading}
            className="w-full py-3 rounded-full text-[13px] font-semibold text-white flex items-center justify-center gap-2.5 transition-all hover:bg-white/[0.06] disabled:opacity-50"
            style={{
              background: 'hsla(0,0%,100%,0.03)',
              border: '1px solid hsla(0,0%,100%,0.08)',
            }}
          >
            {oauthLoading === "apple" ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <AppleGlyph />
                Continue with Apple
              </>
            )}
          </button>
        </div>

        {/* Legal microcopy */}
        <p className="relative text-[10.5px] leading-relaxed text-white/40 text-center mt-5 px-2">
          By continuing you agree to our{" "}
          <Link
            to="/dashboard/legal"
            state={{ section: "terms" }}
            className="underline underline-offset-2 hover:opacity-80 transition-opacity"
            style={{ color: ACCENT }}
          >
            Terms
          </Link>
          {" "}and{" "}
          <Link
            to="/dashboard/legal"
            state={{ section: "privacy" }}
            className="underline underline-offset-2 hover:opacity-80 transition-opacity"
            style={{ color: ACCENT }}
          >
            Privacy Policy
          </Link>.
          Must be 18+. Gamble responsibly.
        </p>

        {/* Back + dots */}
        <div className="relative flex items-center justify-between mt-5">
          <button
            type="button"
            onClick={() => navigate("/onboarding")}
            className="flex items-center gap-1.5 text-[12px] text-white/50 hover:text-white/80 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'hsla(0,0%,100%,0.15)' }} />
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'hsla(0,0%,100%,0.15)' }} />
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}99` }} />
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
