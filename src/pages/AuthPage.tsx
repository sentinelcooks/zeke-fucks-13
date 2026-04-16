import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, ArrowRight, Mail, Lock, User, Shield, LockKeyhole } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/sentinel-lock.jpg";

// Typing-reactive input wrapper
const TypeGlowInput = ({
  value,
  onChange,
  icon: Icon,
  ...props
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  icon: React.ElementType;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'className'>) => {
  const [ripple, setRipple] = useState(false);
  const intensity = Math.min(value.length / 20, 1);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e);
    setRipple(true);
    setTimeout(() => setRipple(false), 300);
  }, [onChange]);

  return (
    <div className="relative group">
      {/* Typing glow ring */}
      <motion.div
        className="absolute -inset-[1px] rounded-xl pointer-events-none"
        animate={{
          boxShadow: ripple
            ? `0 0 ${16 + intensity * 20}px hsla(270, 60%, 55%, ${0.3 + intensity * 0.3}), inset 0 0 ${8 + intensity * 8}px hsla(270, 60%, 55%, ${0.05 + intensity * 0.1})`
            : `0 0 0px hsla(270, 60%, 55%, 0)`,
          borderColor: ripple
            ? `hsla(270, 60%, 55%, ${0.4 + intensity * 0.3})`
            : `hsla(260, 30%, 25%, 0.3)`,
        }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        style={{ border: '1px solid transparent', borderRadius: '0.75rem' }}
      />
      <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/65 z-10 transition-all duration-200" style={{
        color: value.length > 0 ? `hsla(270, 60%, 65%, ${0.5 + intensity * 0.5})` : undefined,
        filter: value.length > 0 ? `drop-shadow(0 0 ${4 + intensity * 4}px hsla(270, 60%, 55%, ${0.3 + intensity * 0.3}))` : undefined,
      }} />
      {(() => {
        const { style: userStyle, ...restProps } = props;
        return (
          <input
            value={value}
            onChange={handleChange}
            className="w-full rounded-xl py-3 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-[hsla(270,60%,55%,0.4)] transition-all duration-200 hover:shadow-[0_0_16px_hsla(270,60%,55%,0.08)]"
            style={{
              background: 'hsla(260, 20%, 8%, 0.6)',
              border: '1px solid hsla(260, 30%, 25%, 0.3)',
              ...userStyle,
            }}
            {...restProps}
          />
        );
      })()}
      {/* Fill bar at bottom */}
      <motion.div
        className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full origin-left"
        style={{ background: 'linear-gradient(90deg, hsl(270 60% 55%), hsl(280 70% 65%))' }}
        animate={{ scaleX: intensity, opacity: intensity > 0 ? 0.7 : 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      />
    </div>
  );
};

// Generate random star positions once
const STARS = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  top: Math.random() * 100,
  left: Math.random() * 100,
  size: Math.random() * 2 + 0.5,
  delay: Math.random() * 4,
  duration: Math.random() * 3 + 2,
  opacity: Math.random() * 0.4 + 0.1,
}));

