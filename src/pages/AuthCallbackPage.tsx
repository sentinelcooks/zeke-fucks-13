// Handles the OAuth redirect back from Supabase after Google/Apple sign-in.
// Supabase JS v2 automatically detects the code/hash in the URL and exchanges
// it for a session on the first getSession() call — no manual parsing needed.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error("OAuth callback error:", error.message);
        navigate("/auth?error=oauth_failed", { replace: true });
        return;
      }
      navigate(session ? "/dashboard" : "/auth", { replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );
}
