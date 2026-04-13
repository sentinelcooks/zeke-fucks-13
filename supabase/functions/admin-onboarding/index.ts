import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { password, action } = await req.json();
    const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET_PASSWORD");
    if (!ADMIN_SECRET || password !== ADMIN_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (action === "list_responses") {
      const { data, error } = await supabaseAdmin
        .from("onboarding_responses")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch profile emails for each user
      const userIds = (data || []).map((r: any) => r.user_id);
      const profiles: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profileData } = await supabaseAdmin
          .from("profiles")
          .select("id, email, display_name")
          .in("id", userIds);
        (profileData || []).forEach((p: any) => { profiles[p.id] = p; });
      }

      const enriched = (data || []).map((r: any) => ({
        ...r,
        email: profiles[r.user_id]?.email || null,
        display_name: profiles[r.user_id]?.display_name || null,
      }));

      return new Response(JSON.stringify({ responses: enriched }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
