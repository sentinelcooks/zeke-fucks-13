import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

// Handles sentinel://auth/callback deep links on iOS/Android.
// Fires when the OS opens the app via the custom URL scheme after OAuth or
// email confirmation. Exchanges the PKCE code (or hash tokens as fallback)
// for a Supabase session, then navigates to the dashboard.
export function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let removeListener: (() => void) | undefined;

    import("@capacitor/app").then(({ App }) => {
      App.addListener("appUrlOpen", async ({ url }: { url: string }) => {
        if (!url.startsWith("sentinel://auth/callback")) return;
        if (import.meta.env.DEV) console.log("[DeepLink] appUrlOpen:", url);

        // PKCE code flow — used by OAuth and newer Supabase email confirmation
        const qIdx = url.indexOf("?");
        const params = new URLSearchParams(
          qIdx !== -1 ? url.slice(qIdx + 1).split("#")[0] : ""
        );
        const code = params.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            if (import.meta.env.DEV)
              console.error("[DeepLink] exchangeCodeForSession error:", error.message);
            navigate("/auth?error=oauth_failed", { replace: true });
          } else {
            navigate("/dashboard", { replace: true });
          }
          return;
        }

        // Hash token fallback — older Supabase email confirmation returns #access_token=...
        const hashStr = url.split("#")[1];
        if (hashStr) {
          const hash = new URLSearchParams(hashStr);
          const accessToken = hash.get("access_token");
          const refreshToken = hash.get("refresh_token");
          if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!error) {
              navigate("/dashboard", { replace: true });
              return;
            }
          }
        }

        navigate("/auth?error=oauth_failed", { replace: true });
      }).then((handle) => {
        removeListener = () => handle.remove();
      });
    });

    return () => removeListener?.();
  }, [navigate]);

  return null;
}
