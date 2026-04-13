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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Clear expired session tokens (24h+)
    const { count: expiredSessions } = await supabase
      .from("key_sessions")
      .update({ session_token: null, token_expires_at: null })
      .lt("token_expires_at", new Date().toISOString())
      .not("token_expires_at", "is", null)
      .select("*", { count: "exact", head: true });

    // 2. Delete login attempts older than 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: deletedAttempts } = await supabase
      .from("login_attempts")
      .delete()
      .lt("attempted_at", oneDayAgo)
      .select("*", { count: "exact", head: true });

    // 3. Delete fingerprint logs older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: deletedLogs } = await supabase
      .from("fingerprint_log")
      .delete()
      .lt("logged_at", thirtyDaysAgo)
      .select("*", { count: "exact", head: true });

    return new Response(
      JSON.stringify({
        success: true,
        expired_sessions_cleared: expiredSessions || 0,
        old_attempts_deleted: deletedAttempts || 0,
        old_fingerprint_logs_deleted: deletedLogs || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (_e) {
    return new Response(
      JSON.stringify({ error: "Cleanup failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
