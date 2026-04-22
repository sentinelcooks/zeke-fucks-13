// Replaced Lovable cloud-auth broker with native Supabase OAuth.
// The old implementation redirected to /~oauth/initiate which only exists
// on Lovable-hosted deployments — causing a 404 on Vercel.
// Supabase's own signInWithOAuth redirects directly to the provider via
// https://<project>.supabase.co/auth/v1/authorize — no custom route needed.

import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const lovable = {
  auth: {
    signInWithOAuth: async (
      provider: "google" | "apple" | "microsoft",
      opts?: SignInOptions,
    ) => {
      const redirectTo =
        opts?.redirect_uri ?? `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider as "google" | "apple",
        options: {
          redirectTo,
          queryParams: opts?.extraParams,
        },
      });

      if (error) return { error };
      // Supabase navigates the browser to the provider — mark as redirected
      // so AuthPage.tsx's handleOAuth bails out cleanly (same contract as before).
      return { redirected: true };
    },
  },
};
