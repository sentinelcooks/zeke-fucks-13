import React, { useState, useEffect, useRef } from "react";
import {
  Key,
  Plus,
  Trash2,
  Shield,
  ShieldOff,
  RefreshCw,
  Copy,
  Check,
  ArrowLeft,
  Globe,
  Lock,
  Eye,
  EyeOff,
  Users,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Target,
  Flame,
  Trophy,
  Dumbbell,
  Database,
  Zap,
  AlertTriangle,
  History,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import logo from "@/assets/logo.png";
import { EdgeHistoryTab } from "@/components/admin/EdgeHistoryTab";
import { PicksHistoryTab } from "@/components/admin/PicksHistoryTab";
import { resolveDisplayName } from "@/lib/displayName";

interface LicenseKey {
  id: string;
  key: string;
  label: string | null;
  max_devices: number;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
  key_sessions: any[];
}

interface OnboardingResponse {
  id: string;
  user_id: string;
  referral: string | null;
  sports: string[];
  betting_style: string | null;
  ai_recommendations: any;
  created_at: string;
  updated_at: string;
  email: string | null;
  display_name: string | null;
}

const ADMIN_SESSION_TIMEOUT = 10 * 60 * 1000;
const MAX_ADMIN_ATTEMPTS = 5;

const STYLE_ICONS: Record<string, React.ElementType> = {
  Conservative: Target,
  Aggressive: Flame,
  Balanced: Trophy,
  Learning: Dumbbell,
};

const SPORT_COLORS: Record<string, string> = {
  NBA: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  MLB: "bg-red-500/15 text-red-400 border-red-500/20",
  UFC: "bg-red-600/15 text-red-500 border-red-600/20",
  NFL: "bg-amber-600/15 text-amber-500 border-amber-600/20",
  NHL: "bg-sky-500/15 text-sky-400 border-sky-500/20",
  Soccer: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

const AdminPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [keys, setKeys] = useState<LicenseKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [whitelistIps, setWhitelistIps] = useState<any[]>([]);
  const [myIp, setMyIp] = useState("");
  const [newIp, setNewIp] = useState("");
  const [adminAttempts, setAdminAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const adminTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authTimeRef = useRef<number>(0);

  // Tab state
  const [activeTab, setActiveTab] = useState<"keys" | "onboarding" | "edge" | "picks">("keys");

  // Onboarding state
  const [onboardingResponses, setOnboardingResponses] = useState<OnboardingResponse[]>([]);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingSearch, setOnboardingSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "style" | "sports">("date");
  const [filterSport, setFilterSport] = useState<string | null>(null);
  const [filterStyle, setFilterStyle] = useState<string | null>(null);

  // Generate form
  const [genLabel, setGenLabel] = useState("");
  const [genMaxDevices, setGenMaxDevices] = useState(1);
  const [genExpDays, setGenExpDays] = useState<number | "">("");

  // API Key stats
  const [apiKeyStats, setApiKeyStats] = useState<{
    total: number; active: number; exhausted: number; inactive: number;
    totalRemaining: number; totalUsed: number;
  } | null>(null);
  const [bulkApiKeys, setBulkApiKeys] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResults, setTestResults] = useState<Array<{ key: string; valid: boolean; error?: string }> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthResult, setHealthResult] = useState<any>(null);

  // Single canonical Odds API key (app_config)
  const [oddsKeyInput, setOddsKeyInput] = useState("");
  const [showOddsKey, setShowOddsKey] = useState(false);
  const [oddsKeyStatus, setOddsKeyStatus] = useState<{ exists: boolean; updated_at: string | null } | null>(null);
  const [oddsKeySaving, setOddsKeySaving] = useState(false);

  const adminCall = async (action: string, extra: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke("key-admin", {
      body: { password, action, ...extra },
    });
    if (error) {
      // Surface the real error so we can diagnose: function not deployed,
      // wrong project, CORS failure, missing env var, etc.
      const detail = error.message || String(error);
      console.error("[admin] key-admin invoke error:", error);
      throw new Error(`Connection error: ${detail}`);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const saveConfigCall = async (action: string, extra: Record<string, any> = {}) => {
    const { data, error } = await supabase.functions.invoke("save-config", {
      body: { password, action, ...extra },
    });
    if (error) throw new Error(error.message || String(error));
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const loadOddsKeyStatus = async () => {
    try {
      const data = await saveConfigCall("status", { key: "odds_api_key" });
      setOddsKeyStatus(data);
    } catch (e) {
      console.error("Failed to load odds key status:", e);
    }
  };

  const loadApiKeyStats = async () => {
    try {
      const data = await adminCall("api_key_status");
      setApiKeyStats(data);
    } catch (e) {
      console.error("Failed to load API key stats:", e);
    }
  };

  const onboardingAdminCall = async (action: string) => {
    const { data, error } = await supabase.functions.invoke("admin-onboarding", {
      body: { password, action },
    });
    if (error) {
      const detail = error.message || String(error);
      console.error("[admin] admin-onboarding invoke error:", error);
      throw new Error(`Connection error: ${detail}`);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };

  useEffect(() => {
    if (!isAuthed) return;
    adminTimeoutRef.current = setTimeout(() => {
      setIsAuthed(false);
      setPassword("");
      setAuthError("Admin session expired. Please re-authenticate.");
    }, ADMIN_SESSION_TIMEOUT);
    return () => {
      if (adminTimeoutRef.current) clearTimeout(adminTimeoutRef.current);
    };
  }, [isAuthed]);

  const loadOnboarding = async () => {
    setOnboardingLoading(true);
    try {
      const data = await onboardingAdminCall("list_responses");
      setOnboardingResponses(data.responses || []);
    } catch (e) {
      console.error("Failed to load onboarding:", e);
    }
    setOnboardingLoading(false);
  };

  const handleLogin = async () => {
    setAuthError("");
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      setAuthError(`Too many attempts. Try again in ${remaining}s.`);
      return;
    }
    try {
      const data = await adminCall("list_keys");
      setKeys(data.keys || []);
      setIsAuthed(true);
      setAdminAttempts(0);
      authTimeRef.current = Date.now();
      loadWhitelist();
      loadOnboarding();
      loadApiKeyStats();
      loadOddsKeyStatus();
    } catch (e: any) {
      const newAttempts = adminAttempts + 1;
      setAdminAttempts(newAttempts);
      if (newAttempts >= MAX_ADMIN_ATTEMPTS) {
        const lockout = Date.now() + 5 * 60 * 1000;
        setLockoutUntil(lockout);
        setAuthError("Too many failed attempts. Locked out for 5 minutes.");
      } else {
        setAuthError(e.message);
      }
    }
  };

  const loadKeys = async () => {
    setLoading(true);
    try {
      const data = await adminCall("list_keys");
      setKeys(data.keys || []);
    } catch {}
    setLoading(false);
  };

  const loadWhitelist = async () => {
    try {
      const data = await adminCall("list_whitelist");
      setWhitelistIps(data.ips || []);
      setMyIp(data.your_ip || "");
    } catch {}
  };

  const generateKey = async () => {
    try {
      await adminCall("generate_key", {
        label: genLabel || undefined,
        max_devices: genMaxDevices,
        expires_in_days: genExpDays || undefined,
      });
      setGenLabel("");
      setGenExpDays("");
      loadKeys();
    } catch {}
  };

  const toggleKey = async (id: string, active: boolean) => {
    await adminCall(active ? "revoke_key" : "activate_key", { key_id: id });
    loadKeys();
  };

  const clearSessions = async (id: string) => {
    await adminCall("clear_sessions", { key_id: id });
    loadKeys();
  };

  const copyKey = (key: string, id: string) => {
    navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const addWhitelistIp = async () => {
    if (!newIp) return;
    await adminCall("add_whitelist_ip", { ip: newIp });
    setNewIp("");
    loadWhitelist();
  };

  const removeWhitelistIp = async (ip: string) => {
    await adminCall("remove_whitelist_ip", { ip });
    loadWhitelist();
  };

  // Filter and sort onboarding responses
  const filteredResponses = onboardingResponses
    .filter((r) => {
      const searchLower = onboardingSearch.toLowerCase();
      const matchesSearch =
        !onboardingSearch ||
        (r.email || "").toLowerCase().includes(searchLower) ||
        (r.display_name || "").toLowerCase().includes(searchLower) ||
        (r.referral || "").toLowerCase().includes(searchLower) ||
        (r.betting_style || "").toLowerCase().includes(searchLower) ||
        (r.sports || []).some((s) => s.toLowerCase().includes(searchLower));
      const matchesSport = !filterSport || (r.sports || []).includes(filterSport);
      const matchesStyle = !filterStyle || r.betting_style === filterStyle;
      return matchesSearch && matchesSport && matchesStyle;
    })
    .sort((a, b) => {
      if (sortBy === "date") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === "style") return (a.betting_style || "").localeCompare(b.betting_style || "");
      if (sortBy === "sports") return (b.sports?.length || 0) - (a.sports?.length || 0);
      return 0;
    });

  // Stats
  const sportStats = onboardingResponses.reduce<Record<string, number>>((acc, r) => {
    (r.sports || []).forEach((s) => { acc[s] = (acc[s] || 0) + 1; });
    return acc;
  }, {});
  const styleStats = onboardingResponses.reduce<Record<string, number>>((acc, r) => {
    if (r.betting_style) acc[r.betting_style] = (acc[r.betting_style] || 0) + 1;
    return acc;
  }, {});
  const referralStats = onboardingResponses.reduce<Record<string, number>>((acc, r) => {
    if (r.referral) acc[r.referral] = (acc[r.referral] || 0) + 1;
    return acc;
  }, {});

  if (!isAuthed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background bg-grid relative overflow-hidden pt-safe pb-safe">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-destructive/10 blur-[120px] pointer-events-none" />
        <div className="glass-card rounded-2xl p-10 w-full max-w-md mx-4 relative z-10">
          <div className="flex flex-col items-center mb-8">
            <img src={logo} alt="Primal" className="w-16 h-16 rounded-2xl mb-4" />
            <h1 className="text-xl font-bold text-foreground">Admin Sector</h1>
            <p className="text-muted-foreground text-xs mt-1">Restricted Access</p>
          </div>
          <div className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Admin Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full bg-input text-foreground placeholder:text-muted-foreground rounded-xl py-3 pl-10 pr-10 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {authError && (
              <p className="text-destructive text-sm text-center">{authError}</p>
            )}
            <button
              onClick={handleLogin}
              disabled={!password}
              className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground font-semibold rounded-xl py-3 text-sm transition-all disabled:opacity-40"
            >
              Access Admin
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background bg-grid p-6 pt-safe-plus-4 pb-safe">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-foreground">Admin Panel</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-card/60 border border-border/40 w-fit">
          <button
            onClick={() => setActiveTab("keys")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "keys"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Key className="w-4 h-4" /> License Keys
          </button>
          <button
            onClick={() => { setActiveTab("onboarding"); if (onboardingResponses.length === 0) loadOnboarding(); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "onboarding"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-4 h-4" /> Onboarding ({onboardingResponses.length})
          </button>
          <button
            onClick={() => setActiveTab("edge")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "edge"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="w-4 h-4" /> Edge History
          </button>
          <button
            onClick={() => setActiveTab("picks")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === "picks"
                ? "bg-primary text-primary-foreground shadow-lg"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="w-4 h-4" /> Picks History
          </button>
        </div>

        {/* ═══ EDGE HISTORY TAB ═══ */}
        {activeTab === "edge" && (
          <div className="space-y-4">
            <EdgeHistoryTab password={password} />
          </div>
        )}

        {/* ═══ PICKS HISTORY TAB ═══ */}
        {activeTab === "picks" && (
          <div className="space-y-4">
            <PicksHistoryTab password={password} />
          </div>
        )}

        {/* ═══ KEYS TAB ═══ */}
        {activeTab === "keys" && (
          <>
            <div className="flex justify-end">
              <button onClick={loadKeys} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>

            {/* ── Primary Odds API Key (app_config) ── */}
            <div className="glass-card rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4" /> Odds API Key (Primary)
                </h2>
                {oddsKeyStatus && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    oddsKeyStatus.exists
                      ? "bg-green-500/15 text-green-400"
                      : "bg-destructive/15 text-destructive"
                  }`}>
                    {oddsKeyStatus.exists ? "● Connected" : "○ Not Set"}
                  </span>
                )}
              </div>
              {oddsKeyStatus?.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Last updated: {new Date(oddsKeyStatus.updated_at).toLocaleString()}
                </p>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showOddsKey ? "text" : "password"}
                    value={oddsKeyInput}
                    onChange={(e) => setOddsKeyInput(e.target.value)}
                    placeholder="Enter Odds API key..."
                    className="w-full bg-input text-foreground placeholder:text-muted-foreground rounded-lg py-2.5 px-3 pr-10 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOddsKey(!showOddsKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showOddsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  disabled={!oddsKeyInput.trim() || oddsKeySaving}
                  onClick={async () => {
                    setOddsKeySaving(true);
                    try {
                      await saveConfigCall("save", { key: "odds_api_key", value: oddsKeyInput.trim() });
                      setOddsKeyInput("");
                      const status = await saveConfigCall("status", { key: "odds_api_key" });
                      setOddsKeyStatus(status);
                    } catch (e: any) {
                      alert(e.message);
                    }
                    setOddsKeySaving(false);
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg py-2 px-4 text-sm transition-all disabled:opacity-40 whitespace-nowrap"
                >
                  {oddsKeySaving ? "Saving..." : "Save Key"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Stored securely in Supabase via Edge Function. Never exposed to the frontend.
                Used by all Edge Functions as a fallback when the rotation pool is empty.
              </p>
            </div>

            {/* Odds API Key Status (rotation pool) */}
            <div className="glass-card rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Database className="w-4 h-4" /> Odds API Keys
                </h2>
                <button onClick={loadApiKeyStats} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
              {apiKeyStats ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-bold text-foreground">{apiKeyStats.active}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                      <Zap className="w-3 h-3 text-green-500" /> Available
                    </div>
                  </div>
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-bold text-foreground">{apiKeyStats.exhausted}</div>
                    <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                      <AlertTriangle className="w-3 h-3 text-destructive" /> Exhausted
                    </div>
                  </div>
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-bold text-foreground">{apiKeyStats.total}</div>
                    <div className="text-xs text-muted-foreground mt-1">Total Keys</div>
                  </div>
                  <div className="bg-card rounded-lg border border-border p-3 text-center">
                    <div className="text-2xl font-bold text-foreground">{apiKeyStats.totalRemaining?.toLocaleString() || 0}</div>
                    <div className="text-xs text-muted-foreground mt-1">Requests Left</div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Loading...</p>
              )}
              {apiKeyStats && apiKeyStats.active === 0 && apiKeyStats.total > 0 && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> All API keys are exhausted! Odds features will not work.
                </div>
              )}

              {/* Bulk Add Keys */}
              <div className="space-y-2">
                <textarea
                  value={bulkApiKeys}
                  onChange={(e) => setBulkApiKeys(e.target.value)}
                  placeholder="Paste API keys here — one per line, or comma-separated"
                  rows={4}
                  className="w-full bg-input text-foreground placeholder:text-muted-foreground rounded-lg py-2.5 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50 font-mono resize-y"
                />
                <div className="flex items-center gap-2">
                  <button
                    disabled={!bulkApiKeys.trim() || bulkLoading}
                    onClick={async () => {
                      setBulkLoading(true);
                      try {
                        const keys = bulkApiKeys.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
                        const data = await adminCall("bulk_add_api_keys", { keys });
                        setBulkApiKeys("");
                        loadApiKeyStats();
                        alert(`Added ${data.added} keys${data.duplicates ? ` (${data.duplicates} duplicates skipped)` : ""}`);
                      } catch (e: any) {
                        alert(e.message);
                      }
                      setBulkLoading(false);
                    }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg py-2 px-4 text-sm transition-all disabled:opacity-40"
                  >
                    {bulkLoading ? "Adding..." : "Add Keys"}
                   </button>
                  <button
                    disabled={!bulkApiKeys.trim() || testLoading}
                    onClick={async () => {
                      setTestLoading(true);
                      setTestResults(null);
                      try {
                        const keys = bulkApiKeys.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
                        const data = await adminCall("test_api_keys", { keys });
                        setTestResults(data.results);
                      } catch (e: any) { alert(e.message); }
                      setTestLoading(false);
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground bg-muted px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {testLoading ? "Testing..." : "Test Keys"}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await adminCall("reset_exhausted_keys");
                        loadApiKeyStats();
                        alert("All exhausted keys have been reset.");
                      } catch (e: any) { alert(e.message); }
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground bg-muted px-3 py-2 rounded-lg transition-colors"
                  >
                    Reset Exhausted
                  </button>
                  <button
                    onClick={async () => {
                      setHealthLoading(true);
                      setHealthResult(null);
                      try {
                        const { data, error } = await supabase.functions.invoke("odds-health-check", {
                          body: { password },
                        });
                        if (error) throw new Error(error.message || String(error));
                        setHealthResult(data);
                      } catch (e: any) {
                        setHealthResult({ ok: false, error: e.message });
                      }
                      setHealthLoading(false);
                    }}
                    disabled={healthLoading || !password}
                    className="text-sm text-muted-foreground hover:text-foreground bg-muted px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {healthLoading ? "Checking..." : "Run Odds Health Check"}
                  </button>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {bulkApiKeys.trim() ? `${bulkApiKeys.split(/[\n,]+/).map(k => k.trim()).filter(Boolean).length} keys detected` : ""}
                  </span>
                </div>
                {testResults && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {testResults.map((r, i) => (
                      <div key={i} className={`flex items-center gap-2 text-xs font-mono px-2 py-1 rounded ${r.valid ? "bg-green-500/10 text-green-400" : "bg-destructive/10 text-destructive"}`}>
                        <span>{r.valid ? "✓" : "✗"}</span>
                        <span className="truncate flex-1">{r.key.slice(0, 8)}...{r.key.slice(-4)}</span>
                        <span className="text-muted-foreground">{r.error || ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                {healthResult && (
                  <div className="text-xs font-mono bg-muted/40 rounded-lg p-3 space-y-1">
                    {healthResult.error && (
                      <div className="text-destructive">Error: {healthResult.error}</div>
                    )}
                    {!healthResult.error && (
                      <>
                        <div className={healthResult.ok ? "text-green-400" : "text-destructive"}>
                          {healthResult.ok ? "✓ Healthy" : "✗ Unhealthy"}
                        </div>
                        <div>Master DB: {healthResult.masterDbConfigured ? "✓ configured" : "✗ not configured"}</div>
                        <div>Total keys: {healthResult.totalKeys} (active {healthResult.activeKeys} / exhausted {healthResult.exhaustedKeys})</div>
                        <div>Last rotation: {healthResult.lastRotationAt || "never"}</div>
                        <div>nba-odds reachable: {healthResult.nbaOddsReachable ? "✓" : "✗"}</div>
                        <div>moneyline-api reachable: {healthResult.moneylineReachable ? "✓" : "✗"}</div>
                        {healthResult.envSeen && (
                          <div className="pt-1 text-muted-foreground">
                            env: {Object.entries(healthResult.envSeen).map(([k, v]: any) => `${k}=${v ? "✓" : "✗"}`).join(" ")}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Generate Key */}
            <div className="glass-card rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4" /> Generate License Key
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input placeholder="Label (optional)" value={genLabel} onChange={(e) => setGenLabel(e.target.value)}
                  className="bg-input text-foreground placeholder:text-muted-foreground rounded-lg py-2.5 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50" />
                <input type="number" placeholder="Max Devices" value={genMaxDevices} min={1} onChange={(e) => setGenMaxDevices(parseInt(e.target.value) || 1)}
                  className="bg-input text-foreground placeholder:text-muted-foreground rounded-lg py-2.5 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50" />
                <input type="number" placeholder="Expires in days (empty=never)" value={genExpDays} onChange={(e) => setGenExpDays(e.target.value ? parseInt(e.target.value) : "")}
                  className="bg-input text-foreground placeholder:text-muted-foreground rounded-lg py-2.5 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50" />
              </div>
              <button onClick={generateKey} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg py-2.5 px-5 text-sm transition-all">
                Generate Key
              </button>
            </div>

            {/* Keys List */}
            <div className="glass-card rounded-xl p-6 space-y-3">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Key className="w-4 h-4" /> License Keys ({keys.length})
              </h2>
              {keys.length === 0 && <p className="text-muted-foreground text-sm">No keys generated yet.</p>}
              <div className="space-y-2">
                {keys.map((k) => (
                  <div key={k.id} className={`rounded-lg border p-4 space-y-2 ${k.is_active ? "border-border bg-card" : "border-destructive/30 bg-destructive/5"}`}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono text-foreground bg-muted px-2 py-1 rounded">{k.key}</code>
                        <button onClick={() => copyKey(k.key, k.id)} className="text-muted-foreground hover:text-foreground">
                          {copiedId === k.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        {k.label && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{k.label}</span>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => clearSessions(k.id)} title="Clear all device sessions"
                          className="text-xs text-muted-foreground hover:text-foreground bg-muted px-2 py-1 rounded transition-colors">
                          <RefreshCw className="w-3 h-3 inline mr-1" /> Reset ({k.key_sessions?.length || 0})
                        </button>
                        <button onClick={() => toggleKey(k.id, k.is_active)}
                          className={`text-xs px-2 py-1 rounded transition-colors flex items-center gap-1 ${k.is_active ? "text-destructive hover:bg-destructive/10" : "text-green-500 hover:bg-green-500/10"}`}>
                          {k.is_active ? <><ShieldOff className="w-3 h-3" /> Revoke</> : <><Shield className="w-3 h-3" /> Activate</>}
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
                      <span>Devices: {k.key_sessions?.length || 0}/{k.max_devices}</span>
                      <span>Created: {new Date(k.created_at).toLocaleDateString()}</span>
                      {k.expires_at && <span>Expires: {new Date(k.expires_at).toLocaleDateString()}</span>}
                      <span className={k.is_active ? "text-green-500" : "text-destructive"}>{k.is_active ? "Active" : "Revoked"}</span>
                    </div>
                    {k.key_sessions && k.key_sessions.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bound Devices</p>
                        {k.key_sessions.map((s: any) => (
                          <div key={s.id} className="bg-muted/50 rounded-lg p-3 text-xs space-y-1 border border-border/50">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-block w-2 h-2 rounded-full ${s.is_blocked ? 'bg-destructive' : 'bg-green-500'}`} />
                              <span className="font-medium text-foreground">{s.is_blocked ? 'Blocked' : 'Active'}</span>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-muted-foreground">IP: <code className="bg-background px-1 py-0.5 rounded">{s.ip_address || 'unknown'}</code></span>
                            </div>
                            {s.user_agent && <p className="text-muted-foreground truncate" title={s.user_agent}>UA: {s.user_agent}</p>}
                            <div className="flex gap-3 text-muted-foreground">
                              <span>Fingerprint: <code className="bg-background px-1 py-0.5 rounded text-[10px]">{s.device_fingerprint?.slice(0, 12)}…</code></span>
                              <span>First seen: {new Date(s.created_at).toLocaleString()}</span>
                              <span>Last seen: {new Date(s.last_seen_at).toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* IP Whitelist */}
            <div className="glass-card rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Globe className="w-4 h-4" /> IP Whitelist
              </h2>
              <p className="text-xs text-muted-foreground">
                Your current IP: <code className="bg-muted px-1.5 py-0.5 rounded">{myIp}</code>
                {whitelistIps.length === 0 && " • Whitelist empty = all IPs allowed"}
              </p>
              <div className="flex gap-2">
                <input placeholder="IP address to whitelist" value={newIp} onChange={(e) => setNewIp(e.target.value)}
                  className="flex-1 bg-input text-foreground placeholder:text-muted-foreground rounded-lg py-2 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50" />
                <button onClick={addWhitelistIp} disabled={!newIp}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 text-sm font-medium disabled:opacity-40">
                  Add
                </button>
              </div>
              {whitelistIps.map((ip: any) => (
                <div key={ip.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                  <code className="text-sm text-foreground">{ip.ip_address}</code>
                  <button onClick={() => removeWhitelistIp(ip.ip_address)} className="text-destructive hover:text-destructive/80">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ═══ ONBOARDING TAB ═══ */}
        {activeTab === "onboarding" && (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  placeholder="Search by email, name, sport, style..."
                  value={onboardingSearch}
                  onChange={(e) => setOnboardingSearch(e.target.value)}
                  className="w-full bg-input text-foreground placeholder:text-muted-foreground rounded-lg py-2.5 pl-9 pr-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-input text-foreground rounded-lg py-2.5 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50">
                <option value="date">Sort: Newest</option>
                <option value="style">Sort: Style</option>
                <option value="sports">Sort: # Sports</option>
              </select>
              <select value={filterSport || ""} onChange={(e) => setFilterSport(e.target.value || null)}
                className="bg-input text-foreground rounded-lg py-2.5 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50">
                <option value="">All Sports</option>
                {["NBA", "MLB", "UFC", "NFL", "NHL", "Soccer"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select value={filterStyle || ""} onChange={(e) => setFilterStyle(e.target.value || null)}
                className="bg-input text-foreground rounded-lg py-2.5 px-3 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring/50">
                <option value="">All Styles</option>
                {["Conservative", "Aggressive", "Balanced", "Learning"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button onClick={loadOnboarding} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <RefreshCw className={`w-4 h-4 ${onboardingLoading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="glass-card rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Total Responses</p>
                <p className="text-2xl font-extrabold text-foreground">{onboardingResponses.length}</p>
              </div>
              <div className="glass-card rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Top Sport</p>
                <p className="text-2xl font-extrabold text-foreground">
                  {Object.entries(sportStats).sort((a, b) => b[1] - a[1])[0]?.[0] || "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {Object.entries(sportStats).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} users
                </p>
              </div>
              <div className="glass-card rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Top Style</p>
                <p className="text-2xl font-extrabold text-foreground">
                  {Object.entries(styleStats).sort((a, b) => b[1] - a[1])[0]?.[0] || "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {Object.entries(styleStats).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} users
                </p>
              </div>
              <div className="glass-card rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Top Referral</p>
                <p className="text-2xl font-extrabold text-foreground">
                  {Object.entries(referralStats).sort((a, b) => b[1] - a[1])[0]?.[0] || "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {Object.entries(referralStats).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} users
                </p>
              </div>
            </div>

            {/* Distribution Bars */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="glass-card rounded-xl p-5">
                <p className="text-xs font-bold text-foreground mb-3">Sport Distribution</p>
                <div className="space-y-2.5">
                  {Object.entries(sportStats).sort((a, b) => b[1] - a[1]).map(([sport, count]) => (
                    <div key={sport}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-foreground/80 font-medium">{sport}</span>
                        <span className="text-muted-foreground tabular-nums">{count} ({Math.round((count / onboardingResponses.length) * 100)}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${(count / onboardingResponses.length) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-card rounded-xl p-5">
                <p className="text-xs font-bold text-foreground mb-3">Style Distribution</p>
                <div className="space-y-2.5">
                  {Object.entries(styleStats).sort((a, b) => b[1] - a[1]).map(([style, count]) => (
                    <div key={style}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-foreground/80 font-medium">{style}</span>
                        <span className="text-muted-foreground tabular-nums">{count} ({Math.round((count / onboardingResponses.length) * 100)}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full rounded-full bg-accent/60 transition-all" style={{ width: `${(count / onboardingResponses.length) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-card rounded-xl p-5">
                <p className="text-xs font-bold text-foreground mb-3">Referral Sources</p>
                <div className="space-y-2.5">
                  {Object.entries(referralStats).sort((a, b) => b[1] - a[1]).map(([ref, count]) => (
                    <div key={ref}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-foreground/80 font-medium">{ref}</span>
                        <span className="text-muted-foreground tabular-nums">{count} ({Math.round((count / onboardingResponses.length) * 100)}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full rounded-full bg-nba-green/60 transition-all" style={{ width: `${(count / onboardingResponses.length) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* User Responses Table */}
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Users className="w-4 h-4" /> User Responses ({filteredResponses.length})
                </h2>
              </div>

              {onboardingLoading && (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {!onboardingLoading && filteredResponses.length === 0 && (
                <p className="text-muted-foreground text-sm py-8 text-center">No onboarding responses found.</p>
              )}

              {!onboardingLoading && filteredResponses.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">User</th>
                        <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Referral</th>
                        <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sports</th>
                        <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Style</th>
                        <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Risk</th>
                        <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</th>
                        <th className="text-left py-3 px-4 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResponses.map((r) => {
                        const isExpanded = expandedUser === r.id;
                        const StyleIcon = STYLE_ICONS[r.betting_style || ""] || Target;
                        const riskLevel = r.ai_recommendations?.risk_level;
                        return (
                          <React.Fragment key={r.id}>
                            <tr
                              onClick={() => setExpandedUser(isExpanded ? null : r.id)}
                              className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                            >
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                    <span className="text-xs font-bold text-primary">
                                      {resolveDisplayName({ display_name: r.display_name, email: r.email }, null, "U")[0].toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate max-w-[160px]">
                                      {resolveDisplayName({ display_name: r.display_name, email: r.email }, null, "Unknown")}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">
                                      {r.email || "No email"}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                <span className="text-xs text-foreground/80">{r.referral || "—"}</span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex flex-wrap gap-1">
                                  {(r.sports || []).map((s) => (
                                    <span key={s} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${SPORT_COLORS[s] || "bg-muted text-muted-foreground border-border"}`}>
                                      {s}
                                    </span>
                                  ))}
                                  {(!r.sports || r.sports.length === 0) && <span className="text-xs text-muted-foreground">—</span>}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                {r.betting_style ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-accent/10 text-accent border border-accent/20 inline-flex items-center gap-1">
                                    <StyleIcon className="w-3 h-3" /> {r.betting_style}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                {riskLevel ? (
                                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                    riskLevel === "high" ? "bg-destructive/10 text-destructive" :
                                    riskLevel === "low" ? "bg-nba-green/10 text-nba-green" :
                                    "bg-accent/10 text-accent"
                                  }`}>
                                    {riskLevel.toUpperCase()}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                  {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                              </td>
                            </tr>

                            {/* Expanded Detail Row */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={7} className="p-0">
                                  <div className="bg-muted/5 border-b border-border px-6 py-5 space-y-4">
                                    {/* User Details Grid */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                      <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Full Email</p>
                                        <p className="text-xs font-medium text-foreground break-all">{r.email || "Not provided"}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Display Name</p>
                                        <p className="text-xs font-medium text-foreground">{r.display_name || "Not set"}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">User ID</p>
                                        <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground/70">{r.user_id.slice(0, 12)}…</code>
                                      </div>
                                      <div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Last Updated</p>
                                        <p className="text-xs text-foreground/80">{new Date(r.updated_at).toLocaleString()}</p>
                                      </div>
                                    </div>

                                    {/* AI Recommendations */}
                                    {r.ai_recommendations && (
                                      <div className="rounded-lg border border-primary/15 bg-primary/[0.03] p-4 space-y-3">
                                        <p className="text-xs font-bold text-primary flex items-center gap-1.5">
                                          <Sparkles className="w-3.5 h-3.5" /> AI Personalization
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {r.ai_recommendations.welcome_message && (
                                            <div className="col-span-full">
                                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Welcome Message</p>
                                              <p className="text-xs text-foreground/80 leading-relaxed">{r.ai_recommendations.welcome_message}</p>
                                            </div>
                                          )}
                                          {r.ai_recommendations.daily_tip && (
                                            <div className="col-span-full">
                                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Daily Tip</p>
                                              <p className="text-xs text-foreground/80 leading-relaxed">{r.ai_recommendations.daily_tip}</p>
                                            </div>
                                          )}
                                          {r.ai_recommendations.bankroll_tip && (
                                            <div>
                                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Bankroll Tip</p>
                                              <p className="text-xs text-foreground/80">{r.ai_recommendations.bankroll_tip}</p>
                                            </div>
                                          )}
                                          {r.ai_recommendations.focus_sport && (
                                            <div>
                                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Focus Sport</p>
                                              <p className="text-xs font-medium text-foreground">{r.ai_recommendations.focus_sport}</p>
                                            </div>
                                          )}
                                          {r.ai_recommendations.recommended_features && (
                                            <div>
                                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-1">Recommended Features</p>
                                              <div className="flex flex-wrap gap-1">
                                                {r.ai_recommendations.recommended_features.map((f: string) => (
                                                  <span key={f} className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted text-foreground/70 border border-border">
                                                    {f}
                                                  </span>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminPage;
