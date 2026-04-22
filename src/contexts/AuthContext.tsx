import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";

interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  timezone: string;
  notification_enabled: boolean;
  odds_format: "american" | "decimal";
  onboarding_complete: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error?: string }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<Profile, "display_name" | "timezone" | "notification_enabled" | "odds_format">>) => Promise<void>;
  refreshProfile: (userId?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) {
      const p = data as unknown as Profile;
      setProfile(p);
      // Sync onboarding_complete flag to local storage for offline resilience
      if ((data as any).onboarding_complete) {
        localStorage.setItem("sentinel_onboarding_complete", "true");
      }
      // Mirror odds_format to localStorage so useOddsFormat has a fallback
      // during the brief window between auth and profile fetch.
      if (p.odds_format === "american" || p.odds_format === "decimal") {
        localStorage.setItem("sentinel_odds_format", p.odds_format);
      }
      return p;
    } else {
      // Profile missing (e.g. trigger didn't fire) — create it from user metadata
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        const displayName = currentUser.user_metadata?.display_name || null;
        const deviceTz = typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "America/New_York";
        const { data: newProfile } = await supabase
          .from("profiles")
          .upsert({ id: userId, email: currentUser.email, display_name: displayName, timezone: deviceTz || "America/New_York" }, { onConflict: "id" })
          .select()
          .single();
        if (newProfile) {
          const p = newProfile as unknown as Profile;
          setProfile(p);
          return p;
        }
      }
    }
    return null;
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          setTimeout(() => fetchProfile(newSession.user.id), 0);
        } else {
          setProfile(null);
        }
        setIsLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      // If "Remember me" was NOT checked, clear the persisted session on fresh page load
      const remember = localStorage.getItem("primal-remember") === "true";
      const isNewTab = !sessionStorage.getItem("primal-tab-active");
      sessionStorage.setItem("primal-tab-active", "true");

      if (!remember && isNewTab && existingSession) {
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setProfile(null);
        setIsLoading(false);
        return;
      }

      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      if (existingSession?.user) {
        fetchProfile(existingSession.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signUp = async (email: string, password: string, displayName?: string): Promise<{ error?: string }> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        // Ensure email confirmation links always point to the current production
        // domain, not localhost or a stale Lovable URL from Supabase's Site URL setting.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) return { error: error.message };
    if (data.user && displayName) {
      await supabase.from("profiles").update({ display_name: displayName }).eq("id", data.user.id);
    }
    return {};
  };

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  const updateProfile = async (updates: Partial<Pick<Profile, "display_name" | "timezone" | "notification_enabled" | "odds_format">>) => {
    if (!user) return;
    await supabase.from("profiles").update(updates).eq("id", user.id);
    await fetchProfile(user.id);
  };

  const refreshProfile = async (userId?: string) => {
    const id = userId ?? user?.id;
    if (id) await fetchProfile(id);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isAuthenticated: !!session,
        isLoading,
        signUp,
        signIn,
        signOut,
        updateProfile,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
