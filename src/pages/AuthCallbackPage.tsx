// Handles the OAuth redirect back from Supabase after Google/Apple sign-in,
// and email confirmation links. Uses onAuthStateChange as the primary signal
// so it works regardless of whether the PKCE code exchange is instant or async.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SplashScreen } from "@/components/SplashScreen";

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let done = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (done) return;
        if (event === "SIGNED_IN" && session) {
          done = true;
          subscription.unsubscribe();
          if (import.meta.env.DEV) console.log("[AuthCallback] SIGNED_IN via onAuthStateChange");
          navigate("/dashboard", { replace: true });
        }
      }
    );

    // Also check immediately — session may already exist if the exchange was instant
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (done) return;
      if (error) {
        if (import.meta.env.DEV) console.error("[AuthCallback] getSession error:", error.message);
        done = true;
        subscription.unsubscribe();
        navigate("/auth?error=oauth_failed", { replace: true });
        return;
      }
      if (session) {
        done = true;
        subscription.unsubscribe();
        if (import.meta.env.DEV) console.log("[AuthCallback] session via getSession");
        navigate("/dashboard", { replace: true });
      }
      // No session yet — wait for onAuthStateChange SIGNED_IN above
    });

    // 10s timeout: treat no-session as expired/broken link
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        subscription.unsubscribe();
        if (import.meta.env.DEV) console.warn("[AuthCallback] timeout — no session established");
        navigate("/auth?error=oauth_failed", { replace: true });
      }
    }, 10_000);

    return () => {
      done = true;
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [navigate]);

  return <SplashScreen persistent />;
}
