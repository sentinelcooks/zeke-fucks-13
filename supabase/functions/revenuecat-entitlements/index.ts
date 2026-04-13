import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user via Supabase JWT
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rcSecretKey = Deno.env.get("REVENUECAT_SECRET_KEY");
    if (!rcSecretKey) {
      return new Response(JSON.stringify({ error: "RevenueCat not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the user's Supabase ID as the RevenueCat app_user_id
    const appUserId = user.id;

    // Fetch subscriber info from RevenueCat
    const rcResponse = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${rcSecretKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!rcResponse.ok) {
      // If 404, user doesn't exist in RC yet — not subscribed
      if (rcResponse.status === 404) {
        return new Response(
          JSON.stringify({
            isSubscribed: false,
            entitlements: {},
            activeSubscriptions: [],
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await rcResponse.text();
      console.error("RevenueCat API error:", rcResponse.status, errText);
      return new Response(JSON.stringify({ error: "Failed to check subscription" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rcData = await rcResponse.json();
    const subscriber = rcData.subscriber;
    const entitlements = subscriber?.entitlements || {};
    const activeEntitlements: Record<string, boolean> = {};

    for (const [key, value] of Object.entries(entitlements)) {
      const ent = value as any;
      const expiresDate = ent.expires_date;
      // Active if no expiry (lifetime) or expiry is in the future
      activeEntitlements[key] =
        !expiresDate || new Date(expiresDate) > new Date();
    }

    const isProActive = activeEntitlements["Sentinel Pro"] === true;

    return new Response(
      JSON.stringify({
        isSubscribed: isProActive,
        entitlements: activeEntitlements,
        activeSubscriptions: subscriber?.subscriptions
          ? Object.keys(subscriber.subscriptions)
          : [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Entitlement check error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
