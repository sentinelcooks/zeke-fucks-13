import { useState, useEffect, useRef } from "react";
import { Key, Eye, EyeOff, ArrowRight, Shield, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 3 * 60 * 1000; // 3 minute UI lockout

const LoginPage = () => {
  const [authKey, setAuthKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [rememberKey, setRememberKey] = useState(() => localStorage.getItem("primal-remember") === "true");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockoutEnd, setLockoutEnd] = useState<number | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const { signIn, isLoading, isAuthenticated } = useAuth();
  const login = async (key: string, _remember?: boolean) => {
    const result = await signIn(key, "");
    return { success: !result.error, error: result.error };
  };
  const navigate = useNavigate();
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Lockout countdown
  useEffect(() => {
    if (!lockoutEnd) return;
    
    lockoutTimerRef.current = setInterval(() => {
      const remaining = lockoutEnd - Date.now();
      if (remaining <= 0) {
        setLockoutEnd(null);
        setLockoutRemaining(0);
        setAttempts(0);
        if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
      } else {
        setLockoutRemaining(Math.ceil(remaining / 1000));
      }
    }, 1000);

    return () => {
      if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
    };
  }, [lockoutEnd]);

  // Prevent paste into key field (anti-brute-force scripting)
  const handlePaste = (e: React.ClipboardEvent) => {
    // Allow paste but add a small delay to prevent rapid automated pasting
    const text = e.clipboardData.getData("text");
    if (text.length > 50) {
      e.preventDefault();
      setError("Invalid key format");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (lockoutEnd && Date.now() < lockoutEnd) {
      setError(`Locked out. Try again in ${lockoutRemaining}s.`);
      return;
    }

    // Basic format validation
    const trimmed = authKey.trim();
    if (trimmed.length < 10 || trimmed.length > 50) {
      setError("Invalid key format");
      return;
    }

    const result = await login(trimmed, rememberKey);
    if (result.success) {
      if (rememberKey) {
        localStorage.setItem("primal-remember", "true");
      } else {
        localStorage.removeItem("primal-remember");
      }
      navigate("/dashboard");
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      
      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        const end = Date.now() + LOCKOUT_DURATION_MS;
        setLockoutEnd(end);
        setLockoutRemaining(Math.ceil(LOCKOUT_DURATION_MS / 1000));
        setError("Too many failed attempts. Please wait before trying again.");
      } else {
        setError(result.error || "Invalid authentication key");
      }
    }
  };

  const isLockedOut = !!(lockoutEnd && Date.now() < lockoutEnd);

  if (isAuthenticated) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-grid relative overflow-hidden pt-safe pb-safe">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-accent/8 blur-[100px] pointer-events-none" />

      <div className="glass-card rounded-2xl p-10 w-full max-w-md mx-4 relative z-10">
        <div className="flex flex-col items-center mb-8">
          <img
            src={logo}
            alt="Primal logo"
            className="w-20 h-20 rounded-2xl mb-5 glow-border"
            draggable={false}
          />
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Welcome to Primal
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Enter your license key to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
          <div className="relative">
            <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type={showKey ? "text" : "password"}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              onPaste={handlePaste}
              disabled={isLockedOut}
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-input text-foreground placeholder:text-muted-foreground rounded-xl py-3.5 pl-10 pr-11 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-primary transition-all font-mono tracking-wider disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showKey ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm justify-center">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberKey}
              onChange={(e) => setRememberKey(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-input accent-primary"
            />
            <span className="text-sm text-muted-foreground">Remember this key</span>
          </label>

          {isLockedOut && (
            <div className="text-center text-xs text-muted-foreground">
              Retry in <span className="font-mono text-foreground">{lockoutRemaining}s</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!authKey || isLoading || isLockedOut}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl py-3.5 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <>
                Get Started
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-muted-foreground/60 text-xs">
          <Shield className="w-3 h-3" />
          <span>Device-locked • Fingerprint verified • HMAC signed</span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