const AuthPage = () => {
  const location = useLocation();
  const locationState = location.state as { mode?: "login" | "signup" } | null;
  const [mode, setMode] = useState<"login" | "signup">(locationState?.mode || "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
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

        // Clean up localStorage
        localStorage.removeItem("sentinel_onboarding_referral");
        localStorage.removeItem("sentinel_onboarding_sports");
        localStorage.removeItem("sentinel_onboarding_style");
      }

      // Mark onboarding complete — both locally and server-side
      localStorage.setItem("sentinel_onboarding_complete", "true");
      await supabase.from("profiles").update({ onboarding_complete: true } as any).eq("id", userId);
    } catch (err) {
      console.error("Failed to save onboarding:", err);
      // Still mark locally so we never re-show onboarding
      localStorage.setItem("sentinel_onboarding_complete", "true");
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Fill in all fields"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }

    setLoading(true);
    try {
      const result = mode === "login"
        ? await signIn(email, password)
        : await signUp(email, password, displayName || undefined);
      if (result.error) setError(result.error);
      else {
        // Save onboarding data to DB then navigate
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

  if (isAuthenticated) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden">
      {/* Animated stars */}
      {STARS.map((star) => (
        <motion.div
          key={star.id}
          className="absolute rounded-full bg-foreground pointer-events-none"
          style={{
            top: `${star.top}%`,
            left: `${star.left}%`,
            width: star.size,
            height: star.size,
          }}
          animate={{
            opacity: [star.opacity * 0.3, star.opacity, star.opacity * 0.3],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{
            duration: star.duration,
            repeat: Infinity,
            delay: star.delay,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Ambient gradient orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'hsl(270 60% 40% / 0.15)' }} />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[100px] pointer-events-none" style={{ background: 'hsl(30 80% 50% / 0.06)' }} />
      <div className="absolute top-0 left-0 w-[300px] h-[300px] rounded-full blur-[80px] pointer-events-none" style={{ background: 'hsl(270 70% 50% / 0.08)' }} />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-md mx-4 relative z-10 rounded-2xl p-8 border"
        style={{
          background: 'hsla(260, 20%, 12%, 0.65)',
          borderColor: 'hsla(260, 30%, 30%, 0.3)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 8px 40px hsla(260, 40%, 10%, 0.5)',
        }}
      >
        {/* Logo + Header */}
        <div className="flex flex-col items-center mb-7">
          <motion.img
            src={logo}
            alt="Sentinel logo"
            className="w-16 h-16 rounded-2xl mb-4 transition-shadow duration-300 hover:shadow-[0_0_24px_hsla(270,60%,55%,0.4)]"
            draggable={false}
            whileHover={{ scale: 1.05 }}
          />
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            {mode === "login" ? "Welcome Back" : "Create Account"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            {mode === "login" ? "Sign in to continue" : "Sign up to get started"}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex p-1 rounded-xl mb-6" style={{ background: 'hsla(260, 20%, 8%, 0.6)', border: '1px solid hsla(260, 30%, 25%, 0.2)' }}>
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 hover:shadow-[0_0_12px_hsla(270,60%,55%,0.15)] ${
                mode === m
                  ? "text-white shadow-lg"
                  : "text-muted-foreground/65 hover:text-muted-foreground/60"
              }`}
              style={mode === m ? {
                background: 'linear-gradient(135deg, hsl(270 60% 55%), hsl(270 50% 40%))',
                boxShadow: '0 2px 12px hsla(270, 60%, 50%, 0.3)',
              } : {}}
            >
              {m === "login" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
          <AnimatePresence mode="wait">
            {mode === "signup" && (
              <motion.div
                key="name"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <label className="block text-sm font-semibold text-foreground/80 mb-1.5">Display Name</label>
                <TypeGlowInput
                  icon={User}
                  type="text"
                  placeholder="Your name (optional)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <label className="block text-sm font-semibold text-foreground/80 mb-1.5">Email</label>
            <TypeGlowInput
              icon={Mail}
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-foreground/80 mb-1.5">Password</label>
            <div className="relative">
              <TypeGlowInput
                icon={Lock}
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                style={{ paddingRight: '2.75rem' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/65 hover:text-foreground hover:drop-shadow-[0_0_6px_hsla(270,60%,55%,0.4)] transition-all z-10"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center text-sm text-destructive font-medium"
            >
              {error}
            </motion.p>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-primary"
              style={{ accentColor: 'hsl(270 60% 55%)' }}
            />
            <span className="text-sm text-muted-foreground group-hover:text-foreground/70 transition-colors">Remember me</span>
          </label>

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.01, boxShadow: '0 6px 28px hsla(270, 60%, 50%, 0.45)' }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40 group"
            style={{
              background: 'linear-gradient(135deg, hsl(270 60% 55%), hsl(270 50% 40%))',
              boxShadow: '0 4px 20px hsla(270, 60%, 50%, 0.3)',
            }}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                {mode === "login" ? "Sign In" : "Create Account"}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </motion.button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ background: 'hsla(260, 30%, 30%, 0.3)' }} />
          <span className="text-xs text-muted-foreground/50 font-medium">Secured Access</span>
          <div className="flex-1 h-px" style={{ background: 'hsla(260, 30%, 30%, 0.3)' }} />
        </div>

        {/* Brand footer */}
        <div className="flex items-center justify-center gap-2 text-sm">
          <img src={logo} alt="" className="w-4 h-4 rounded" draggable={false} />
          <span className="font-bold tracking-wide text-xs text-muted-foreground/60 uppercase">Sentinel Analytics</span>
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-muted-foreground/65 text-xs">
          <Shield className="w-3 h-3" />
          <span>Encrypted • Session verified • Secure login</span>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthPage;
