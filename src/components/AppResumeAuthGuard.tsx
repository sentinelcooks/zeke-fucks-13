import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export function AppResumeAuthGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    let inFlight = false;
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", async ({ isActive }) => {
        if (!isActive || inFlight) return;
        inFlight = true;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            window.dispatchEvent(new Event("sentinel:auth-callback"));
            if (location.pathname.startsWith("/auth")) {
              console.log("[auth] resume: session found → /dashboard");
              navigate("/dashboard", { replace: true });
            }
          }
        } finally { inFlight = false; }
      }).then(handle => { remove = () => handle.remove(); });
    });
    return () => remove?.();
  }, [navigate, location.pathname]);
  return null;
}
