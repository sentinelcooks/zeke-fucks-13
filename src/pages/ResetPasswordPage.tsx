import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, ArrowRight, CheckCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BrandMark } from "@/components/brand/BrandMark";

const ACCENT = "hsl(var(--primary))";
const ACCENT_DEEP = "hsl(var(--primary))";

type Status = "checking" | "ready" | "expired" | "saving" | "saved";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  // Supabase fires PASSWORD_RECOVERY when the user lands via the recovery
  // link. Until then we wait — if no recovery session arrives in 10s, treat
  // the link as expired/invalid.
  useEffect(() => {
    if (searchParams.get("error")) {
      setStatus("expired");
      return;
    }

    let resolved = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        resolved = true;
        setStatus("ready");
      }
    });

    // If the recovery exchange already completed before we subscribed, the
    // current session will exist — we'll allow the form in that case too.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (resolved) return;
      if (session) {
        resolved = true;
        setStatus("ready");
      }
    });

    const timer = setTimeout(() => {
      if (!resolved) setStatus("expired");
    }, 10_000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }

    setStatus("saving");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setStatus("ready");
      return;
    }
    setStatus("saved");
    setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden px-4 py-8 pt-safe-plus-4 pb-safe">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[120px] pointer-events-none" style={{ background: 'hsl(var(--primary) / 0.22)' }} />
      <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full blur-[110px] pointer-events-none" style={{ background: `hsl(var(--primary) / 0.12)` }} />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-[440px] relative z-10 rounded-[28px] p-7 sm:p-8 border overflow-hidden"
        style={{
          background: 'hsl(var(--card) / 0.72)',
          borderColor: 'hsl(var(--foreground) / 0.06)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          boxShadow: '0 20px 60px hsl(var(--primary) / 0.65), inset 0 1px 0 hsl(var(--foreground) / 0.04)',
        }}
      >
        <div className="relative flex items-center gap-2.5 mb-6">
          <div
            className="relative w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center"
            style={{ boxShadow: `0 0 20px hsl(var(--primary) / 0.4), inset 0 0 0 1px hsl(var(--primary) / 0.33)` }}
          >
            <BrandMark />
          </div>
          <span
            className="text-[13px] font-bold tracking-[0.04em]"
            style={{ color: ACCENT, textShadow: `0 0 12px hsl(var(--primary) / 0.4)` }}
          >
            SENTINEL
          </span>
        </div>

        {status === "checking" && (
          <div className="py-12 flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-foreground/20 border-t-white rounded-full animate-spin" />
            <p className="text-[13px] text-foreground/55">Verifying your reset link…</p>
          </div>
        )}

        {status === "expired" && (
          <div className="py-6 text-center">
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'hsl(var(--danger) / 0.13)', border: '1px solid hsl(var(--danger) / 0.27)' }}>
                <AlertTriangle className="w-8 h-8 text-destructive" />
              </div>
            </div>
            <h1 className="text-[24px] font-bold text-foreground mb-2">Link expired</h1>
            <p className="text-[13px] text-foreground/55 leading-relaxed mb-6">
              This password reset link is invalid or has already been used. Request a new one to continue.
            </p>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/auth", { state: { mode: "login" } })}
              className="w-full py-3 rounded-full text-[13px] font-semibold text-white transition-all"
              style={{
                background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DEEP})`,
                boxShadow: `0 8px 24px hsl(var(--primary) / 0.27)`,
              }}
            >
              Back to sign in
            </motion.button>
          </div>
        )}

        {status === "saved" && (
          <div className="py-6 text-center">
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: `hsl(var(--primary) / 0.13)`, border: `1px solid hsl(var(--primary) / 0.27)` }}>
                <CheckCircle className="w-8 h-8" style={{ color: ACCENT }} />
              </div>
            </div>
            <h1 className="text-[24px] font-bold text-foreground mb-2">Password updated</h1>
            <p className="text-[13px] text-foreground/55 leading-relaxed">Signing you in…</p>
          </div>
        )}

        {(status === "ready" || status === "saving") && (
          <>
            <h1 className="text-[28px] leading-[1.15] font-bold tracking-tight text-foreground mb-2">
              Set a new<br />
              <span style={{ color: ACCENT, textShadow: `0 0 24px hsl(var(--primary) / 0.33)` }}>password</span>
            </h1>
            <p className="text-[13px] text-foreground/55 mb-6 leading-relaxed">
              Choose a strong password you haven't used elsewhere.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-[11px] font-semibold tracking-[0.04em] text-foreground/50 mb-1.5 uppercase">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-full rounded-xl py-3 pl-4 pr-11 text-[14px] text-foreground placeholder:text-foreground/30 focus:outline-none transition-all"
                    style={{
                      background: 'hsl(var(--foreground) / 0.03)',
                      border: '1px solid hsl(var(--foreground) / 0.06)',
                      boxShadow: 'inset 0 1px 2px hsla(0,0%,0%,0.25)',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = `hsl(var(--primary) / 0.4)`; e.currentTarget.style.boxShadow = `inset 0 1px 2px hsla(0,0%,0%,0.25), 0 0 0 3px hsl(var(--primary) / 0.15)`; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--foreground) / 0.06)'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px hsla(0,0%,0%,0.25)'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground/80 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold tracking-[0.04em] text-foreground/50 mb-1.5 uppercase">Confirm Password</label>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-xl py-3 px-4 text-[14px] text-foreground placeholder:text-foreground/30 focus:outline-none transition-all"
                  style={{
                    background: 'hsl(var(--foreground) / 0.03)',
                    border: '1px solid hsl(var(--foreground) / 0.06)',
                    boxShadow: 'inset 0 1px 2px hsla(0,0%,0%,0.25)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = `hsl(var(--primary) / 0.4)`; e.currentTarget.style.boxShadow = `inset 0 1px 2px hsla(0,0%,0%,0.25), 0 0 0 3px hsl(var(--primary) / 0.15)`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--foreground) / 0.06)'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px hsla(0,0%,0%,0.25)'; }}
                />
              </div>

              {error && (
                <p className="text-center text-[12px] text-destructive font-medium">{error}</p>
              )}

              <motion.button
                type="submit"
                disabled={status === "saving"}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.985 }}
                className="w-full py-3.5 rounded-full text-[14px] font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 group"
                style={{
                  background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DEEP})`,
                  boxShadow: `0 8px 32px hsl(var(--primary) / 0.4), inset 0 1px 0 hsl(var(--foreground) / 0.25)`,
                }}
              >
                {status === "saving" ? (
                  <div className="w-5 h-5 border-2 border-foreground/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Update password
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
                  </>
                )}
              </motion.button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  );
}
